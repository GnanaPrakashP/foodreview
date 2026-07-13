-- Phase 7: durable production operations, push receipts, scheduler health and
-- read-only operational visibility. All state is service-owned and bounded.

alter table public.push_tokens
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_reason text;

alter table public.push_tokens drop constraint if exists push_tokens_disabled_reason_check;
alter table public.push_tokens add constraint push_tokens_disabled_reason_check
  check (disabled_reason is null or disabled_reason ~ '^[a-z0-9_]{1,80}$');

create index if not exists push_tokens_active_owner_idx
  on public.push_tokens(user_id, updated_at desc)
  where disabled_at is null;

create table if not exists public.push_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  notification_id uuid references public.notifications(id) on delete set null,
  push_token_id uuid not null references public.push_tokens(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null,
  status text not null default 'queued',
  provider_ticket_id text unique,
  attempts integer not null default 0,
  receipt_attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  receipt_after_at timestamptz,
  locked_by text,
  lock_expires_at timestamptz,
  claim_token uuid,
  correlation_id text,
  last_error_code text,
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_delivery_jobs_dedupe_check check (dedupe_key ~ '^[a-f0-9]{64}$'),
  constraint push_delivery_jobs_notification_type_check check (notification_type ~ '^[A-Z0-9_]{1,80}$'),
  constraint push_delivery_jobs_status_check check (status in (
    'queued', 'sending', 'retry_wait', 'receipt_pending', 'receipt_processing',
    'delivered', 'permanent_failure', 'dead_letter'
  )),
  constraint push_delivery_jobs_attempts_check check (
    attempts between 0 and 20 and receipt_attempts between 0 and 20 and max_attempts between 1 and 20
  ),
  constraint push_delivery_jobs_ticket_check check (
    provider_ticket_id is null or (length(provider_ticket_id) between 8 and 200 and provider_ticket_id ~ '^[A-Za-z0-9._:-]+$')
  ),
  constraint push_delivery_jobs_worker_check check (
    locked_by is null or (length(locked_by) between 1 and 120 and locked_by ~ '^[A-Za-z0-9._:-]+$')
  ),
  constraint push_delivery_jobs_correlation_check check (
    correlation_id is null or (length(correlation_id) between 8 and 80 and correlation_id ~ '^[A-Za-z0-9._:-]+$')
  ),
  constraint push_delivery_jobs_error_check check (
    last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,80}$'
  ),
  constraint push_delivery_jobs_lease_check check (
    (status in ('sending', 'receipt_processing') and locked_by is not null and lock_expires_at is not null and claim_token is not null)
    or
    (status not in ('sending', 'receipt_processing') and locked_by is null and lock_expires_at is null and claim_token is null)
  )
);

create index if not exists push_delivery_jobs_send_claim_idx
  on public.push_delivery_jobs(status, next_attempt_at, lock_expires_at, created_at, id)
  where status in ('queued', 'retry_wait', 'sending');
create index if not exists push_delivery_jobs_receipt_claim_idx
  on public.push_delivery_jobs(status, receipt_after_at, lock_expires_at, sent_at, id)
  where status in ('receipt_pending', 'receipt_processing');
create index if not exists push_delivery_jobs_owner_created_idx
  on public.push_delivery_jobs(user_id, created_at desc);

alter table public.push_delivery_jobs enable row level security;
revoke all on table public.push_delivery_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.push_delivery_jobs to service_role;

create table if not exists public.operational_scheduler_heartbeats (
  job_name text primary key,
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  duration_ms integer,
  release text not null,
  next_expected_at timestamptz,
  safe_error_code text,
  run_id uuid,
  consecutive_failures integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint operational_scheduler_heartbeats_name_check check (
    length(job_name) between 1 and 80 and job_name ~ '^[a-z0-9][a-z0-9._:-]+$'
  ),
  constraint operational_scheduler_heartbeats_release_check check (
    length(release) between 1 and 120 and release ~ '^[A-Za-z0-9._:-]+$'
  ),
  constraint operational_scheduler_heartbeats_duration_check check (duration_ms is null or duration_ms between 0 and 86400000),
  constraint operational_scheduler_heartbeats_error_check check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,80}$'),
  constraint operational_scheduler_heartbeats_failure_check check (consecutive_failures between 0 and 1000000)
);

