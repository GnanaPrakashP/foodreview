-- Phase 4: durable mobile API abuse controls, install-bound push tokens,
-- moderation quarantine, and audited operator decisions.

create extension if not exists pgcrypto;

create table if not exists public.api_rate_limit_buckets (
  identifier_hash text not null,
  endpoint text not null,
  bucket_start timestamptz not null,
  window_seconds integer not null,
  used bigint not null default 0,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (identifier_hash, endpoint, bucket_start, window_seconds),
  constraint api_rate_limit_identifier_hash_check check (identifier_hash ~ '^[a-f0-9]{64}$'),
  constraint api_rate_limit_endpoint_check check (endpoint ~ '^[a-z0-9._:/-]{1,120}$'),
  constraint api_rate_limit_window_check check (window_seconds between 1 and 86400),
  constraint api_rate_limit_used_check check (used >= 0)
);

create index if not exists api_rate_limit_buckets_expiry_idx
  on public.api_rate_limit_buckets(expires_at);

alter table public.api_rate_limit_buckets enable row level security;
revoke all on table public.api_rate_limit_buckets from public, anon, authenticated;
grant all privileges on table public.api_rate_limit_buckets to service_role;

create or replace function public.consume_api_rate_limits(p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_identifier_hash text;
  v_endpoint text;
  v_window_seconds integer;
  v_limit bigint;
  v_cost bigint;
  v_bucket_start timestamptz;
  v_used bigint;
  v_remaining bigint := 9223372036854775807;
  v_retry_after integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) < 1 or jsonb_array_length(p_entries) > 8 then
    raise exception 'api_rate_limit_entries_invalid' using errcode = '22023';
  end if;

  -- Lock in a deterministic order so concurrent multi-dimension requests cannot deadlock.
  for v_entry in
    select value
    from jsonb_array_elements(p_entries)
    order by value->>'identifierHash', value->>'endpoint', value->>'windowSeconds'
  loop
    v_identifier_hash := v_entry->>'identifierHash';
    v_endpoint := v_entry->>'endpoint';
    v_window_seconds := (v_entry->>'windowSeconds')::integer;
    v_limit := (v_entry->>'limit')::bigint;
    v_cost := (v_entry->>'cost')::bigint;
    if v_identifier_hash !~ '^[a-f0-9]{64}$'
      or v_endpoint !~ '^[a-z0-9._:/-]{1,120}$'
      or v_window_seconds not between 1 and 86400
      or v_limit not between 1 and 1000000
      or v_cost not between 1 and v_limit then
      raise exception 'api_rate_limit_entry_invalid' using errcode = '22023';
    end if;
    v_bucket_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / v_window_seconds) * v_window_seconds);
    perform pg_advisory_xact_lock(hashtextextended(
      v_identifier_hash || ':' || v_endpoint || ':' || v_bucket_start::text || ':' || v_window_seconds::text,
      0
    ));
    insert into public.api_rate_limit_buckets (
      identifier_hash, endpoint, bucket_start, window_seconds, used, expires_at
    ) values (
      v_identifier_hash, v_endpoint, v_bucket_start, v_window_seconds, 0,
      v_bucket_start + make_interval(secs => v_window_seconds * 2)
    ) on conflict do nothing;
  end loop;

  -- Decide every dimension before consuming any of them.
  for v_entry in select value from jsonb_array_elements(p_entries)
  loop
    v_identifier_hash := v_entry->>'identifierHash';
    v_endpoint := v_entry->>'endpoint';
    v_window_seconds := (v_entry->>'windowSeconds')::integer;
    v_limit := (v_entry->>'limit')::bigint;
    v_cost := (v_entry->>'cost')::bigint;
    v_bucket_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / v_window_seconds) * v_window_seconds);
    select bucket.used into strict v_used
    from public.api_rate_limit_buckets bucket
    where bucket.identifier_hash = v_identifier_hash
      and bucket.endpoint = v_endpoint
      and bucket.bucket_start = v_bucket_start
      and bucket.window_seconds = v_window_seconds
    for update;
    if v_used + v_cost > v_limit then
      v_retry_after := greatest(1, ceil(extract(epoch from (v_bucket_start + make_interval(secs => v_window_seconds) - clock_timestamp())))::integer);
      return jsonb_build_object('allowed', false, 'remaining', 0, 'retryAfterSeconds', v_retry_after);
    end if;
    v_remaining := least(v_remaining, v_limit - v_used - v_cost);
  end loop;

  for v_entry in select value from jsonb_array_elements(p_entries)
  loop
    v_identifier_hash := v_entry->>'identifierHash';
    v_endpoint := v_entry->>'endpoint';
    v_window_seconds := (v_entry->>'windowSeconds')::integer;
    v_cost := (v_entry->>'cost')::bigint;
    v_bucket_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / v_window_seconds) * v_window_seconds);
    update public.api_rate_limit_buckets bucket
    set used = bucket.used + v_cost,
        updated_at = clock_timestamp()
    where bucket.identifier_hash = v_identifier_hash
      and bucket.endpoint = v_endpoint
      and bucket.bucket_start = v_bucket_start
      and bucket.window_seconds = v_window_seconds;
  end loop;

  return jsonb_build_object('allowed', true, 'remaining', v_remaining, 'retryAfterSeconds', 0);
