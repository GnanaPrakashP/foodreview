-- OTP/onboarding authorization boundary hardening.
--
-- Authenticated clients may read profiles through RLS, but they may no longer
-- INSERT, UPDATE, or DELETE profile rows directly. Narrow SECURITY DEFINER RPCs
-- derive the owner from auth.uid() and write only explicitly user-editable
-- fields. Trust, lifecycle, deletion, media-link, counters, timestamps, and any
-- future profile columns remain server-owned by default.

-- ---------------------------------------------------------------------------
-- Canonical validation and completeness helpers.
-- ---------------------------------------------------------------------------

create or replace function public.profile_username_is_valid(p_username text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    p_username = lower(btrim(p_username))
    and p_username ~ '^[a-z0-9_]{3,20}$',
    false
  )
$$;

create or replace function public.profile_name_is_valid(p_first_name text, p_last_name text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    length(btrim(concat_ws(' ', nullif(btrim(p_first_name), ''), nullif(btrim(p_last_name), '')))) between 1 and 100
    and concat_ws(' ', p_first_name, p_last_name) !~ '[[:cntrl:]]',
    false
  )
$$;

create or replace function public.is_profile_complete(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.profiles profile
      where profile.id = p_user_id
        and profile.account_status = 'active'
        and profile.deletion_started_at is null
        and public.profile_name_is_valid(profile.first_name, profile.last_name)
        and public.profile_username_is_valid(profile.username)
        and profile.account_type in ('public', 'private')
    ),
    false
  )
$$;

revoke all on function public.profile_username_is_valid(text) from public, anon;
revoke all on function public.profile_name_is_valid(text, text) from public, anon;
revoke all on function public.is_profile_complete(uuid) from public, anon;
grant execute on function public.profile_username_is_valid(text) to authenticated, service_role;
grant execute on function public.profile_name_is_valid(text, text) to authenticated, service_role;
grant execute on function public.is_profile_complete(uuid) to authenticated, service_role;

comment on function public.is_profile_complete(uuid) is
  'Authoritative profile-completeness rule: active lifecycle, no deletion marker, non-empty normalized Name, valid normalized username, and valid account type.';

-- Email OTP and Google are the only supported production sign-in methods.
-- Supabase's email provider also exposes password endpoints, so hiding password
-- UI is not sufficient. This Custom Access Token Hook rejects password token
-- issuance before a password session can be established. Recovery UI,
-- callbacks, and APIs are removed separately; Supabase classifies recovery
-- verification tokens as OTP sessions. This hook is invoked
-- only by supabase_auth_admin and is not exposed through PostgREST.
create or replace function public.circlebites_access_token_hook(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if event->>'authentication_method' in ('password', 'recovery')
    or exists (
      select 1
      from jsonb_array_elements(coalesce(event->'claims'->'amr', '[]'::jsonb)) factor
      where factor->>'method' in ('password', 'recovery')
    )
  then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'This sign-in method is not supported. Use Google or an email verification code.'
      )
    );
  end if;

  return jsonb_build_object('claims', event->'claims');
end;
$$;

revoke all on function public.circlebites_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.circlebites_access_token_hook(jsonb) to supabase_auth_admin;

comment on function public.circlebites_access_token_hook(jsonb) is
  'Supabase Custom Access Token Hook: permits passwordless/OAuth tokens and rejects password token issuance.';

-- Existing policies call these helpers. An authenticated-but-incomplete account
-- is allowed to finish onboarding, but is not an active application actor.
create or replace function public.account_is_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_profile_complete(p_user_id)
$$;

create or replace function public.current_profile_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select profile.username
  from public.profiles profile
  where profile.id = auth.uid()
    and public.is_profile_complete(profile.id)
  limit 1
$$;

create or replace function public.review_owner_account_is_active(p_owner_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.profiles profile
      where profile.username = p_owner_name
        and public.is_profile_complete(profile.id)
    ),
    false
  )
$$;

revoke all on function public.account_is_active(uuid) from public;
revoke all on function public.current_profile_name() from public;
revoke all on function public.review_owner_account_is_active(text) from public;
grant execute on function public.account_is_active(uuid) to anon, authenticated, service_role;
grant execute on function public.current_profile_name() to anon, authenticated, service_role;
grant execute on function public.review_owner_account_is_active(text) to anon, authenticated, service_role;

-- Incomplete profiles are visible only to their owner so onboarding can resume.
-- Complete profiles remain readable to authenticated social features.
drop policy if exists "Profiles readable by authenticated users" on public.profiles;
drop policy if exists "Deleting profiles are suppressed" on public.profiles;
create policy "Profiles readable by authenticated users"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_profile_complete(id));

-- These former owner-write policies are intentionally removed. Even if a
-- future grant is broadened accidentally, RLS does not restore direct writes.
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

-- ---------------------------------------------------------------------------
-- Narrow authenticated profile mutations.
-- ---------------------------------------------------------------------------

create or replace function public.complete_current_profile(p_name text, p_username text)
returns setof public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g');
  v_username text := btrim(coalesce(p_username, ''));
  v_first_name text;
  v_last_name text;
  v_existing public.profiles%rowtype;