create index if not exists operational_scheduler_heartbeats_expected_idx
  on public.operational_scheduler_heartbeats(next_expected_at, last_succeeded_at);

create table if not exists public.operational_scheduler_runs (
  id uuid primary key,
  job_name text not null,
  status text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  duration_ms integer,
  release text not null,
  correlation_id text,
  safe_error_code text,
  created_at timestamptz not null default now(),
  constraint operational_scheduler_runs_name_check check (
    length(job_name) between 1 and 80 and job_name ~ '^[a-z0-9][a-z0-9._:-]+$'
  ),
  constraint operational_scheduler_runs_status_check check (status in ('started', 'succeeded', 'failed')),
  constraint operational_scheduler_runs_release_check check (
    length(release) between 1 and 120 and release ~ '^[A-Za-z0-9._:-]+$'
  ),
  constraint operational_scheduler_runs_correlation_check check (
    correlation_id is null or (length(correlation_id) between 8 and 80 and correlation_id ~ '^[A-Za-z0-9._:-]+$')
  ),
  constraint operational_scheduler_runs_error_check check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,80}$'),
  constraint operational_scheduler_runs_duration_check check (duration_ms is null or duration_ms between 0 and 86400000)
);

create index if not exists operational_scheduler_runs_job_created_idx
  on public.operational_scheduler_runs(job_name, created_at desc);
create index if not exists operational_scheduler_runs_retention_idx
  on public.operational_scheduler_runs(created_at, id);

alter table public.operational_scheduler_heartbeats enable row level security;
alter table public.operational_scheduler_runs enable row level security;
revoke all on table public.operational_scheduler_heartbeats from public, anon, authenticated;
revoke all on table public.operational_scheduler_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.operational_scheduler_heartbeats to service_role;
grant select, insert, update, delete on table public.operational_scheduler_runs to service_role;

alter table public.review_media_upload_intents
  add column if not exists moderation_attempts integer not null default 0,
  add column if not exists moderation_next_attempt_at timestamptz not null default now(),
  add column if not exists moderation_locked_by text,
  add column if not exists moderation_lock_expires_at timestamptz,
  add column if not exists moderation_claim_token uuid,
  add column if not exists moderation_last_error_code text;

alter table public.review_media_upload_intents drop constraint if exists review_media_intents_moderation_attempts_check;
alter table public.review_media_upload_intents add constraint review_media_intents_moderation_attempts_check
  check (moderation_attempts between 0 and 20);
alter table public.review_media_upload_intents drop constraint if exists review_media_intents_moderation_error_check;
alter table public.review_media_upload_intents add constraint review_media_intents_moderation_error_check
  check (moderation_last_error_code is null or moderation_last_error_code ~ '^[a-z0-9_]{1,80}$');
alter table public.review_media_upload_intents drop constraint if exists review_media_intents_moderation_lock_check;
alter table public.review_media_upload_intents add constraint review_media_intents_moderation_lock_check
  check (
    (moderation_claim_token is null and moderation_locked_by is null and moderation_lock_expires_at is null)
    or
    (moderation_claim_token is not null and moderation_locked_by is not null and moderation_lock_expires_at is not null)
  );

create index if not exists review_media_intents_moderation_claim_idx
  on public.review_media_upload_intents(moderation_status, moderation_next_attempt_at, moderation_lock_expires_at, created_at, id)
  where status = 'created' and moderation_status = 'pending';

create or replace function public.claim_push_delivery_jobs(
  p_worker_id text,
  p_limit integer default 50,
  p_lease_seconds integer default 120
)
returns setof public.push_delivery_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'claim_push_delivery_jobs_forbidden';
  end if;
  if p_worker_id is null or length(p_worker_id) not between 1 and 120 or p_worker_id !~ '^[A-Za-z0-9._:-]+$' then
    raise exception using errcode = '22023', message = 'push_worker_id_invalid';
  end if;
  return query
  with candidates as (
    select job.id
    from public.push_delivery_jobs job
    where (
      (job.status in ('queued', 'retry_wait') and job.next_attempt_at <= now())
      or (job.status = 'sending' and job.lock_expires_at <= now())
    )
    order by job.next_attempt_at, job.created_at, job.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  )
  update public.push_delivery_jobs job
  set status = 'sending',
      attempts = job.attempts + 1,
      locked_by = p_worker_id,
      lock_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 120), 30), 600)),
      claim_token = gen_random_uuid(),
      updated_at = now()
  from candidates
  where job.id = candidates.id
  returning job.*;
