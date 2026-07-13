-- Phase 2: production-reliable generic media processing.
-- This corrective migration is mirrored byte-for-byte in both temporary roots.

create extension if not exists pgcrypto;

alter table public.media_assets
  add column if not exists failure_code text,
  add column if not exists source_cleanup_after timestamptz,
  add column if not exists source_deleted_at timestamptz,
  add column if not exists cleanup_attempts integer not null default 0,
  add column if not exists cleanup_next_attempt_at timestamptz not null default now(),
  add column if not exists cleanup_locked_by text,
  add column if not exists cleanup_lock_expires_at timestamptz,
  add column if not exists cleanup_token uuid;

alter table public.media_assets
  drop constraint if exists media_assets_status_check;
alter table public.media_assets
  add constraint media_assets_status_check
  check (status in ('created', 'uploaded', 'processing', 'ready', 'failed', 'rejected', 'expired', 'abandoned', 'cancelled'));

alter table public.media_assets
  drop constraint if exists media_assets_failure_code_check;
alter table public.media_assets
  add constraint media_assets_failure_code_check
  check (failure_code is null or failure_code ~ '^[a-z0-9_]{1,80}$');

alter table public.media_assets
  drop constraint if exists media_assets_cleanup_attempts_check;
alter table public.media_assets
  add constraint media_assets_cleanup_attempts_check
  check (cleanup_attempts >= 0);

alter table public.media_processing_jobs
  add column if not exists locked_by text,
  add column if not exists lock_expires_at timestamptz,
  add column if not exists lease_generation bigint not null default 0,
  add column if not exists claim_token uuid,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists failure_code text,
  add column if not exists failure_class text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists stale_reclaims integer not null default 0;

update public.media_processing_jobs
set next_attempt_at = coalesce(next_attempt_at, next_retry_at, now())
where next_attempt_at is null;

alter table public.media_processing_jobs
  alter column next_attempt_at set default now(),
  alter column next_attempt_at set not null;

update public.media_processing_jobs
set status = case
    when status = 'failed' and attempts >= max_attempts then 'dead_letter'
    when status = 'failed' then 'retry_wait'
    else status
  end,
  failure_code = case
    when status = 'failed' then 'legacy_processing_failure'
    else failure_code
  end,
  failure_class = case
    when status = 'failed' then 'retryable'
    else failure_class
  end;

-- Phase 1 workers had no renewable lease identity. Fence every in-flight legacy
-- row during the upgrade so it can be retried under the Phase 2 claim protocol.
update public.media_processing_jobs
set status = 'retry_wait',
    next_attempt_at = now(),
    locked_at = null,
    locked_by = null,
    lock_expires_at = null,
    claim_token = null,
    heartbeat_at = null,
    lease_generation = lease_generation + 1,
    failure_code = 'legacy_worker_lease_recovered',
    failure_class = 'retryable'
where status = 'running';

update public.media_processing_jobs
set locked_at = null,
    locked_by = null,
    lock_expires_at = null,
    claim_token = null,
    heartbeat_at = null
where status <> 'running';

alter table public.media_processing_jobs
  drop constraint if exists media_processing_jobs_status_check;
alter table public.media_processing_jobs
  add constraint media_processing_jobs_status_check
  check (status in ('queued', 'running', 'retry_wait', 'succeeded', 'rejected', 'dead_letter', 'cancelled'));

alter table public.media_processing_jobs
  drop constraint if exists media_processing_jobs_failure_code_check;
alter table public.media_processing_jobs
  add constraint media_processing_jobs_failure_code_check
  check (failure_code is null or failure_code ~ '^[a-z0-9_]{1,80}$');

alter table public.media_processing_jobs
  drop constraint if exists media_processing_jobs_failure_class_check;
alter table public.media_processing_jobs
  add constraint media_processing_jobs_failure_class_check
  check (failure_class is null or failure_class in ('retryable', 'permanent', 'cancelled'));

alter table public.media_processing_jobs
  drop constraint if exists media_processing_jobs_lease_shape_check;