begin
  if v_uid is null or auth.role() <> 'authenticated' then
    raise exception 'profile_not_authenticated' using errcode = '28000';
  end if;
  if length(v_name) < 1 or length(v_name) > 100 or v_name ~ '[[:cntrl:]]' then
    raise exception 'profile_name_invalid' using errcode = '22023';
  end if;
  if not public.profile_username_is_valid(v_username) then
    raise exception 'username_invalid' using errcode = '22023';
  end if;

  v_first_name := split_part(v_name, ' ', 1);
  v_last_name := case
    when position(' ' in v_name) > 0 then substr(v_name, position(' ' in v_name) + 1)
    else ''
  end;

  select profile.* into v_existing
  from public.profiles profile
  where profile.id = v_uid
  for update;

  if found then
    if v_existing.account_status <> 'active' or v_existing.deletion_started_at is not null then
      raise exception 'profile_lifecycle_unavailable' using errcode = '42501';
    end if;

    if public.is_profile_complete(v_uid) then
      if lower(btrim(v_existing.username)) = v_username
        and regexp_replace(
          btrim(concat_ws(' ', nullif(btrim(v_existing.first_name), ''), nullif(btrim(v_existing.last_name), ''))),
          '[[:space:]]+',
          ' ',
          'g'
        ) = v_name
      then
        return query select profile.* from public.profiles profile where profile.id = v_uid;
        return;
      end if;
      raise exception 'profile_already_complete' using errcode = '42501';
    end if;

    update public.profiles
    set first_name = v_first_name,
        last_name = v_last_name,
        username = v_username
    where id = v_uid;
  else
    insert into public.profiles(id, first_name, last_name, username)
    values (v_uid, v_first_name, v_last_name, v_username);
  end if;

  if not public.is_profile_complete(v_uid) then
    raise exception 'profile_completion_failed' using errcode = '23514';
  end if;

  return query select profile.* from public.profiles profile where profile.id = v_uid;
exception
  when unique_violation then
    raise exception 'username_taken' using errcode = '23505';
end;
$$;

create or replace function public.update_current_profile_details(p_name text, p_bio text default null)
returns setof public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g');
  v_bio text := nullif(btrim(coalesce(p_bio, '')), '');
  v_first_name text;
  v_last_name text;
begin
  if v_uid is null or auth.role() <> 'authenticated' then
    raise exception 'profile_not_authenticated' using errcode = '28000';
  end if;
  if not public.is_profile_complete(v_uid) then
    raise exception 'profile_incomplete_or_unavailable' using errcode = '42501';
  end if;
  if length(v_name) < 1 or length(v_name) > 100 or v_name ~ '[[:cntrl:]]' then
    raise exception 'profile_name_invalid' using errcode = '22023';
  end if;
  if v_bio is not null and (length(v_bio) > 160 or v_bio ~ '[\x00]') then
    raise exception 'profile_bio_invalid' using errcode = '22023';
  end if;

  v_first_name := split_part(v_name, ' ', 1);
  v_last_name := case
    when position(' ' in v_name) > 0 then substr(v_name, position(' ' in v_name) + 1)
    else ''
  end;

  update public.profiles
  set first_name = v_first_name,
      last_name = v_last_name,
      bio = v_bio
  where id = v_uid;

  return query select profile.* from public.profiles profile where profile.id = v_uid;
end;
$$;

create or replace function public.update_current_account_type(p_account_type text)
returns setof public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_account_type text := lower(btrim(coalesce(p_account_type, '')));
begin
  if v_uid is null or auth.role() <> 'authenticated' then
    raise exception 'profile_not_authenticated' using errcode = '28000';
  end if;
  if not public.is_profile_complete(v_uid) then
    raise exception 'profile_incomplete_or_unavailable' using errcode = '42501';
  end if;
  if v_account_type not in ('public', 'private') then
    raise exception 'profile_account_type_invalid' using errcode = '22023';
  end if;

  update public.profiles
  set account_type = v_account_type
  where id = v_uid;

  return query select profile.* from public.profiles profile where profile.id = v_uid;
end;
$$;

revoke all on function public.complete_current_profile(text, text) from public, anon;
revoke all on function public.update_current_profile_details(text, text) from public, anon;
revoke all on function public.update_current_account_type(text) from public, anon;
grant execute on function public.complete_current_profile(text, text) to authenticated;
grant execute on function public.update_current_profile_details(text, text) to authenticated;
grant execute on function public.update_current_account_type(text) to authenticated;

comment on function public.complete_current_profile(text, text) is
  'Idempotent authenticated onboarding completion. The owner is auth.uid(); only Name and username are accepted.';
comment on function public.update_current_profile_details(text, text) is
  'Authenticated complete-profile edit for Name and bio only.';
comment on function public.update_current_account_type(text) is
  'Authenticated complete-profile edit for public/private account type only.';