end;
$$;

revoke all on function public.consume_api_rate_limits(jsonb) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limits(jsonb) to service_role;

create or replace function public.cleanup_api_security_state(p_limit integer default 5000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
  v_total integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 50000 then
    raise exception 'api_security_cleanup_limit_invalid' using errcode = '22023';
  end if;
  with doomed as (
    select ctid from public.api_rate_limit_buckets
    where expires_at <= now()
    order by expires_at
    limit p_limit
    for update skip locked
  )
  delete from public.api_rate_limit_buckets bucket
  using doomed
  where bucket.ctid = doomed.ctid;
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;
  with doomed as (
    select ctid from public.api_idempotency_records
    where expires_at <= now()
    order by expires_at
    limit greatest(0, p_limit - v_total)
    for update skip locked
  )
  delete from public.api_idempotency_records record
  using doomed
  where record.ctid = doomed.ctid;
  get diagnostics v_deleted = row_count;
  return v_total + v_deleted;
end;
$$;

revoke all on function public.cleanup_api_security_state(integer) from public, anon, authenticated;
grant execute on function public.cleanup_api_security_state(integer) to service_role;

create table if not exists public.api_idempotency_records (
  actor_hash text not null,
  endpoint text not null,
  key_hash text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (actor_hash, endpoint, key_hash),
  constraint api_idempotency_actor_hash_check check (actor_hash ~ '^[a-f0-9]{64}$'),
  constraint api_idempotency_key_hash_check check (key_hash ~ '^[a-f0-9]{64}$'),
  constraint api_idempotency_request_hash_check check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint api_idempotency_endpoint_check check (endpoint ~ '^[a-z0-9._:/-]{1,120}$'),
  constraint api_idempotency_status_check check (response_status is null or response_status between 200 and 599),
  constraint api_idempotency_response_check check ((response_status is null) = (response_body is null))
);

create index if not exists api_idempotency_records_expiry_idx
  on public.api_idempotency_records(expires_at);
alter table public.api_idempotency_records enable row level security;
revoke all on table public.api_idempotency_records from public, anon, authenticated;
grant all privileges on table public.api_idempotency_records to service_role;

-- Bind push registrations to the authoritative Auth user and one durable app install.
alter table public.push_tokens add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.push_tokens add column if not exists install_id uuid;

update public.push_tokens token
set user_id = profile.id
from public.profiles profile
where token.user_id is null and profile.username = token.user_name;

create or replace function public.enforce_push_token_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  select profile.username into v_username
  from public.profiles profile
  where profile.id = auth.uid()
    and profile.account_status = 'active'
    and profile.deletion_started_at is null;
  if v_username is null then
    raise exception 'active_profile_required' using errcode = '42501';
  end if;
  if new.install_id is null then
    raise exception 'install_id_required' using errcode = '22023';
  end if;
  if new.expo_push_token !~ '^ExponentPushToken\[[A-Za-z0-9_-]{1,200}\]$'
    and new.expo_push_token !~ '^ExpoPushToken\[[A-Za-z0-9_-]{1,200}\]$' then
    raise exception 'push_token_invalid' using errcode = '22023';
  end if;
  new.user_id := auth.uid();
  new.user_name := v_username;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists enforce_push_token_owner_trigger on public.push_tokens;
create trigger enforce_push_token_owner_trigger
before insert or update on public.push_tokens
for each row execute function public.enforce_push_token_owner();

drop policy if exists "Users can read own push tokens" on public.push_tokens;
create policy "Users can read own push tokens"
  on public.push_tokens for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "Users can create own push tokens" on public.push_tokens;
create policy "Users can create own push tokens"
  on public.push_tokens for insert to authenticated
  with check (user_id = auth.uid() and install_id is not null);
drop policy if exists "Users can update own push tokens" on public.push_tokens;
create policy "Users can update own push tokens"
  on public.push_tokens for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and install_id is not null);