end;
$$;

create or replace function public.complete_push_delivery_ticket(
  p_job_id uuid,
  p_claim_token uuid,
  p_provider_ticket_id text,
  p_receipt_delay_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'complete_push_ticket_forbidden'; end if;
  if p_provider_ticket_id is null or length(p_provider_ticket_id) not between 8 and 200 or p_provider_ticket_id !~ '^[A-Za-z0-9._:-]+$' then
    raise exception using errcode = '22023', message = 'push_ticket_invalid';
  end if;
  update public.push_delivery_jobs
  set status = 'receipt_pending', provider_ticket_id = p_provider_ticket_id,
      receipt_after_at = now() + make_interval(secs => least(greatest(coalesce(p_receipt_delay_seconds, 900), 60), 86400)),
      sent_at = coalesce(sent_at, now()), locked_by = null, lock_expires_at = null,
      claim_token = null, last_error_code = null, updated_at = now()
  where id = p_job_id and status = 'sending' and claim_token = p_claim_token;
  return found;
end;
$$;

create or replace function public.fail_push_delivery_send(
  p_job_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_retryable boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_status text;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'fail_push_send_forbidden'; end if;
  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,80}$' then raise exception using errcode = '22023', message = 'push_error_code_invalid'; end if;
  update public.push_delivery_jobs job
  set status = case when p_retryable and job.attempts < job.max_attempts then 'retry_wait'
                    when p_retryable then 'dead_letter' else 'permanent_failure' end,
      next_attempt_at = case when p_retryable and job.attempts < job.max_attempts
        then now() + make_interval(secs => least(900, 15 * (2 ^ least(job.attempts, 6))::integer)) else job.next_attempt_at end,
      last_error_code = p_error_code,
      completed_at = case when not p_retryable or job.attempts >= job.max_attempts then now() else null end,
      locked_by = null, lock_expires_at = null, claim_token = null, updated_at = now()
  where job.id = p_job_id and job.status = 'sending' and job.claim_token = p_claim_token
  returning status into v_status;
  return v_status;
end;
$$;

create or replace function public.claim_push_receipt_jobs(
  p_worker_id text,
  p_limit integer default 100,
  p_lease_seconds integer default 120
)
returns setof public.push_delivery_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'claim_push_receipts_forbidden'; end if;
  if p_worker_id is null or length(p_worker_id) not between 1 and 120 or p_worker_id !~ '^[A-Za-z0-9._:-]+$' then
    raise exception using errcode = '22023', message = 'push_worker_id_invalid';
  end if;
  return query
  with candidates as (
    select job.id from public.push_delivery_jobs job
    where (job.status = 'receipt_pending' and job.receipt_after_at <= now())
       or (job.status = 'receipt_processing' and job.lock_expires_at <= now())
    order by job.receipt_after_at, job.sent_at, job.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 1000)
  )
  update public.push_delivery_jobs job
  set status = 'receipt_processing', receipt_attempts = job.receipt_attempts + 1,
      locked_by = p_worker_id,
      lock_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 120), 30), 600)),
      claim_token = gen_random_uuid(), updated_at = now()
  from candidates where job.id = candidates.id
  returning job.*;
end;
$$;