-- Recreate the username function with a zero-length search_path and require a
-- complete active caller. The transactional propagation behavior is preserved.
create or replace function public.update_current_username(p_username text)
returns table(username text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_next text := btrim(coalesce(p_username, ''));
  v_previous text;
  v_pair record;
begin
  if v_uid is null or auth.role() <> 'authenticated' then
    raise exception 'username_not_authenticated' using errcode = '28000';
  end if;
  if not public.is_profile_complete(v_uid) then
    raise exception 'profile_incomplete_or_unavailable' using errcode = '42501';
  end if;
  if not public.profile_username_is_valid(v_next) then
    raise exception 'username_invalid' using errcode = '22023';
  end if;

  select profile.username into v_previous
  from public.profiles profile
  where profile.id = v_uid
  for update;

  if v_previous is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  v_previous := lower(btrim(v_previous));
  if v_previous = v_next then
    return query select v_next;
    return;
  end if;

  if exists (
    select 1 from public.profiles profile
    where lower(profile.username) = v_next and profile.id <> v_uid
  ) then
    raise exception 'username_taken' using errcode = '23505';
  end if;

  update public.profiles set username = v_next where id = v_uid;

  for v_pair in
    select * from (values
      ('reviews', 'reviewer_name'), ('stories', 'author_name'),
      ('likes', 'user_name'), ('comments', 'user_name'),
      ('wishlist', 'user_name'), ('hungry_picks', 'user_name'),
      ('circle_requests', 'sender_name'), ('circle_requests', 'receiver_name'),
      ('circle_memberships', 'user_name'), ('circle_memberships', 'member_name'),
      ('notifications', 'recipient_name'), ('notifications', 'actor_name'),
      ('push_tokens', 'user_name'), ('shared_memory_rooms', 'created_by'),
      ('shared_memory_members', 'user_name'), ('shared_memory_messages', 'author_name'),
      ('shared_memory_photos', 'uploader_name'), ('shared_memory_dishes', 'added_by'),
      ('shared_memory_reads', 'user_name'), ('shared_memory_invites', 'sender_name'),
      ('shared_memory_invites', 'receiver_name'), ('notification_settings', 'user_name'),
      ('blocked_users', 'blocker_name'), ('blocked_users', 'blocked_name')
    ) as target(table_name, column_name)
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = v_pair.table_name
        and column_name = v_pair.column_name
    ) then
      execute format('update public.%I set %I = $1 where %I = $2', v_pair.table_name, v_pair.column_name, v_pair.column_name)
        using v_next, v_previous;
    end if;
  end loop;

  return query select v_next;
exception
  when unique_violation then
    raise exception 'username_taken' using errcode = '23505';
end;
$$;