drop policy if exists "Users can delete own push tokens" on public.push_tokens;
create policy "Users can delete own push tokens"
  on public.push_tokens for delete to authenticated
  using (user_id = auth.uid());

create index if not exists push_tokens_user_install_idx
  on public.push_tokens(user_id, install_id);

-- Generic pipeline media is private and unclaimable until moderation approves it.
alter table public.media_assets add column if not exists moderation_status text;
alter table public.media_assets add column if not exists moderation_reason_code text;
alter table public.media_assets add column if not exists moderated_at timestamptz;
alter table public.media_assets add column if not exists moderated_by text;

update public.media_assets
set moderation_status = case when status = 'ready' then 'approved' else 'pending' end
where moderation_status is null;

alter table public.media_assets alter column moderation_status set default 'pending';
alter table public.media_assets alter column moderation_status set not null;
alter table public.media_assets drop constraint if exists media_assets_moderation_status_check;
alter table public.media_assets add constraint media_assets_moderation_status_check
  check (moderation_status in ('pending', 'approved', 'rejected'));
alter table public.media_assets drop constraint if exists media_assets_moderation_reason_check;
alter table public.media_assets add constraint media_assets_moderation_reason_check
  check (moderation_reason_code is null or moderation_reason_code ~ '^[a-z0-9_]{1,80}$');

create index if not exists media_assets_moderation_queue_idx
  on public.media_assets(moderation_status, created_at, id)
  where moderation_status = 'pending';

create table if not exists public.media_moderation_actions (
  id bigint generated always as identity primary key,
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  action text not null,
  reason_code text,
  operator_hash text not null,
  created_at timestamptz not null default now(),
  constraint media_moderation_action_check check (action in ('approved', 'rejected')),
  constraint media_moderation_reason_check check (reason_code is null or reason_code ~ '^[a-z0-9_]{1,80}$'),
  constraint media_moderation_operator_hash_check check (operator_hash ~ '^[a-f0-9]{64}$')
);
alter table public.media_moderation_actions enable row level security;
revoke all on table public.media_moderation_actions from public, anon, authenticated;
grant all privileges on table public.media_moderation_actions to service_role;
grant usage, select on sequence public.media_moderation_actions_id_seq to service_role;