create or replace function public.complete_push_delivery_receipt(
  p_job_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_error_code text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_status text;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'complete_push_receipt_forbidden'; end if;
  if p_outcome not in ('delivered', 'temporary_failure', 'permanent_failure', 'device_not_registered') then
    raise exception using errcode = '22023', message = 'push_receipt_outcome_invalid';
  end if;
  if p_error_code is not null and p_error_code !~ '^[a-z0-9_]{1,80}$' then
    raise exception using errcode = '22023', message = 'push_error_code_invalid';
  end if;
  update public.push_delivery_jobs job
  set status = case
        when p_outcome = 'delivered' then 'delivered'
        when p_outcome = 'temporary_failure' and job.receipt_attempts < job.max_attempts then 'receipt_pending'
        when p_outcome = 'temporary_failure' then 'dead_letter'
        else 'permanent_failure' end,
      receipt_after_at = case when p_outcome = 'temporary_failure' and job.receipt_attempts < job.max_attempts
        then now() + make_interval(secs => least(3600, 60 * (2 ^ least(job.receipt_attempts, 6))::integer)) else job.receipt_after_at end,
      last_error_code = p_error_code,
      completed_at = case when p_outcome = 'delivered' or p_outcome <> 'temporary_failure' or job.receipt_attempts >= job.max_attempts then now() else null end,
      locked_by = null, lock_expires_at = null, claim_token = null, updated_at = now()
  where job.id = p_job_id and job.status = 'receipt_processing' and job.claim_token = p_claim_token
  returning status into v_status;
  if p_outcome = 'device_not_registered' and v_status is not null then
    update public.push_tokens token
    set disabled_at = now(), disabled_reason = 'device_not_registered', updated_at = now()
    from public.push_delivery_jobs job
    where job.id = p_job_id and token.id = job.push_token_id;
  end if;
  return v_status;
end;
$$;

create or replace function public.record_scheduler_run(
  p_job_name text,
  p_run_id uuid,
  p_state text,
  p_release text,
  p_next_expected_at timestamptz default null,
  p_duration_ms integer default null,
  p_error_code text default null,
  p_correlation_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'record_scheduler_run_forbidden'; end if;
  if p_state not in ('started', 'succeeded', 'failed') then raise exception using errcode = '22023', message = 'scheduler_state_invalid'; end if;
  if p_job_name is null or length(p_job_name) not between 1 and 80 or p_job_name !~ '^[a-z0-9][a-z0-9._:-]+$' then raise exception using errcode = '22023', message = 'scheduler_job_name_invalid'; end if;
  if p_release is null or length(p_release) not between 1 and 120 or p_release !~ '^[A-Za-z0-9._:-]+$' then raise exception using errcode = '22023', message = 'scheduler_release_invalid'; end if;
  if p_error_code is not null and p_error_code !~ '^[a-z0-9_]{1,80}$' then raise exception using errcode = '22023', message = 'scheduler_error_invalid'; end if;

  insert into public.operational_scheduler_runs(id, job_name, status, started_at, finished_at, duration_ms, release, correlation_id, safe_error_code)
  values (p_run_id, p_job_name, p_state, now(), case when p_state = 'started' then null else now() end,
          p_duration_ms, p_release, p_correlation_id, p_error_code)
  on conflict (id) do update set
    status = excluded.status,
    finished_at = case when excluded.status = 'started' then public.operational_scheduler_runs.finished_at else now() end,
    duration_ms = excluded.duration_ms,
    safe_error_code = excluded.safe_error_code;

  insert into public.operational_scheduler_heartbeats(
    job_name, last_started_at, last_succeeded_at, last_failed_at, duration_ms, release,
    next_expected_at, safe_error_code, run_id, consecutive_failures, updated_at
  ) values (
    p_job_name, now(), case when p_state = 'succeeded' then now() end,
    case when p_state = 'failed' then now() end, p_duration_ms, p_release,
    p_next_expected_at, p_error_code, p_run_id, case when p_state = 'failed' then 1 else 0 end, now()
  ) on conflict (job_name) do update set
    last_started_at = case when p_state = 'started' then now() else public.operational_scheduler_heartbeats.last_started_at end,
    last_succeeded_at = case when p_state = 'succeeded' then now() else public.operational_scheduler_heartbeats.last_succeeded_at end,
    last_failed_at = case when p_state = 'failed' then now() else public.operational_scheduler_heartbeats.last_failed_at end,
    duration_ms = p_duration_ms,
    release = p_release,
    next_expected_at = coalesce(p_next_expected_at, public.operational_scheduler_heartbeats.next_expected_at),
    safe_error_code = case when p_state = 'succeeded' then null else p_error_code end,
    run_id = p_run_id,
    consecutive_failures = case when p_state = 'failed' then public.operational_scheduler_heartbeats.consecutive_failures + 1
                                when p_state = 'succeeded' then 0
                                else public.operational_scheduler_heartbeats.consecutive_failures end,
    updated_at = now();
end;
$$;

create or replace function public.record_service_heartbeat(
  p_job_name text,
  p_state text,
  p_release text,
  p_interval_seconds integer,
  p_duration_ms integer default null,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'record_service_heartbeat_forbidden'; end if;
  if p_state not in ('succeeded', 'failed') then raise exception using errcode = '22023', message = 'heartbeat_state_invalid'; end if;
  insert into public.operational_scheduler_heartbeats(
    job_name, last_started_at, last_succeeded_at, last_failed_at, duration_ms, release,
    next_expected_at, safe_error_code, run_id, consecutive_failures, updated_at
  ) values (
    p_job_name, now(), case when p_state = 'succeeded' then now() end,
    case when p_state = 'failed' then now() end, p_duration_ms, p_release,
    now() + make_interval(secs => least(greatest(coalesce(p_interval_seconds, 60), 5), 86400)),
    p_error_code, gen_random_uuid(), case when p_state = 'failed' then 1 else 0 end, now()
  ) on conflict (job_name) do update set
    last_started_at = now(),
    last_succeeded_at = case when p_state = 'succeeded' then now() else public.operational_scheduler_heartbeats.last_succeeded_at end,
    last_failed_at = case when p_state = 'failed' then now() else public.operational_scheduler_heartbeats.last_failed_at end,
    duration_ms = p_duration_ms, release = p_release,
    next_expected_at = now() + make_interval(secs => least(greatest(coalesce(p_interval_seconds, 60), 5), 86400)),
    safe_error_code = case when p_state = 'succeeded' then null else p_error_code end,
    run_id = gen_random_uuid(),
    consecutive_failures = case when p_state = 'failed' then public.operational_scheduler_heartbeats.consecutive_failures + 1 else 0 end,
    updated_at = now();
end;
$$;

create or replace function public.claim_review_moderation_intents(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns setof public.review_media_upload_intents
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'claim_review_moderation_forbidden'; end if;
  return query
  with candidates as (
    select intent.id from public.review_media_upload_intents intent
    where intent.status = 'created' and intent.moderation_status = 'pending'
      and intent.expires_at > now() and intent.moderation_next_attempt_at <= now()
      and (intent.moderation_lock_expires_at is null or intent.moderation_lock_expires_at <= now())
    order by intent.created_at, intent.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
  )
  update public.review_media_upload_intents intent
  set moderation_attempts = intent.moderation_attempts + 1,
      moderation_locked_by = p_worker_id,
      moderation_lock_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 120), 30), 600)),
      moderation_claim_token = gen_random_uuid()
  from candidates where intent.id = candidates.id
  returning intent.*;