alter table public.media_processing_jobs
  add constraint media_processing_jobs_lease_shape_check
  check (
    (status = 'running' and locked_by is not null and lock_expires_at is not null and claim_token is not null and heartbeat_at is not null)
    or
    (status <> 'running' and locked_by is null and lock_expires_at is null and claim_token is null)
  );

drop index if exists public.media_processing_jobs_ready_idx;
create index if not exists media_processing_jobs_claim_idx
  on public.media_processing_jobs(status, next_attempt_at, lock_expires_at, created_at, id);
create index if not exists media_processing_jobs_asset_status_idx
  on public.media_processing_jobs(asset_id, status, created_at);
create index if not exists media_assets_cleanup_claim_idx
  on public.media_assets(cleanup_next_attempt_at, cleanup_lock_expires_at, source_cleanup_after, created_at, id)
  where status in ('created', 'ready', 'failed', 'rejected', 'expired', 'abandoned', 'cancelled');

create table if not exists public.media_processing_events (
  id bigint generated always as identity primary key,
  job_id uuid references public.media_processing_jobs(id) on delete cascade,
  asset_id uuid not null,
  event_type text not null,
  failure_code text,
  worker_id text,
  lease_generation bigint,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint media_processing_events_type_check check (
    event_type in ('claimed', 'lease_reclaimed', 'heartbeat', 'retry_scheduled', 'succeeded', 'rejected', 'dead_lettered', 'cancelled', 'requeued', 'cleanup_claimed', 'cleanup_succeeded', 'cleanup_failed')
  ),
  constraint media_processing_events_failure_code_check check (
    failure_code is null or failure_code ~ '^[a-z0-9_]{1,80}$'
  ),
  constraint media_processing_events_details_check check (jsonb_typeof(details) = 'object')
);

create index if not exists media_processing_events_job_created_idx
  on public.media_processing_events(job_id, created_at desc);
create index if not exists media_processing_events_type_created_idx
  on public.media_processing_events(event_type, created_at desc);

alter table public.media_processing_events enable row level security;
revoke all on table public.media_processing_events from public, anon, authenticated;
grant all privileges on table public.media_processing_events to service_role;
grant usage, select on sequence public.media_processing_events_id_seq to service_role;