create or replace function public.apply_media_moderation_action(
  p_asset_id uuid,
  p_action text,
  p_reason_code text,
  p_operator_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_action not in ('approved', 'rejected')
    or p_operator_hash !~ '^[a-f0-9]{64}$'
    or (p_reason_code is not null and p_reason_code !~ '^[a-z0-9_]{1,80}$') then
    raise exception 'media_moderation_action_invalid' using errcode = '22023';
  end if;
  update public.media_assets asset
  set moderation_status = p_action,
      moderation_reason_code = p_reason_code,
      moderated_at = now(),
      moderated_by = p_operator_hash,
      status = case when p_action = 'rejected' then 'rejected' else asset.status end,
      updated_at = now()
  where asset.id = p_asset_id and asset.moderation_status = 'pending';
  get diagnostics v_changed = row_count;
  if v_changed = 0 then return false; end if;
  if p_action = 'rejected' then
    update public.media_processing_jobs
    set status = 'cancelled', failure_code = 'moderation_rejected', failure_class = 'terminal',
        completed_at = now(), updated_at = now()
    where asset_id = p_asset_id and status in ('queued', 'retry_wait');
  end if;
  insert into public.media_moderation_actions(asset_id, action, reason_code, operator_hash)
  values (p_asset_id, p_action, p_reason_code, p_operator_hash);
  return true;
end;
$$;

revoke all on function public.apply_media_moderation_action(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_media_moderation_action(uuid, text, text, text) to service_role;

drop policy if exists "Ready public media assets are readable" on public.media_assets;
create policy "Ready public media assets are readable"
  on public.media_assets for select to anon, authenticated
  using (visibility = 'public' and status = 'ready' and moderation_status = 'approved');
drop policy if exists "Public media derivatives are readable" on public.media_derivatives;
create policy "Public media derivatives are readable"
  on public.media_derivatives for select to anon, authenticated
  using (
    bucket_id = 'media-public'
    and exists (
      select 1 from public.media_assets asset
      where asset.id = media_derivatives.asset_id
        and asset.visibility = 'public'
        and asset.status = 'ready'
        and asset.moderation_status = 'approved'
    )
  );

-- Keep queued jobs quarantined until an explicit moderation action approves them.
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
  if p_limit < 1 or p_limit > 25 or p_lease_seconds < 15 or p_lease_seconds > 900
    or p_max_attempts < 1 or p_max_attempts > 20 then
    raise exception 'media_claim_parameters_invalid' using errcode = '22023';
  end if;

  update public.media_processing_jobs job
  set status = 'dead_letter', failure_code = 'retry_exhausted_after_worker_loss',
      failure_class = 'retryable', dead_lettered_at = now(), completed_at = now(),
      locked_at = null, locked_by = null, lock_expires_at = null,
      heartbeat_at = null, claim_token = null, updated_at = now()
  where job.status = 'running' and job.lock_expires_at <= now() and job.attempts >= job.max_attempts;

  return query
  with candidates as (
    select job.id, job.status = 'running' as was_stale
    from public.media_processing_jobs job
    join public.media_assets asset on asset.id = job.asset_id
    join public.profiles profile on profile.id = asset.owner_id
    where job.attempts < job.max_attempts
      and ((job.status in ('queued', 'retry_wait') and job.next_attempt_at <= now())
        or (job.status = 'running' and job.lock_expires_at <= now()))
      and asset.status in ('uploaded', 'processing')
      and asset.moderation_status = 'approved'
      and asset.consumed_at is null
      and profile.account_status = 'active'
      and profile.deletion_started_at is null
    order by case when job.status = 'running' then 0 else 1 end,
      coalesce(job.lock_expires_at, job.next_attempt_at), job.created_at, job.id
    for update of job skip locked
    limit p_limit
  ), claimed as (
    update public.media_processing_jobs job
    set status = 'running', attempts = job.attempts + 1, max_attempts = p_max_attempts,
        locked_at = now(), locked_by = left(btrim(p_worker_id), 120),
        lock_expires_at = now() + make_interval(secs => p_lease_seconds), heartbeat_at = now(),
        lease_generation = job.lease_generation + 1, claim_token = gen_random_uuid(),
        started_at = coalesce(job.started_at, now()), completed_at = null,
        failure_code = null, failure_class = null,
        stale_reclaims = job.stale_reclaims + case when candidates.was_stale then 1 else 0 end,
        updated_at = now()
    from candidates where job.id = candidates.id
    returning job.id, job.asset_id, job.job_type, job.attempts, job.max_attempts,
      job.lease_generation, job.claim_token, job.lock_expires_at, candidates.was_stale
  ), events as (
    insert into public.media_processing_events (job_id, asset_id, event_type, worker_id, lease_generation, details)
    select claimed.id, claimed.asset_id,
      case when claimed.was_stale then 'lease_reclaimed' else 'claimed' end,
      left(btrim(p_worker_id), 120), claimed.lease_generation,
      jsonb_build_object('attempt', claimed.attempts)
    from claimed returning job_id
  )
  select claimed.id, claimed.asset_id, claimed.job_type, claimed.attempts,
    claimed.max_attempts, claimed.lease_generation, claimed.claim_token,
    claimed.lock_expires_at, claimed.was_stale
  from claimed;
end;
$$;

revoke all on function public.claim_media_processing_jobs(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_media_processing_jobs(text, integer, integer, integer) to service_role;

-- Reports retain user-facing lifecycle states while operator actions are append-only.
alter table public.content_reports drop constraint if exists content_reports_status_check;
alter table public.content_reports add constraint content_reports_status_check
  check (status in ('open', 'reviewing', 'actioned', 'dismissed', 'appealed', 'resolved'));

create table if not exists public.moderation_report_actions (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.content_reports(id) on delete cascade,
  from_status text not null,
  to_status text not null,
  action_code text not null,
  operator_hash text not null,
  note text,
  created_at timestamptz not null default now(),
  constraint moderation_report_action_status_check check (to_status in ('reviewing', 'actioned', 'dismissed', 'appealed', 'resolved')),
  constraint moderation_report_action_code_check check (action_code ~ '^[a-z0-9_]{1,80}$'),
  constraint moderation_report_operator_hash_check check (operator_hash ~ '^[a-f0-9]{64}$'),
  constraint moderation_report_note_check check (note is null or char_length(note) <= 1000)
);
alter table public.moderation_report_actions enable row level security;
revoke all on table public.moderation_report_actions from public, anon, authenticated;
grant all privileges on table public.moderation_report_actions to service_role;
grant usage, select on sequence public.moderation_report_actions_id_seq to service_role;

create or replace function public.apply_report_moderation_action(
  p_report_id uuid,
  p_to_status text,
  p_action_code text,
  p_operator_hash text,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_to_status not in ('reviewing', 'actioned', 'dismissed', 'appealed', 'resolved')
    or p_action_code !~ '^[a-z0-9_]{1,80}$'
    or p_operator_hash !~ '^[a-f0-9]{64}$'
    or (p_note is not null and char_length(p_note) > 1000) then
    raise exception 'report_moderation_action_invalid' using errcode = '22023';
  end if;
  select report.status into v_from_status
  from public.content_reports report
  where report.id = p_report_id
  for update;
  if v_from_status is null then return false; end if;
  update public.content_reports
  set status = p_to_status,
      resolution_note = case when p_to_status in ('actioned', 'dismissed', 'resolved') then p_note else resolution_note end,
      resolved_at = case when p_to_status in ('actioned', 'dismissed', 'resolved') then now() else null end,
      updated_at = now()
  where id = p_report_id;
  insert into public.moderation_report_actions(
    report_id, from_status, to_status, action_code, operator_hash, note
  ) values (
    p_report_id, v_from_status, p_to_status, p_action_code, p_operator_hash, p_note
  );
  return true;
end;
$$;

revoke all on function public.apply_report_moderation_action(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_report_moderation_action(uuid, text, text, text, text) to service_role;

comment on table public.api_rate_limit_buckets is
  'Phase 4 atomic shared limiter. Identifiers are server-side HMAC hashes; raw IP, user, and install values are forbidden.';
comment on column public.media_assets.moderation_status is
  'Public media remains quarantined and unclaimable until an audited operator/provider decision approves it.';

-- Extend (rather than rewrite in place) the Phase 3 read-only production
-- contract so its established keys remain stable for existing automation.
alter function public.production_schema_contract() rename to production_schema_contract_phase3;
revoke all on function public.production_schema_contract_phase3() from public, anon, authenticated;
grant execute on function public.production_schema_contract_phase3() to service_role;

create or replace function public.production_schema_contract()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tables constant text[] := array[
    'api_rate_limit_buckets', 'api_idempotency_records',
    'media_moderation_actions', 'moderation_report_actions'
  ];
  v_functions constant text[] := array[
    'consume_api_rate_limits', 'cleanup_api_security_state',
    'apply_media_moderation_action', 'apply_report_moderation_action'
  ];
  v_phase3 jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  v_phase3 := public.production_schema_contract_phase3();
  return v_phase3 || jsonb_build_object(
    'missingApiSecurityTables', coalesce((
      select jsonb_agg(expected.name order by expected.name)
      from unnest(v_tables) expected(name)
      where to_regclass(format('public.%I', expected.name)) is null
    ), '[]'::jsonb),
    'rlsDisabledApiSecurityTables', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any(v_tables)
        and c.relkind = 'r' and not c.relrowsecurity
    ), '[]'::jsonb),
    'missingApiSecurityFunctions', coalesce((
      select jsonb_agg(expected.name order by expected.name)
      from unnest(v_functions) expected(name)
      where not exists (
        select 1 from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = expected.name
      )
    ), '[]'::jsonb),
    'clientApiSecurityFunctionGrants', coalesce((
      select jsonb_agg(distinct p.proname order by p.proname)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any(v_functions)
        and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'))
    ), '[]'::jsonb),
    'clientApiSecurityTableGrants', coalesce((
      select jsonb_agg(expected.name order by expected.name)
      from unnest(v_tables) expected(name)
      where has_table_privilege('anon', format('public.%I', expected.name), 'SELECT, INSERT, UPDATE, DELETE')
        or has_table_privilege('authenticated', format('public.%I', expected.name), 'SELECT, INSERT, UPDATE, DELETE')
    ), '[]'::jsonb),
    'unsafeApiSecurityDefiners', coalesce((
      select jsonb_agg(distinct p.proname order by p.proname)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any(v_functions) and p.prosecdef
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, array[]::text[])) setting
          where setting like 'search_path=%'
        )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.production_schema_contract() from public, anon, authenticated;
grant execute on function public.production_schema_contract() to service_role;