end;
$$;

create or replace function public.complete_review_moderation_intent(
  p_intent_id uuid,
  p_claim_token uuid,
  p_decision text,
  p_reason_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'complete_review_moderation_forbidden'; end if;
  if p_decision not in ('approved', 'rejected', 'pending') then raise exception using errcode = '22023', message = 'moderation_decision_invalid'; end if;
  update public.review_media_upload_intents intent
  set moderation_status = p_decision,
      moderation_reason = p_reason_code,
      moderation_last_error_code = case when p_decision = 'pending' then coalesce(p_reason_code, 'provider_unavailable') else null end,
      moderation_next_attempt_at = case when p_decision = 'pending'
        then now() + make_interval(secs => least(3600, 30 * (2 ^ least(intent.moderation_attempts, 7))::integer))
        else intent.moderation_next_attempt_at end,
      status = case when p_decision = 'rejected' then 'rejected' else intent.status end,
      finalized_at = case when p_decision = 'rejected' then now() else intent.finalized_at end,
      moderation_locked_by = null, moderation_lock_expires_at = null, moderation_claim_token = null
  where intent.id = p_intent_id and intent.moderation_claim_token = p_claim_token;
  return found;
end;
$$;

create or replace function public.cleanup_observability_operations(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
declare v_push integer := 0;
declare v_runs integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'cleanup_observability_forbidden'; end if;
  with doomed as (
    select id from public.push_delivery_jobs
    where (status = 'delivered' and completed_at < now() - interval '30 days')
       or (status in ('permanent_failure', 'dead_letter') and completed_at < now() - interval '90 days')
    order by completed_at, id limit v_limit
  ) delete from public.push_delivery_jobs job using doomed where job.id = doomed.id;
  get diagnostics v_push = row_count;
  with doomed as (
    select id from public.operational_scheduler_runs
    where created_at < now() - interval '30 days'
    order by created_at, id limit v_limit
  ) delete from public.operational_scheduler_runs run using doomed where run.id = doomed.id;
  get diagnostics v_runs = row_count;
  return jsonb_build_object('pushJobsDeleted', v_push, 'schedulerRunsDeleted', v_runs);
end;
$$;

create or replace function public.cleanup_disabled_push_tokens(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_deleted integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'cleanup_disabled_push_tokens_forbidden'; end if;
  with doomed as (
    select token.id from public.push_tokens token
    where token.disabled_at < now() - interval '30 days'
    order by token.disabled_at, token.id
    limit least(greatest(coalesce(p_limit, 500), 1), 5000)
  ) delete from public.push_tokens token using doomed where token.id = doomed.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.reconcile_push_delivery_jobs(
  p_apply boolean default false,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_candidates integer := 0;
declare v_requeued integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'reconcile_push_delivery_jobs_forbidden';
  end if;

  select count(*) into v_candidates
  from public.push_delivery_jobs
  where status in ('sending', 'receipt_processing')
    and lock_expires_at < now();

  if p_apply then
    with stale as (
      select id
      from public.push_delivery_jobs
      where status in ('sending', 'receipt_processing')
        and lock_expires_at < now()
      order by lock_expires_at, id
      limit least(greatest(coalesce(p_limit, 500), 1), 5000)
      for update skip locked
    )
    update public.push_delivery_jobs job
    set status = case when job.provider_ticket_id is null then 'retry_wait' else 'receipt_pending' end,
        next_attempt_at = case when job.provider_ticket_id is null then now() else job.next_attempt_at end,
        receipt_after_at = case when job.provider_ticket_id is null then job.receipt_after_at else now() end,
        locked_by = null,
        lock_expires_at = null,
        claim_token = null,
        updated_at = now()
    from stale
    where job.id = stale.id;
    get diagnostics v_requeued = row_count;
  end if;

  return jsonb_build_object(
    'apply', p_apply,
    'staleLeaseCandidates', v_candidates,
    'requeued', v_requeued
  );
end;
$$;

create or replace function public.production_operations_health()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, supabase_migrations
as $$
declare v_result jsonb;
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'production_operations_health_forbidden'; end if;
  select jsonb_build_object(
    'migrationHead', (select max(version) from supabase_migrations.schema_migrations),
    'database', jsonb_build_object(
      'sizeBytes', pg_database_size(current_database()),
      'connections', (select count(*) from pg_stat_activity where datname = current_database()),
      'maxConnections', current_setting('max_connections')::integer,
      'waitingConnections', (select count(*) from pg_stat_activity where datname = current_database() and state = 'active' and wait_event is not null),
      'lockWaitConnections', (select count(*) from pg_stat_activity where datname = current_database() and state = 'active' and wait_event_type = 'Lock'),
      'invalidIndexes', (select count(*) from pg_index idx join pg_class rel on rel.oid = idx.indrelid join pg_namespace n on n.oid = rel.relnamespace where n.nspname = 'public' and not idx.indisvalid),
      'unvalidatedConstraints', (select count(*) from pg_constraint con join pg_class rel on rel.oid = con.conrelid join pg_namespace n on n.oid = rel.relnamespace where n.nspname = 'public' and not con.convalidated)
    ),
    'media', jsonb_build_object(
      'queued', (select count(*) from public.media_processing_jobs where status = 'queued'),
      'running', (select count(*) from public.media_processing_jobs where status = 'running'),
      'retryWait', (select count(*) from public.media_processing_jobs where status = 'retry_wait'),
      'deadLetter', (select count(*) from public.media_processing_jobs where status = 'dead_letter'),
      'imageDeadLetter', (select count(*) from public.media_processing_jobs where status = 'dead_letter' and job_type = 'image_derivatives'),
      'videoDeadLetter', (select count(*) from public.media_processing_jobs where status = 'dead_letter' and job_type = 'video_derivatives'),
      'leaseReclaims24h', (select count(*) from public.media_processing_events where event_type = 'lease_reclaimed' and created_at >= now() - interval '24 hours'),
      'processingFailures24h', (select count(*) from public.media_processing_events where event_type in ('retry_scheduled', 'rejected', 'dead_lettered') and created_at >= now() - interval '24 hours'),
      'cleanupFailures24h', (select count(*) from public.media_processing_events where event_type = 'cleanup_failed' and created_at >= now() - interval '24 hours'),
      'workerHeartbeatMissed', case when exists (
        select 1 from public.operational_scheduler_heartbeats
        where job_name = 'media-processing'
          and last_succeeded_at is not null
          and next_expected_at >= now()
      ) then 0 else 1 end,
      'oldestQueuedAgeSeconds', coalesce((select extract(epoch from now() - min(created_at))::bigint from public.media_processing_jobs where status in ('queued', 'retry_wait')), 0),
      'readyUnattached', (select count(*) from public.media_assets where status = 'ready' and consumed_at is null)
    ),
    'accountDeletion', jsonb_build_object(
      'failed', (select count(*) from public.account_deletion_jobs where status = 'failed'),
      'pending', (select count(*) from public.account_deletion_jobs where status <> 'completed'),
      'oldestPendingAgeSeconds', coalesce((select extract(epoch from now() - min(created_at))::bigint from public.account_deletion_jobs where status <> 'completed'), 0),
      'frozenAccounts', (select count(*) from public.profiles where account_status = 'deleting'),
      'unresolvedAmbiguities', (select count(*) from public.account_deletion_ambiguous_items where resolved_at is null)
    ),
    'moderation', jsonb_build_object(
      'pending', (select count(*) from public.review_media_upload_intents where moderation_status = 'pending' and status = 'created'),
      'oldestPendingAgeSeconds', coalesce((select extract(epoch from now() - min(created_at))::bigint from public.review_media_upload_intents where moderation_status = 'pending' and status = 'created'), 0),
      'approved', (select count(*) from public.review_media_upload_intents where moderation_status = 'approved'),
      'rejected', (select count(*) from public.review_media_upload_intents where moderation_status = 'rejected'),
      'uncertain', (select count(*) from public.review_media_upload_intents where moderation_status = 'pending' and moderation_last_error_code is not null),
      'providerFailures', (select count(*) from public.review_media_upload_intents where moderation_last_error_code in ('provider_unavailable', 'provider_unconfigured')),
      'quarantinedObjects', (select count(*) from storage.objects where bucket_id = 'review-media-quarantine')
    ),
    'push', jsonb_build_object(
      'queued', (select count(*) from public.push_delivery_jobs where status in ('queued', 'retry_wait', 'sending')),
      'receiptBacklog', (select count(*) from public.push_delivery_jobs where status in ('receipt_pending', 'receipt_processing')),
      'deadLetter', (select count(*) from public.push_delivery_jobs where status = 'dead_letter'),
      'permanentFailure', (select count(*) from public.push_delivery_jobs where status = 'permanent_failure'),
      'disabledTokens', (select count(*) from public.push_tokens where disabled_at is not null),
      'disabledTokensRecent', (select count(*) from public.push_tokens where disabled_at >= now() - interval '15 minutes'),
      'deliveredRecent', (select count(*) from public.push_delivery_jobs where status = 'delivered' and updated_at >= now() - interval '15 minutes'),
      'permanentFailureRecent', (select count(*) from public.push_delivery_jobs where status in ('permanent_failure', 'dead_letter') and updated_at >= now() - interval '15 minutes'),
      'oldestReceiptAgeSeconds', coalesce((select extract(epoch from now() - min(receipt_after_at))::bigint from public.push_delivery_jobs where status in ('receipt_pending', 'receipt_processing')), 0),
      'oldestQueuedAgeSeconds', coalesce((select extract(epoch from now() - min(created_at))::bigint from public.push_delivery_jobs where status in ('queued', 'retry_wait', 'sending')), 0)
    ),
    'scheduler', jsonb_build_object(
      'registeredJobs', (select count(*) from public.operational_scheduler_heartbeats),
      'missedJobs', (select count(*) from public.operational_scheduler_heartbeats where next_expected_at < now() and (last_succeeded_at is null or last_succeeded_at < next_expected_at)),
      'failingJobs', (select count(*) from public.operational_scheduler_heartbeats where consecutive_failures > 0)
    ),
    'operationalTables', jsonb_build_object(
      'rateLimitRows', (select count(*) from public.api_rate_limit_buckets),
      'idempotencyRows', (select count(*) from public.api_idempotency_records),
      'schedulerRunRows', (select count(*) from public.operational_scheduler_runs),
      'pushJobRows', (select count(*) from public.push_delivery_jobs)
    )
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.production_operations_contract()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_tables constant text[] := array['push_delivery_jobs', 'operational_scheduler_heartbeats', 'operational_scheduler_runs'];
declare v_functions constant text[] := array[
  'claim_push_delivery_jobs', 'complete_push_delivery_ticket', 'fail_push_delivery_send',
  'claim_push_receipt_jobs', 'complete_push_delivery_receipt', 'record_scheduler_run', 'record_service_heartbeat',
  'claim_review_moderation_intents', 'complete_review_moderation_intent',
  'cleanup_observability_operations', 'cleanup_disabled_push_tokens', 'reconcile_push_delivery_jobs',
  'production_operations_health'
];
begin
  if auth.role() <> 'service_role' then raise exception using errcode = '42501', message = 'production_operations_contract_forbidden'; end if;
  return jsonb_build_object(
    'missingTables', coalesce((select jsonb_agg(name order by name) from unnest(v_tables) name where to_regclass(format('public.%I', name)) is null), '[]'::jsonb),
    'rlsDisabledTables', coalesce((select jsonb_agg(rel.relname order by rel.relname) from pg_class rel join pg_namespace n on n.oid = rel.relnamespace where n.nspname = 'public' and rel.relname = any(v_tables) and not rel.relrowsecurity), '[]'::jsonb),
    'clientTableGrants', coalesce((select jsonb_agg(name order by name) from unnest(v_tables) name where has_table_privilege('anon', format('public.%I', name), 'select') or has_table_privilege('authenticated', format('public.%I', name), 'select')), '[]'::jsonb),
    'missingFunctions', coalesce((select jsonb_agg(name order by name) from unnest(v_functions) name where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = name)), '[]'::jsonb),
    'clientFunctionGrants', coalesce((select jsonb_agg(distinct p.proname order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any(v_functions) and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.claim_push_delivery_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_push_delivery_ticket(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.fail_push_delivery_send(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.claim_push_receipt_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_push_delivery_receipt(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.record_scheduler_run(text, uuid, text, text, timestamptz, integer, text, text) from public, anon, authenticated;
revoke all on function public.record_service_heartbeat(text, text, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.claim_review_moderation_intents(text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_review_moderation_intent(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.cleanup_observability_operations(integer) from public, anon, authenticated;
revoke all on function public.cleanup_disabled_push_tokens(integer) from public, anon, authenticated;
revoke all on function public.reconcile_push_delivery_jobs(boolean, integer) from public, anon, authenticated;
revoke all on function public.production_operations_health() from public, anon, authenticated;
revoke all on function public.production_operations_contract() from public, anon, authenticated;

grant execute on function public.claim_push_delivery_jobs(text, integer, integer) to service_role;
grant execute on function public.complete_push_delivery_ticket(uuid, uuid, text, integer) to service_role;
grant execute on function public.fail_push_delivery_send(uuid, uuid, text, boolean) to service_role;
grant execute on function public.claim_push_receipt_jobs(text, integer, integer) to service_role;
grant execute on function public.complete_push_delivery_receipt(uuid, uuid, text, text) to service_role;
grant execute on function public.record_scheduler_run(text, uuid, text, text, timestamptz, integer, text, text) to service_role;
grant execute on function public.record_service_heartbeat(text, text, text, integer, integer, text) to service_role;
grant execute on function public.claim_review_moderation_intents(text, integer, integer) to service_role;
grant execute on function public.complete_review_moderation_intent(uuid, uuid, text, text) to service_role;
grant execute on function public.cleanup_observability_operations(integer) to service_role;
grant execute on function public.cleanup_disabled_push_tokens(integer) to service_role;
grant execute on function public.reconcile_push_delivery_jobs(boolean, integer) to service_role;
grant execute on function public.production_operations_health() to service_role;
grant execute on function public.production_operations_contract() to service_role;

comment on table public.push_delivery_jobs is 'Service-only durable Expo push ticket and receipt state without notification bodies or tokens.';
comment on table public.operational_scheduler_heartbeats is 'Service-only latest scheduler execution health, one bounded row per job.';
comment on table public.operational_scheduler_runs is 'Service-only bounded scheduler execution audit retained for 30 days.';
comment on function public.production_operations_health() is 'Read-only service-role operational backlog, scheduler and database contract health without private identifiers.';