create or replace function public.claim_media_processing_jobs(
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 180,
  p_max_attempts integer default 5
)
returns table (
  id uuid,
  asset_id uuid,
  job_type text,
  attempts integer,
  max_attempts integer,
  lease_generation bigint,
  claim_token uuid,
  lock_expires_at timestamptz,
  stale_reclaimed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_worker_id is null or btrim(p_worker_id) = '' or length(p_worker_id) > 120 then
    raise exception 'media_worker_id_invalid' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 25 then
    raise exception 'media_claim_limit_invalid' using errcode = '22023';
  end if;
  if p_lease_seconds < 15 or p_lease_seconds > 900 then
    raise exception 'media_lease_duration_invalid' using errcode = '22023';
  end if;
  if p_max_attempts < 1 or p_max_attempts > 20 then
    raise exception 'media_max_attempts_invalid' using errcode = '22023';
  end if;

  update public.media_processing_jobs job
  set status = 'dead_letter',
      failure_code = 'retry_exhausted_after_worker_loss',
      failure_class = 'retryable',
      dead_lettered_at = now(),
      completed_at = now(),
      locked_at = null,
      locked_by = null,
      lock_expires_at = null,
      heartbeat_at = null,
      claim_token = null,
      updated_at = now()
  where job.status = 'running'
    and job.lock_expires_at <= now()
    and job.attempts >= job.max_attempts;

  return query
  with candidates as (
    select job.id, job.status = 'running' as was_stale
    from public.media_processing_jobs job
    join public.media_assets asset on asset.id = job.asset_id
    join public.profiles profile on profile.id = asset.owner_id
    where job.attempts < job.max_attempts
      and (
        (job.status in ('queued', 'retry_wait') and job.next_attempt_at <= now())
        or
        (job.status = 'running' and job.lock_expires_at <= now())
      )
      and asset.status in ('uploaded', 'processing')
      and asset.consumed_at is null
      and profile.account_status = 'active'
      and profile.deletion_started_at is null
    order by
      case when job.status = 'running' then 0 else 1 end,
      coalesce(job.lock_expires_at, job.next_attempt_at),
      job.created_at,
      job.id
    for update of job skip locked
    limit p_limit
  ),
  claimed as (
    update public.media_processing_jobs job
    set status = 'running',
        attempts = job.attempts + 1,
        max_attempts = p_max_attempts,
        locked_at = now(),
        locked_by = left(btrim(p_worker_id), 120),
        lock_expires_at = now() + make_interval(secs => p_lease_seconds),
        heartbeat_at = now(),
        lease_generation = job.lease_generation + 1,
        claim_token = gen_random_uuid(),
        started_at = coalesce(job.started_at, now()),
        completed_at = null,
        failure_code = null,
        failure_class = null,
        stale_reclaims = job.stale_reclaims + case when candidates.was_stale then 1 else 0 end,
        updated_at = now()
    from candidates
    where job.id = candidates.id
    returning job.id, job.asset_id, job.job_type, job.attempts, job.max_attempts,
      job.lease_generation, job.claim_token, job.lock_expires_at, candidates.was_stale
  ),
  events as (
    insert into public.media_processing_events (
      job_id, asset_id, event_type, worker_id, lease_generation, details
    )
    select claimed.id, claimed.asset_id,
      case when claimed.was_stale then 'lease_reclaimed' else 'claimed' end,
      left(btrim(p_worker_id), 120), claimed.lease_generation,
      jsonb_build_object('attempt', claimed.attempts)
    from claimed
    returning job_id
  )
  select claimed.id, claimed.asset_id, claimed.job_type, claimed.attempts,
    claimed.max_attempts, claimed.lease_generation, claimed.claim_token,
    claimed.lock_expires_at, claimed.was_stale
  from claimed;
end;
$$;

revoke all on function public.claim_media_processing_jobs(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_media_processing_jobs(text, integer, integer, integer) to service_role;

create or replace function public.heartbeat_media_processing_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_generation bigint,
  p_claim_token uuid,
  p_lease_seconds integer default 180
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_lease_seconds < 15 or p_lease_seconds > 900 then
    raise exception 'media_lease_duration_invalid' using errcode = '22023';
  end if;

  update public.media_processing_jobs job
  set heartbeat_at = now(),
      lock_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where job.id = p_job_id
    and job.status = 'running'
    and job.locked_by = p_worker_id
    and job.lease_generation = p_lease_generation
    and job.claim_token = p_claim_token
    and job.lock_expires_at > now()
    and exists (
      select 1
      from public.media_assets asset
      join public.profiles profile on profile.id = asset.owner_id
      where asset.id = job.asset_id
        and asset.status in ('uploaded', 'processing')
        and profile.account_status = 'active'
        and profile.deletion_started_at is null
    )
  returning job.asset_id into v_asset_id;

  if v_asset_id is null then
    return false;
  end if;

  insert into public.media_processing_events (
    job_id, asset_id, event_type, worker_id, lease_generation
  ) values (
    p_job_id, v_asset_id, 'heartbeat', left(p_worker_id, 120), p_lease_generation
  );
  return true;
end;
$$;

revoke all on function public.heartbeat_media_processing_job(uuid, text, bigint, uuid, integer) from public, anon, authenticated;
grant execute on function public.heartbeat_media_processing_job(uuid, text, bigint, uuid, integer) to service_role;

create or replace function public.media_processing_lease_is_current(
  p_job_id uuid,
  p_worker_id text,
  p_lease_generation bigint,
  p_claim_token uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from public.media_processing_jobs job
    join public.media_assets asset on asset.id = job.asset_id
    join public.profiles profile on profile.id = asset.owner_id
    where job.id = p_job_id
      and job.status = 'running'
      and job.locked_by = p_worker_id
      and job.lease_generation = p_lease_generation
      and job.claim_token = p_claim_token
      and job.lock_expires_at > now()
      and asset.status in ('uploaded', 'processing')
      and profile.account_status = 'active'
      and profile.deletion_started_at is null
  ), false)
$$;

revoke all on function public.media_processing_lease_is_current(uuid, text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.media_processing_lease_is_current(uuid, text, bigint, uuid) to service_role;

create or replace function public.complete_media_processing_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_generation bigint,
  p_claim_token uuid,
  p_width integer default null,
  p_height integer default null,
  p_duration_ms integer default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.media_processing_jobs%rowtype;
  v_asset public.media_assets%rowtype;
  v_expected_kinds text[];
  v_expected_bucket text;
  v_derivative_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select * into v_job
  from public.media_processing_jobs
  where id = p_job_id
  for update;

  if v_job.id is null
    or v_job.status <> 'running'
    or v_job.locked_by <> p_worker_id
    or v_job.lease_generation <> p_lease_generation
    or v_job.claim_token <> p_claim_token
    or v_job.lock_expires_at <= now()
  then
    return false;
  end if;

  select asset.* into v_asset
  from public.media_assets asset
  join public.profiles profile on profile.id = asset.owner_id
  where asset.id = v_job.asset_id
    and asset.status in ('uploaded', 'processing')
    and asset.consumed_at is null
    and profile.account_status = 'active'
    and profile.deletion_started_at is null
  for update of asset;

  if v_asset.id is null then
    return false;
  end if;

  v_expected_kinds := case when v_asset.media_type = 'image'
    then array['canonical', 'thumbnail']::text[]
    else array['canonical', 'poster']::text[]
  end;
  v_expected_bucket := case when v_asset.surface = 'avatar' then 'media-public' else 'media-private' end;

  select count(*) into v_derivative_count
  from public.media_derivatives derivative
  where derivative.asset_id = v_asset.id
    and derivative.kind = any(v_expected_kinds)
    and derivative.bucket_id = v_expected_bucket
    and (
      (v_asset.surface = 'avatar' and derivative.storage_path like ('avatars/' || v_asset.owner_id::text || '/' || v_asset.id::text || '/%'))
      or
      (v_asset.surface = 'post' and derivative.storage_path like ('private-posts/' || v_asset.owner_id::text || '/' || v_asset.id::text || '/%'))
      or
      (v_asset.surface = 'memory' and derivative.storage_path like ('memories/' || v_asset.owner_id::text || '/' || v_asset.id::text || '/%'))
    )
    and (v_asset.surface = 'avatar' or derivative.public_url is null);

  if v_derivative_count <> cardinality(v_expected_kinds) then
    raise exception 'media_derivative_set_incomplete';
  end if;

  update public.media_assets
  set status = 'ready',
      failure_code = null,
      failure_reason = null,
      original_width = coalesce(original_width, p_width),
      original_height = coalesce(original_height, p_height),
      duration_ms = coalesce(p_duration_ms, duration_ms),
      processed_at = now(),
      source_cleanup_after = now() + interval '24 hours',
      updated_at = now()
  where id = v_asset.id;

  update public.media_processing_jobs
  set status = 'succeeded',
      completed_at = now(),
      locked_at = null,
      locked_by = null,
      lock_expires_at = null,
      heartbeat_at = null,
      claim_token = null,
      last_error = null,
      failure_code = null,
      failure_class = null,
      updated_at = now()
  where id = v_job.id;

  insert into public.media_processing_events (
    job_id, asset_id, event_type, worker_id, lease_generation,
    details
  ) values (
    v_job.id, v_asset.id, 'succeeded', left(p_worker_id, 120),
    p_lease_generation, jsonb_build_object('attempt', v_job.attempts)
  );
  return true;
end;
$$;

revoke all on function public.complete_media_processing_job(uuid, text, bigint, uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.complete_media_processing_job(uuid, text, bigint, uuid, integer, integer, integer) to service_role;

create or replace function public.fail_media_processing_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_generation bigint,
  p_claim_token uuid,
  p_failure_code text,
  p_failure_class text,
  p_base_delay_seconds integer default 30,
  p_max_delay_seconds integer default 3600
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.media_processing_jobs%rowtype;
  v_next_status text;
  v_asset_status text;
  v_delay_seconds integer;
  v_jitter numeric;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_failure_code is null or p_failure_code !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'media_failure_code_invalid' using errcode = '22023';
  end if;
  if p_failure_class not in ('retryable', 'permanent', 'cancelled') then
    raise exception 'media_failure_class_invalid' using errcode = '22023';
  end if;
  if p_base_delay_seconds < 1 or p_base_delay_seconds > 3600
    or p_max_delay_seconds < p_base_delay_seconds or p_max_delay_seconds > 86400
  then
    raise exception 'media_retry_configuration_invalid' using errcode = '22023';
  end if;

  select * into v_job
  from public.media_processing_jobs
  where id = p_job_id
  for update;

  if v_job.id is null
    or v_job.status <> 'running'
    or v_job.locked_by <> p_worker_id
    or v_job.lease_generation <> p_lease_generation
    or v_job.claim_token <> p_claim_token
  then
    return 'lease_lost';
  end if;

  if p_failure_class = 'cancelled' then
    v_next_status := 'cancelled';
    v_asset_status := 'cancelled';
  elsif p_failure_class = 'permanent' then
    v_next_status := 'rejected';
    v_asset_status := 'rejected';
  elsif v_job.attempts >= v_job.max_attempts then
    v_next_status := 'dead_letter';
    v_asset_status := 'failed';
  else
    v_next_status := 'retry_wait';
    v_asset_status := 'uploaded';
  end if;

  v_jitter := 0.75 + (
    get_byte(extensions.digest((v_job.id::text || ':' || v_job.attempts::text)::bytea, 'sha256'::text), 0)::numeric / 255
  ) * 0.5;
  v_delay_seconds := least(
    p_max_delay_seconds,
    greatest(1, floor(p_base_delay_seconds * power(2, greatest(v_job.attempts - 1, 0)) * v_jitter)::integer)
  );

  update public.media_assets
  set status = v_asset_status,
      failure_code = p_failure_code,
      failure_reason = p_failure_code,
      source_cleanup_after = case
        when v_next_status in ('rejected', 'dead_letter', 'cancelled') then now() + interval '24 hours'
        else source_cleanup_after
      end,
      updated_at = now()
  where id = v_job.asset_id
    and status in ('uploaded', 'processing');

  update public.media_processing_jobs
  set status = v_next_status,
      failure_code = p_failure_code,
      failure_class = p_failure_class,
      last_error = p_failure_code,
      next_attempt_at = case when v_next_status = 'retry_wait'
        then now() + make_interval(secs => v_delay_seconds)
        else next_attempt_at
      end,
      next_retry_at = case when v_next_status = 'retry_wait'
        then now() + make_interval(secs => v_delay_seconds)
        else next_retry_at
      end,
      rejected_at = case when v_next_status = 'rejected' then now() else rejected_at end,
      dead_lettered_at = case when v_next_status = 'dead_letter' then now() else dead_lettered_at end,
      cancelled_at = case when v_next_status = 'cancelled' then now() else cancelled_at end,
      completed_at = case when v_next_status in ('rejected', 'dead_letter', 'cancelled') then now() else null end,
      locked_at = null,
      locked_by = null,
      lock_expires_at = null,
      heartbeat_at = null,
      claim_token = null,
      updated_at = now()
  where id = v_job.id;

  insert into public.media_processing_events (
    job_id, asset_id, event_type, failure_code, worker_id, lease_generation, details
  ) values (
    v_job.id, v_job.asset_id,
    case v_next_status
      when 'retry_wait' then 'retry_scheduled'
      when 'rejected' then 'rejected'
      when 'dead_letter' then 'dead_lettered'
      else 'cancelled'
    end,
    p_failure_code, left(p_worker_id, 120), p_lease_generation,
    case when v_next_status = 'retry_wait'
      then jsonb_build_object('attempt', v_job.attempts, 'delaySeconds', v_delay_seconds)
      else jsonb_build_object('attempt', v_job.attempts)
    end
  );

  return v_next_status;
end;
$$;

revoke all on function public.fail_media_processing_job(uuid, text, bigint, uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.fail_media_processing_job(uuid, text, bigint, uuid, text, text, integer, integer) to service_role;

create or replace function public.requeue_media_processing_job(
  p_job_id uuid,
  p_operator text default 'operator'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.media_processing_jobs%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_operator is null or btrim(p_operator) = '' or length(p_operator) > 120 then
    raise exception 'media_operator_invalid' using errcode = '22023';
  end if;

  select * into v_job
  from public.media_processing_jobs
  where id = p_job_id
  for update;

  if v_job.id is null then
    return false;
  end if;
  if v_job.status = 'queued' then
    return true;
  end if;
  if v_job.status <> 'dead_letter' or v_job.failure_class <> 'retryable' then
    return false;
  end if;

  update public.media_processing_jobs
  set status = 'queued',
      attempts = 0,
      next_attempt_at = now(),
      next_retry_at = now(),
      failure_code = null,
      failure_class = null,
      last_error = null,
      completed_at = null,
      dead_lettered_at = null,
      lease_generation = lease_generation + 1,
      updated_at = now()
  where id = p_job_id;

  update public.media_assets
  set status = 'uploaded',
      failure_code = null,
      failure_reason = null,
      source_cleanup_after = null,
      updated_at = now()
  where id = v_job.asset_id
    and status = 'failed'
    and source_deleted_at is null;

  insert into public.media_processing_events (
    job_id, asset_id, event_type, worker_id, lease_generation,
    details
  ) values (
    v_job.id, v_job.asset_id, 'requeued', left(btrim(p_operator), 120),
    v_job.lease_generation + 1, jsonb_build_object('previousFailureCode', v_job.failure_code)
  );
  return true;
end;
$$;

revoke all on function public.requeue_media_processing_job(uuid, text) from public, anon, authenticated;
grant execute on function public.requeue_media_processing_job(uuid, text) to service_role;

create or replace function public.cancel_media_processing_job(
  p_job_id uuid,
  p_operator text default 'operator',
  p_failure_code text default 'operator_cancelled'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.media_processing_jobs%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_failure_code !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'media_failure_code_invalid' using errcode = '22023';
  end if;

  select * into v_job
  from public.media_processing_jobs
  where id = p_job_id
  for update;
  if v_job.id is null then
    return false;
  end if;
  if v_job.status = 'cancelled' then
    return true;
  end if;
  if v_job.status in ('succeeded', 'rejected') then
    return false;
  end if;

  update public.media_processing_jobs
  set status = 'cancelled',
      failure_code = p_failure_code,
      failure_class = 'cancelled',
      cancelled_at = now(),
      completed_at = now(),
      locked_at = null,
      locked_by = null,
      lock_expires_at = null,
      heartbeat_at = null,
      claim_token = null,
      lease_generation = lease_generation + 1,
      updated_at = now()
  where id = p_job_id;

  update public.media_assets
  set status = 'cancelled',
      failure_code = p_failure_code,
      failure_reason = p_failure_code,
      source_cleanup_after = now(),
      updated_at = now()
  where id = v_job.asset_id
    and status <> 'ready';

  insert into public.media_processing_events (
    job_id, asset_id, event_type, failure_code, worker_id, lease_generation
  ) values (
    v_job.id, v_job.asset_id, 'cancelled', p_failure_code,
    left(coalesce(nullif(btrim(p_operator), ''), 'operator'), 120),
    v_job.lease_generation + 1
  );
  return true;
end;
$$;

revoke all on function public.cancel_media_processing_job(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cancel_media_processing_job(uuid, text, text) to service_role;

create or replace function public.cancel_media_jobs_for_frozen_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.account_status = 'deleting' and (
    old.account_status is distinct from new.account_status
    or old.deletion_started_at is distinct from new.deletion_started_at
  ) then
    update public.media_processing_jobs job
    set status = 'cancelled',
        failure_code = 'account_deleting',
        failure_class = 'cancelled',
        cancelled_at = now(),
        completed_at = now(),
        locked_at = null,
        locked_by = null,
        lock_expires_at = null,
        heartbeat_at = null,
        claim_token = null,
        lease_generation = lease_generation + 1,
        updated_at = now()
    from public.media_assets asset
    where job.asset_id = asset.id
      and asset.owner_id = new.id
      and job.status in ('queued', 'running', 'retry_wait', 'dead_letter');

    update public.media_assets
    set status = case when status = 'ready' then status else 'cancelled' end,
        failure_code = case when status = 'ready' then failure_code else 'account_deleting' end,
        failure_reason = case when status = 'ready' then failure_reason else 'account_deleting' end,
        source_cleanup_after = now(),
        updated_at = now()
    where owner_id = new.id
      and status <> 'ready';
  end if;
  return new;
end;
$$;

drop trigger if exists cancel_media_jobs_for_frozen_account_trigger on public.profiles;
create trigger cancel_media_jobs_for_frozen_account_trigger
after update of account_status, deletion_started_at
on public.profiles
for each row execute function public.cancel_media_jobs_for_frozen_account();

create or replace function public.claim_media_cleanup_assets(
  p_worker_id text,
  p_limit integer default 25,
  p_lease_seconds integer default 120
)
returns table (
  asset_id uuid,
  cleanup_token uuid,
  cleanup_kind text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_worker_id is null or btrim(p_worker_id) = '' or length(p_worker_id) > 120 then
    raise exception 'media_worker_id_invalid' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 100 or p_lease_seconds < 15 or p_lease_seconds > 900 then
    raise exception 'media_cleanup_configuration_invalid' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select asset.id,
      case
        when asset.status = 'ready' and asset.consumed_at is not null then 'source'
        when asset.status = 'ready' and asset.consumed_at is null and asset.created_at <= now() - interval '7 days' then 'abandoned'
        when asset.status in ('created', 'failed', 'rejected', 'expired', 'abandoned', 'cancelled') then 'terminal'
        else 'source'
      end as cleanup_kind
    from public.media_assets asset
    where asset.cleanup_attempts < 10
      and asset.cleanup_next_attempt_at <= now()
      and (asset.cleanup_lock_expires_at is null or asset.cleanup_lock_expires_at <= now())
      and (
        (asset.status = 'created' and asset.expires_at <= now())
        or
        (asset.status = 'ready' and asset.consumed_at is not null
          and asset.source_deleted_at is null and asset.source_cleanup_after <= now())
        or
        (asset.status = 'ready' and asset.consumed_at is null
          and asset.created_at <= now() - interval '7 days')
        or
        (asset.status in ('failed', 'rejected', 'expired', 'abandoned', 'cancelled')
          and coalesce(asset.source_cleanup_after, asset.updated_at + interval '24 hours') <= now())
      )
    order by asset.cleanup_next_attempt_at, asset.created_at, asset.id
    for update of asset skip locked
    limit p_limit
  ),
  claimed as (
    update public.media_assets asset
    set cleanup_attempts = asset.cleanup_attempts + 1,
        cleanup_locked_by = left(btrim(p_worker_id), 120),
        cleanup_lock_expires_at = now() + make_interval(secs => p_lease_seconds),
        cleanup_token = gen_random_uuid(),
        status = case when candidates.cleanup_kind = 'abandoned' then 'abandoned'
          when asset.status = 'created' then 'expired'
          else asset.status
        end,
        updated_at = now()
    from candidates
    where asset.id = candidates.id
    returning asset.id, asset.cleanup_token, candidates.cleanup_kind
  ),
  events as (
    insert into public.media_processing_events (
      asset_id, event_type, worker_id, details
    )
    select claimed.id, 'cleanup_claimed', left(btrim(p_worker_id), 120),
      jsonb_build_object('kind', claimed.cleanup_kind)
    from claimed
    returning public.media_processing_events.asset_id as event_asset_id
  )
  select claimed.id, claimed.cleanup_token, claimed.cleanup_kind
  from claimed;
end;
$$;

revoke all on function public.claim_media_cleanup_assets(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_media_cleanup_assets(text, integer, integer) to service_role;

create or replace function public.complete_media_cleanup_asset(
  p_asset_id uuid,
  p_worker_id text,
  p_cleanup_token uuid,
  p_cleanup_kind text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_cleanup_kind not in ('source', 'terminal', 'abandoned') then
    raise exception 'media_cleanup_kind_invalid' using errcode = '22023';
  end if;

  if p_cleanup_kind = 'source' then
    update public.media_assets
    set source_deleted_at = now(),
        cleanup_locked_by = null,
        cleanup_lock_expires_at = null,
        cleanup_token = null,
        updated_at = now()
    where id = p_asset_id
      and cleanup_locked_by = p_worker_id
      and cleanup_token = p_cleanup_token
      and cleanup_lock_expires_at > now();
    if not found then
      return false;
    end if;
  else
    delete from public.media_assets
    where id = p_asset_id
      and cleanup_locked_by = p_worker_id
      and cleanup_token = p_cleanup_token
      and cleanup_lock_expires_at > now()
      and consumed_at is null;
    if not found then
      return false;
    end if;
  end if;

  insert into public.media_processing_events (
    asset_id, event_type, worker_id, details
  ) values (
    p_asset_id, 'cleanup_succeeded', left(p_worker_id, 120),
    jsonb_build_object('kind', p_cleanup_kind)
  );
  return true;
end;
$$;

revoke all on function public.complete_media_cleanup_asset(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_media_cleanup_asset(uuid, text, uuid, text) to service_role;

create or replace function public.fail_media_cleanup_asset(
  p_asset_id uuid,
  p_worker_id text,
  p_cleanup_token uuid,
  p_failure_code text default 'storage_temporarily_unavailable'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_failure_code !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'media_failure_code_invalid' using errcode = '22023';
  end if;

  update public.media_assets
  set cleanup_locked_by = null,
      cleanup_lock_expires_at = null,
      cleanup_token = null,
      cleanup_next_attempt_at = now() + make_interval(
        secs => least(3600, 30 * (2 ^ least(cleanup_attempts, 6)))
      ),
      failure_code = case when status = 'ready' then failure_code else p_failure_code end,
      updated_at = now()
  where id = p_asset_id
    and cleanup_locked_by = p_worker_id
    and cleanup_token = p_cleanup_token
  returning cleanup_attempts into v_attempts;

  if v_attempts is null then
    return false;
  end if;

  insert into public.media_processing_events (
    asset_id, event_type, failure_code, worker_id, details
  ) values (
    p_asset_id, 'cleanup_failed', p_failure_code, left(p_worker_id, 120),
    jsonb_build_object('attempt', v_attempts)
  );
  return true;
end;
$$;

revoke all on function public.fail_media_cleanup_asset(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.fail_media_cleanup_asset(uuid, text, uuid, text) to service_role;

create or replace function public.ensure_media_processing_job_after_upload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'uploaded' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.media_processing_jobs (
      asset_id, job_type, status, attempts, max_attempts,
      next_retry_at, next_attempt_at, created_at, updated_at
    ) values (
      new.id,
      case when new.media_type = 'image' then 'image_derivatives' else 'video_derivatives' end,
      'queued', 0, 5, now(), now(), now(), now()
    )
    on conflict (asset_id, job_type) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_media_processing_job_after_upload_trigger on public.media_assets;
create trigger ensure_media_processing_job_after_upload_trigger
after insert or update of status
on public.media_assets
for each row execute function public.ensure_media_processing_job_after_upload();


comment on function public.claim_media_processing_jobs(text, integer, integer, integer) is
  'Service-only atomic leased claim. Reclaims expired running jobs and returns a fencing token.';
comment on function public.complete_media_processing_job(uuid, text, bigint, uuid, integer, integer, integer) is
  'Service-only authoritative completion fenced by worker, lease generation and claim token.';
comment on function public.fail_media_processing_job(uuid, text, bigint, uuid, text, text, integer, integer) is
  'Service-only sanitized retry/rejection/dead-letter transition with capped deterministic jitter.';
comment on table public.media_processing_events is
  'Sanitized media-worker audit and metric events. Never store paths, URLs, credentials or provider errors.';