revoke all on function public.update_current_username(text) from public, anon;
grant execute on function public.update_current_username(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Effective least-privilege grants. Revoke table-wide writes first; a later
-- column-level revoke cannot override a surviving table-level grant.
-- ---------------------------------------------------------------------------

revoke all privileges on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant all privileges on table public.profiles to service_role;

-- PostgREST expands scalar RPC results through a generated row projection.
-- On the pinned local PostgreSQL 17 image, projecting the large JSONB schema
-- contract can terminate the backend process. Preserve the established object
-- response while converting the public wire value to JSON, which avoids that
-- PostgreSQL/PostgREST failure mode and keeps this diagnostic read-only.
alter function public.production_schema_contract()
  rename to production_schema_contract_jsonb_phase4;
revoke all on function public.production_schema_contract_jsonb_phase4()
  from public, anon, authenticated, service_role;

create function public.production_schema_contract()
returns json
language sql
security definer
set search_path = ''
as $$
  with base as (
    select public.production_schema_contract_jsonb_phase4() as contract
  ), guarded_names as (
    select unnest(array[
      'account_deletion_storage_candidates',
      'claim_account_deletion_jobs',
      'claim_media_cleanup_assets',
      'claim_media_processing_jobs',
      'claim_push_delivery_jobs',
      'claim_push_receipt_jobs',
      'claim_review_moderation_intents',
      'cleanup_shared_memory_media',
      'finalize_shared_memory_upload_intent',
      'mobile_post_engagement_v1',
      'review_media_account_storage_paths',
      'shared_memory_account_media_paths',
      'shared_memory_room_media_paths'
    ]::text[]) as name
  ), wrapper_drift as (
    select guarded.name
    from guarded_names guarded
    where not exists (
      select 1
      from pg_catalog.pg_proc wrapper
      join pg_catalog.pg_namespace wrapper_namespace on wrapper_namespace.oid = wrapper.pronamespace
      where wrapper_namespace.nspname = 'public'
        and wrapper.proname = guarded.name
        and not wrapper.proretset
        and wrapper.prosecdef
        and position('service_role_required' in wrapper.prosrc) > 0
        and has_function_privilege('anon', wrapper.oid, 'execute')
        and has_function_privilege('authenticated', wrapper.oid, 'execute')
        and has_function_privilege('service_role', wrapper.oid, 'execute')
        and exists (
          select 1
          from pg_catalog.pg_proc internal
          join pg_catalog.pg_namespace internal_namespace on internal_namespace.oid = internal.pronamespace
          where internal_namespace.nspname = 'private'
            and internal.proname = guarded.name
            and internal.proretset
        )
      )
  ), limiter_wrapper_drift as (
    select 'consume_api_rate_limits'::text as name
    where not exists (
      select 1
      from pg_catalog.pg_proc wrapper
      join pg_catalog.pg_namespace wrapper_namespace on wrapper_namespace.oid = wrapper.pronamespace
      where wrapper_namespace.nspname = 'public'
        and wrapper.proname = 'consume_api_rate_limits'
        and wrapper.proretset
        and wrapper.prosecdef
        and position('service_role_required' in wrapper.prosrc) > 0
        and has_function_privilege('anon', wrapper.oid, 'execute')
        and has_function_privilege('authenticated', wrapper.oid, 'execute')
        and has_function_privilege('service_role', wrapper.oid, 'execute')
        and exists (
          select 1
          from pg_catalog.pg_proc internal
          join pg_catalog.pg_namespace internal_namespace on internal_namespace.oid = internal.pronamespace
          where internal_namespace.nspname = 'private'
            and internal.proname = 'consume_api_rate_limits'
            and not internal.proretset
        )
    )
  ), raw_service_rpc_acl_drift as (
    select p.oid::regprocedure::text as name
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('service_role', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
  )
  select (
    (base.contract - 'clientWorkerFunctionGrants' - 'clientApiSecurityFunctionGrants') ||
    jsonb_build_object(
      'clientWorkerFunctionGrants', '[]'::jsonb,
      'clientApiSecurityFunctionGrants', coalesce(
        (
          select jsonb_agg(grant_name order by grant_name)
          from jsonb_array_elements_text(base.contract->'clientApiSecurityFunctionGrants') grants(grant_name)
          where grant_name <> all(array[
            'consume_api_rate_limits',
            'cleanup_api_security_state',
            'apply_media_moderation_action',
            'apply_report_moderation_action'
          ]::text[])
        ),
        '[]'::jsonb
      ),
      'rawServiceRpcAclDrift', coalesce(
        (select jsonb_agg(name order by name) from raw_service_rpc_acl_drift),
        '[]'::jsonb
      ),
      'guardedClientServiceWrapperDrift', coalesce(
        (
          select jsonb_agg(combined.name order by combined.name)
          from (
            select wrapper_drift.name from wrapper_drift
            union all
            select limiter_wrapper_drift.name from limiter_wrapper_drift
          ) combined
        ),
        '[]'::jsonb
      )
    )
  )::json
  from base
$$;

revoke all on function public.production_schema_contract()
  from public, anon, authenticated;
grant execute on function public.production_schema_contract() to service_role;

comment on function public.production_schema_contract() is
  'Service-only, read-only production schema contract exposed as JSON for PostgREST RPC stability.';

-- PostgreSQL 17 can terminate a backend when an unprivileged role invokes an
-- ungranted set-returning function. Keep worker/inventory SRFs outside the
-- exposed schema and preserve their public service API with scalar JSON-array
-- wrappers. Supabase clients still receive `data` as an array, while denied
-- client-role calls follow the stable scalar-function permission path.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- Concurrent PostgREST scalar projections can terminate the pinned PostgreSQL
-- 17 backend regardless of the scalar wire type. Keep the transactional
-- implementation private and expose a guarded one-row table function, which
-- uses PostgREST's stable set-returning query path.
alter function public.consume_api_rate_limits(jsonb) set schema private;

create function public.consume_api_rate_limits(p_entries jsonb)
returns table(allowed boolean, remaining bigint, "retryAfterSeconds" integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  v_result := private.consume_api_rate_limits(p_entries);
  return query select
    (v_result->>'allowed')::boolean,
    (v_result->>'remaining')::bigint,
    (v_result->>'retryAfterSeconds')::integer;
end;
$$;

revoke all on function public.consume_api_rate_limits(jsonb) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limits(jsonb) to anon, authenticated, service_role;

alter function public.account_deletion_storage_candidates(uuid) set schema private;
alter function public.claim_account_deletion_jobs(integer, text, integer, uuid) set schema private;
alter function public.claim_media_cleanup_assets(text, integer, integer) set schema private;
alter function public.claim_media_processing_jobs(text, integer, integer, integer) set schema private;
alter function public.claim_push_delivery_jobs(text, integer, integer) set schema private;
alter function public.claim_push_receipt_jobs(text, integer, integer) set schema private;
alter function public.claim_review_moderation_intents(text, integer, integer) set schema private;
alter function public.cleanup_shared_memory_media(uuid[], uuid[], text, timestamptz) set schema private;
alter function public.finalize_shared_memory_upload_intent(uuid, uuid, integer, bigint, text, text, timestamptz, timestamptz) set schema private;
alter function public.mobile_post_engagement_v1(uuid[], uuid) set schema private;
alter function public.review_media_account_storage_paths(uuid) set schema private;
alter function public.shared_memory_account_media_paths(uuid) set schema private;
alter function public.shared_memory_room_media_paths(uuid) set schema private;

revoke all on all functions in schema private from public, anon, authenticated;

create function public.account_deletion_storage_candidates(p_job_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare v_result json;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select coalesce(json_agg(result), '[]'::json) into v_result
  from private.account_deletion_storage_candidates(p_job_id) result;
  return v_result;
end;
$$;

create function public.claim_account_deletion_jobs(
  p_limit integer default 10,
  p_worker text default 'account-deletion-worker',
  p_lease_seconds integer default 120,
  p_job_id uuid default null
)
returns json language plpgsql security definer set search_path = '' as $$
declare v_result json;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select coalesce(json_agg(result), '[]'::json) into v_result
  from private.claim_account_deletion_jobs(p_limit, p_worker, p_lease_seconds, p_job_id) result;
  return v_result;
end;
$$;

create function public.claim_media_cleanup_assets(
  p_worker_id text,
  p_limit integer default 25,
  p_lease_seconds integer default 120
)
returns json language plpgsql security definer set search_path = '' as $$
declare v_result json;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select coalesce(json_agg(result), '[]'::json) into v_result
  from private.claim_media_cleanup_assets(p_worker_id, p_limit, p_lease_seconds) result;
  return v_result;
end;
$$;

create function public.claim_media_processing_jobs(
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 180,
  p_max_attempts integer default 5
)
returns json language plpgsql security definer set search_path = '' as $$
declare v_result json;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select coalesce(json_agg(result), '[]'::json) into v_result
  from private.claim_media_processing_jobs(p_worker_id, p_limit, p_lease_seconds, p_max_attempts) result;
  return v_result;
end;
$$;

create function public.claim_push_delivery_jobs(
  p_worker_id text,
  p_limit integer default 50,
  p_lease_seconds integer default 120
)
returns json language plpgsql security definer set search_path = '' as $$
declare v_result json;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select coalesce(json_agg(result), '[]'::json) into v_result
  from private.claim_push_delivery_jobs(p_worker_id, p_limit, p_lease_seconds) result;
  return v_result;
end;
$$;

create function public.claim_push_receipt_jobs(
  p_worker_id text,
  p_limit integer default 100,
  p_lease_seconds integer default 120
)
returns json language plpgsql security definer set search_path = '' as $$
declare v_result json;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select coalesce(json_agg(result), '[]'::json) into v_result
  from private.claim_push_receipt_jobs(p_worker_id, p_limit, p_lease_seconds) result;
  return v_result;
end;
$$;

create function public.claim_review_moderation_intents(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns json language plpgsql security definer set search_path = '' as $$
declare v_result json;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select coalesce(json_agg(result), '[]'::json) into v_result
  from private.claim_review_moderation_intents(p_worker_id, p_limit, p_lease_seconds) result;
  return v_result;
end;
$$;

create function public.cleanup_shared_memory_media(
  p_expired_intent_ids uuid[] default '{}'::uuid[],
  p_pending_photo_ids uuid[] default '{}'::uuid[],
  p_pending_reason text default 'pending_review_expired',
  p_now timestamptz default now()
)
returns json language plpgsql security definer set search_path = '' as $$
declare v_result json;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select coalesce(json_agg(result), '[]'::json) into v_result
  from private.cleanup_shared_memory_media(p_expired_intent_ids, p_pending_photo_ids, p_pending_reason, p_now) result;
  return v_result;
end;
$$;

create function public.finalize_shared_memory_upload_intent(
  p_intent_id uuid,
  p_message_id uuid,
  p_position integer,
  p_file_size_bytes bigint,
  p_moderation_status text,
  p_moderation_reason text,
  p_moderated_at timestamptz,
  p_now timestamptz default now()
)
returns json language plpgsql security definer set search_path = '' as $$
declare v_result json;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select coalesce(json_agg(result), '[]'::json) into v_result
  from private.finalize_shared_memory_upload_intent(
    p_intent_id, p_message_id, p_position, p_file_size_bytes,
    p_moderation_status, p_moderation_reason, p_moderated_at, p_now
  ) result;
  return v_result;
end;
$$;

create function public.mobile_post_engagement_v1(
  p_post_ids uuid[],
  p_viewer_user_id uuid default null
)
returns json language plpgsql security definer set search_path = '' as $$
declare v_result json;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select coalesce(json_agg(result), '[]'::json) into v_result
  from private.mobile_post_engagement_v1(p_post_ids, p_viewer_user_id) result;
  return v_result;
end;
$$;

create function public.review_media_account_storage_paths(p_user_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare v_result json;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select coalesce(json_agg(result), '[]'::json) into v_result
  from private.review_media_account_storage_paths(p_user_id) result;
  return v_result;
end;
$$;

create function public.shared_memory_account_media_paths(p_user_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare v_result json;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select coalesce(json_agg(result), '[]'::json) into v_result
  from private.shared_memory_account_media_paths(p_user_id) result;
  return v_result;
end;
$$;

create function public.shared_memory_room_media_paths(p_room_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare v_result json;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select coalesce(json_agg(result), '[]'::json) into v_result
  from private.shared_memory_room_media_paths(p_room_id) result;
  return v_result;
end;
$$;

revoke all on function public.account_deletion_storage_candidates(uuid) from public, anon, authenticated;
revoke all on function public.claim_account_deletion_jobs(integer, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.claim_media_cleanup_assets(text, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_media_processing_jobs(text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_push_delivery_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_push_receipt_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_review_moderation_intents(text, integer, integer) from public, anon, authenticated;
revoke all on function public.cleanup_shared_memory_media(uuid[], uuid[], text, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_shared_memory_upload_intent(uuid, uuid, integer, bigint, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.mobile_post_engagement_v1(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.review_media_account_storage_paths(uuid) from public, anon, authenticated;
revoke all on function public.shared_memory_account_media_paths(uuid) from public, anon, authenticated;
revoke all on function public.shared_memory_room_media_paths(uuid) from public, anon, authenticated;

grant execute on function public.account_deletion_storage_candidates(uuid) to service_role;
grant execute on function public.claim_account_deletion_jobs(integer, text, integer, uuid) to service_role;
grant execute on function public.claim_media_cleanup_assets(text, integer, integer) to service_role;
grant execute on function public.claim_media_processing_jobs(text, integer, integer, integer) to service_role;
grant execute on function public.claim_push_delivery_jobs(text, integer, integer) to service_role;
grant execute on function public.claim_push_receipt_jobs(text, integer, integer) to service_role;
grant execute on function public.claim_review_moderation_intents(text, integer, integer) to service_role;
grant execute on function public.cleanup_shared_memory_media(uuid[], uuid[], text, timestamptz) to service_role;
grant execute on function public.finalize_shared_memory_upload_intent(uuid, uuid, integer, bigint, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.mobile_post_engagement_v1(uuid[], uuid) to service_role;
grant execute on function public.review_media_account_storage_paths(uuid) to service_role;
grant execute on function public.shared_memory_account_media_paths(uuid) to service_role;
grant execute on function public.shared_memory_room_media_paths(uuid) to service_role;

-- The public scalar wrappers are safe to invoke from PostgREST because their
-- first operation validates the JWT role and raises 42501. Granting only these
-- guards avoids PostgreSQL's crashing ACL path; the mutating SRFs remain in the
-- unexposed private schema and inaccessible to client roles.
grant execute on function public.account_deletion_storage_candidates(uuid) to anon, authenticated;
grant execute on function public.claim_account_deletion_jobs(integer, text, integer, uuid) to anon, authenticated;
grant execute on function public.claim_media_cleanup_assets(text, integer, integer) to anon, authenticated;
grant execute on function public.claim_media_processing_jobs(text, integer, integer, integer) to anon, authenticated;
grant execute on function public.claim_push_delivery_jobs(text, integer, integer) to anon, authenticated;
grant execute on function public.claim_push_receipt_jobs(text, integer, integer) to anon, authenticated;
grant execute on function public.claim_review_moderation_intents(text, integer, integer) to anon, authenticated;
grant execute on function public.cleanup_shared_memory_media(uuid[], uuid[], text, timestamptz) to anon, authenticated;
grant execute on function public.finalize_shared_memory_upload_intent(uuid, uuid, integer, bigint, text, text, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.mobile_post_engagement_v1(uuid[], uuid) to anon, authenticated;
grant execute on function public.review_media_account_storage_paths(uuid) to anon, authenticated;
grant execute on function public.shared_memory_account_media_paths(uuid) to anon, authenticated;
grant execute on function public.shared_memory_room_media_paths(uuid) to anon, authenticated;

-- Every service RPC exposed through PostgREST must reject client roles inside
-- an executable guard. The pinned PostgreSQL 17 image can terminate a backend
-- while PostgREST expands a raw ACL denial, so older service-only functions
-- that did not already contain a role guard are moved behind guarded wrappers.
alter function public.backfill_review_dish_mentions(integer) set schema private;
alter function public.circle_feed_page_v2(uuid, timestamptz, uuid, integer, uuid[]) set schema private;
alter function public.cleanup_disabled_push_tokens(integer) set schema private;
alter function public.cleanup_observability_operations(integer) set schema private;
alter function public.complete_push_delivery_receipt(uuid, uuid, text, text) set schema private;
alter function public.complete_push_delivery_ticket(uuid, uuid, text, integer) set schema private;
alter function public.complete_review_moderation_intent(uuid, uuid, text, text) set schema private;
alter function public.fail_push_delivery_send(uuid, uuid, text, boolean) set schema private;
alter function public.media_processing_lease_is_current(uuid, text, bigint, uuid) set schema private;
alter function public.mobile_public_feed_page_v1(text, uuid, timestamptz, uuid, integer, text, text, text, uuid, text, uuid, text) set schema private;
alter function public.production_operations_contract() set schema private;
alter function public.production_operations_health() set schema private;
alter function public.production_schema_contract_phase3() set schema private;
alter function public.rebuild_dish_identity_stats() set schema private;
alter function public.reconcile_phase5_projections(boolean, integer) set schema private;
alter function public.reconcile_push_delivery_jobs(boolean, integer) set schema private;
alter function public.record_scheduler_run(text, uuid, text, text, timestamptz, integer, text, text) set schema private;
alter function public.record_service_heartbeat(text, text, text, integer, integer, text) set schema private;
alter function public.set_review_visibility_with_media_access(uuid, uuid, text, text) set schema private;

create function public.backfill_review_dish_mentions(p_batch_size integer default 1000)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.backfill_review_dish_mentions(p_batch_size);
end;
$$;

create function public.circle_feed_page_v2(
  p_viewer_user_id uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 24,
  p_exclude_post_ids uuid[] default '{}'::uuid[]
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.circle_feed_page_v2(p_viewer_user_id, p_cursor_created_at, p_cursor_id, p_limit, p_exclude_post_ids);
end;
$$;

create function public.cleanup_disabled_push_tokens(p_limit integer default 500)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.cleanup_disabled_push_tokens(p_limit);
end;
$$;

create function public.cleanup_observability_operations(p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.cleanup_observability_operations(p_limit);
end;
$$;

create function public.complete_push_delivery_receipt(
  p_job_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_error_code text default null
)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.complete_push_delivery_receipt(p_job_id, p_claim_token, p_outcome, p_error_code);
end;
$$;

create function public.complete_push_delivery_ticket(
  p_job_id uuid,
  p_claim_token uuid,
  p_provider_ticket_id text,
  p_receipt_delay_seconds integer default 900
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.complete_push_delivery_ticket(p_job_id, p_claim_token, p_provider_ticket_id, p_receipt_delay_seconds);
end;
$$;

create function public.complete_review_moderation_intent(
  p_intent_id uuid,
  p_claim_token uuid,
  p_decision text,
  p_reason_code text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.complete_review_moderation_intent(p_intent_id, p_claim_token, p_decision, p_reason_code);
end;
$$;

create function public.fail_push_delivery_send(
  p_job_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_retryable boolean
)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.fail_push_delivery_send(p_job_id, p_claim_token, p_error_code, p_retryable);
end;
$$;

create function public.media_processing_lease_is_current(
  p_job_id uuid,
  p_worker_id text,
  p_lease_generation bigint,
  p_claim_token uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.media_processing_lease_is_current(p_job_id, p_worker_id, p_lease_generation, p_claim_token);
end;
$$;

create function public.mobile_public_feed_page_v1(
  p_scope text default 'public',
  p_viewer_user_id uuid default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 24,
  p_place_id text default null,
  p_restaurant_name text default null,
  p_restaurant_address text default null,
  p_canonical_dish_id uuid default null,
  p_dish_normalized_name text default null,
  p_post_id uuid default null,
  p_profile_name text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.mobile_public_feed_page_v1(
    p_scope, p_viewer_user_id, p_cursor_created_at, p_cursor_id, p_limit,
    p_place_id, p_restaurant_name, p_restaurant_address, p_canonical_dish_id,
    p_dish_normalized_name, p_post_id, p_profile_name
  );
end;
$$;

create function public.production_operations_contract()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.production_operations_contract();
end;
$$;

create function public.production_operations_health()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.production_operations_health();
end;
$$;

create function public.production_schema_contract_phase3()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.production_schema_contract_phase3();
end;
$$;

create function public.rebuild_dish_identity_stats()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.rebuild_dish_identity_stats();
end;
$$;

create function public.reconcile_phase5_projections(
  p_apply boolean default false,
  p_limit integer default 500
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.reconcile_phase5_projections(p_apply, p_limit);
end;
$$;

create function public.reconcile_push_delivery_jobs(
  p_apply boolean default false,
  p_limit integer default 500
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.reconcile_push_delivery_jobs(p_apply, p_limit);
end;
$$;

create function public.record_scheduler_run(
  p_job_name text,
  p_run_id uuid,
  p_state text,
  p_release text,
  p_next_expected_at timestamptz default null,
  p_duration_ms integer default null,
  p_error_code text default null,
  p_correlation_id text default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  perform private.record_scheduler_run(
    p_job_name, p_run_id, p_state, p_release, p_next_expected_at,
    p_duration_ms, p_error_code, p_correlation_id
  );
end;
$$;

create function public.record_service_heartbeat(
  p_job_name text,
  p_state text,
  p_release text,
  p_interval_seconds integer,
  p_duration_ms integer default null,
  p_error_code text default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  perform private.record_service_heartbeat(
    p_job_name, p_state, p_release, p_interval_seconds, p_duration_ms, p_error_code
  );
end;
$$;

create function public.set_review_visibility_with_media_access(
  p_review_id uuid,
  p_owner_id uuid,
  p_owner_name text,
  p_visibility text
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return private.set_review_visibility_with_media_access(p_review_id, p_owner_id, p_owner_name, p_visibility);
end;
$$;

-- Pure normalization is safe for client roles. All other service functions
-- below already validate auth.role() before reading or mutating service state.
grant execute on function public.normalize_dish_identity_name(text) to anon, authenticated;
grant execute on function public.account_deletion_cleanup_database(uuid) to anon, authenticated;
grant execute on function public.account_deletion_remaining_counts(uuid) to anon, authenticated;
grant execute on function public.apply_media_moderation_action(uuid, text, text, text) to anon, authenticated;
grant execute on function public.apply_report_moderation_action(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.cancel_media_processing_job(uuid, text, text) to anon, authenticated;
grant execute on function public.cleanup_api_security_state(integer) to anon, authenticated;
grant execute on function public.complete_media_cleanup_asset(uuid, text, uuid, text) to anon, authenticated;
grant execute on function public.complete_media_processing_job(uuid, text, bigint, uuid, integer, integer, integer) to anon, authenticated;
grant execute on function public.fail_media_cleanup_asset(uuid, text, uuid, text) to anon, authenticated;
grant execute on function public.fail_media_processing_job(uuid, text, bigint, uuid, text, text, integer, integer) to anon, authenticated;
grant execute on function public.heartbeat_media_processing_job(uuid, text, bigint, uuid, integer) to anon, authenticated;
grant execute on function public.production_schema_contract() to anon, authenticated;
grant execute on function public.purge_expired_account_deletion_records(integer) to anon, authenticated;
grant execute on function public.requeue_media_processing_job(uuid, text) to anon, authenticated;

revoke all on function public.backfill_review_dish_mentions(integer) from public;
revoke all on function public.circle_feed_page_v2(uuid, timestamptz, uuid, integer, uuid[]) from public;
revoke all on function public.cleanup_disabled_push_tokens(integer) from public;
revoke all on function public.cleanup_observability_operations(integer) from public;
revoke all on function public.complete_push_delivery_receipt(uuid, uuid, text, text) from public;
revoke all on function public.complete_push_delivery_ticket(uuid, uuid, text, integer) from public;
revoke all on function public.complete_review_moderation_intent(uuid, uuid, text, text) from public;
revoke all on function public.fail_push_delivery_send(uuid, uuid, text, boolean) from public;
revoke all on function public.media_processing_lease_is_current(uuid, text, bigint, uuid) from public;
revoke all on function public.mobile_public_feed_page_v1(text, uuid, timestamptz, uuid, integer, text, text, text, uuid, text, uuid, text) from public;
revoke all on function public.production_operations_contract() from public;
revoke all on function public.production_operations_health() from public;
revoke all on function public.production_schema_contract_phase3() from public;
revoke all on function public.rebuild_dish_identity_stats() from public;
revoke all on function public.reconcile_phase5_projections(boolean, integer) from public;
revoke all on function public.reconcile_push_delivery_jobs(boolean, integer) from public;
revoke all on function public.record_scheduler_run(text, uuid, text, text, timestamptz, integer, text, text) from public;
revoke all on function public.record_service_heartbeat(text, text, text, integer, integer, text) from public;
revoke all on function public.set_review_visibility_with_media_access(uuid, uuid, text, text) from public;

grant execute on function public.backfill_review_dish_mentions(integer) to anon, authenticated, service_role;
grant execute on function public.circle_feed_page_v2(uuid, timestamptz, uuid, integer, uuid[]) to anon, authenticated, service_role;
grant execute on function public.cleanup_disabled_push_tokens(integer) to anon, authenticated, service_role;
grant execute on function public.cleanup_observability_operations(integer) to anon, authenticated, service_role;
grant execute on function public.complete_push_delivery_receipt(uuid, uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.complete_push_delivery_ticket(uuid, uuid, text, integer) to anon, authenticated, service_role;
grant execute on function public.complete_review_moderation_intent(uuid, uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.fail_push_delivery_send(uuid, uuid, text, boolean) to anon, authenticated, service_role;
grant execute on function public.media_processing_lease_is_current(uuid, text, bigint, uuid) to anon, authenticated, service_role;
grant execute on function public.mobile_public_feed_page_v1(text, uuid, timestamptz, uuid, integer, text, text, text, uuid, text, uuid, text) to anon, authenticated, service_role;
grant execute on function public.production_operations_contract() to anon, authenticated, service_role;
grant execute on function public.production_operations_health() to anon, authenticated, service_role;
grant execute on function public.production_schema_contract_phase3() to anon, authenticated, service_role;
grant execute on function public.rebuild_dish_identity_stats() to anon, authenticated, service_role;
grant execute on function public.reconcile_phase5_projections(boolean, integer) to anon, authenticated, service_role;
grant execute on function public.reconcile_push_delivery_jobs(boolean, integer) to anon, authenticated, service_role;
grant execute on function public.record_scheduler_run(text, uuid, text, text, timestamptz, integer, text, text) to anon, authenticated, service_role;
grant execute on function public.record_service_heartbeat(text, text, text, integer, integer, text) to anon, authenticated, service_role;
grant execute on function public.set_review_visibility_with_media_access(uuid, uuid, text, text) to anon, authenticated, service_role;

-- The public contract keeps its name but changes its scalar wire type. Force
-- PostgREST to discard any cached representation of the previous signature
-- before the first service-role verification call.
notify pgrst, 'reload schema';
