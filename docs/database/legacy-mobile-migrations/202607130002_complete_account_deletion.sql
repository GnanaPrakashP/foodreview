-- Phase 1B: durable, visibility-safe account deletion.
--
-- This migration is intentionally mirrored byte-for-byte in both temporary
-- migration roots. It is additive and uses dynamic SQL for optional tables
-- that currently exist in only one side of the unresolved PH-301 split.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists account_status text not null default 'active',
  add column if not exists deletion_started_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_account_status_check;
alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status in ('active', 'deleting'));

create index if not exists profiles_account_status_idx
  on public.profiles(account_status, deletion_started_at);

create table if not exists public.account_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  owner_name text not null,
  status text not null default 'inventory_pending',
  attempts integer not null default 0,
  max_attempts integer not null default 50,
  last_error_code text,
  last_error text,
  next_retry_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  inventory_cursor jsonb not null default '{}'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  inventory_completed_at timestamptz,
  storage_completed_at timestamptz,
  database_completed_at timestamptz,
  auth_deleted_at timestamptz,
  completed_at timestamptz,
  retain_until timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_deletion_jobs_status_check check (
    status in (
      'inventory_pending',
      'storage_cleanup_pending',
      'database_cleanup_pending',
      'auth_deletion_pending',
      'completed',
      'failed'
    )
  ),
  constraint account_deletion_jobs_attempts_check check (attempts >= 0 and max_attempts > 0)
);

create unique index if not exists account_deletion_jobs_active_user_idx
  on public.account_deletion_jobs(user_id)
  where status <> 'completed';
create index if not exists account_deletion_jobs_claim_idx
  on public.account_deletion_jobs(status, next_retry_at, lease_expires_at, created_at);
create index if not exists account_deletion_jobs_user_status_idx
  on public.account_deletion_jobs(user_id, status, created_at desc);

create table if not exists public.account_deletion_storage_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.account_deletion_jobs(id) on delete cascade,
  bucket_id text not null,
  storage_path text not null,
  ownership_source text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error_code text,
  last_error text,
  deleted_at timestamptz,
  verified_missing_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_deletion_storage_items_bucket_check check (
    bucket_id in (
      'media-sources',
      'media-private',
      'media-public',
      'review-photos',
      'review-media-quarantine',
      'memory-media'
    )
  ),
  constraint account_deletion_storage_items_status_check check (
    status in ('pending', 'deleting', 'deleted', 'already_missing', 'failed')
  ),
  constraint account_deletion_storage_items_path_check check (
    storage_path = btrim(storage_path)
    and storage_path <> ''
    and storage_path not like '/%'
    and storage_path not like '%/'
    and storage_path not like '%//%'
    and position('..' in storage_path) = 0
    and position('?' in storage_path) = 0
    and position('#' in storage_path) = 0
    and position(chr(92) in storage_path) = 0
  ),
  unique(job_id, bucket_id, storage_path)
);

create index if not exists account_deletion_storage_items_work_idx
  on public.account_deletion_storage_items(job_id, status, created_at);

create table if not exists public.account_deletion_ambiguous_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.account_deletion_jobs(id) on delete cascade,
  item_type text not null,
  bucket_id text,
  reason_code text not null,
  reference_hash text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(job_id, item_type, reference_hash)
);

alter table public.account_deletion_jobs enable row level security;
alter table public.account_deletion_storage_items enable row level security;
alter table public.account_deletion_ambiguous_items enable row level security;
revoke all on table public.account_deletion_jobs from public, anon, authenticated;
revoke all on table public.account_deletion_storage_items from public, anon, authenticated;
revoke all on table public.account_deletion_ambiguous_items from public, anon, authenticated;
grant all privileges on table public.account_deletion_jobs to service_role;
grant all privileges on table public.account_deletion_storage_items to service_role;
grant all privileges on table public.account_deletion_ambiguous_items to service_role;

create or replace function public.account_is_active(p_user_id uuid)
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
    ),
    false
  )
$$;

revoke all on function public.account_is_active(uuid) from public;
grant execute on function public.account_is_active(uuid) to anon, authenticated, service_role;

-- Existing RLS policies call this helper. Returning no username for a deleting
-- account immediately denies username-scoped client writes without weakening
-- any existing policy.
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
    and profile.account_status = 'active'
    and profile.deletion_started_at is null
  limit 1
$$;

revoke all on function public.current_profile_name() from public;
grant execute on function public.current_profile_name() to anon, authenticated, service_role;

-- Restrictive policies combine with existing permissive read policies. A
-- deleting profile and its reviews disappear from normal reads immediately.
drop policy if exists "Deleting profiles are suppressed" on public.profiles;
create policy "Deleting profiles are suppressed"
  on public.profiles as restrictive for select
  to anon, authenticated
  using (account_status = 'active' and deletion_started_at is null);

drop policy if exists "Deleting review owners are suppressed" on public.reviews;
create policy "Deleting review owners are suppressed"
  on public.reviews as restrictive for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.profiles profile
      where profile.username = reviews.reviewer_name
        and profile.account_status = 'active'
        and profile.deletion_started_at is null
    )
  );

-- Direct client source uploads must also stop after the freeze, including an
-- upload that received its intent immediately before deletion was requested.
drop policy if exists "Authenticated users can upload scoped media sources" on storage.objects;
create policy "Authenticated users can upload scoped media sources"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media-sources'
    and exists (
      select 1
      from public.media_assets asset
      where asset.source_bucket_id = storage.objects.bucket_id
        and asset.source_storage_path = storage.objects.name
        and asset.owner_id = auth.uid()
        and public.account_is_active(asset.owner_id)
        and asset.status = 'created'
        and asset.expires_at > now()
    )
  );

-- The legacy avatar quarantine bucket also requires the account to remain
-- active. Memory uploads already call current_profile_name(), which now fails
-- closed for deleting accounts.
do $phase1b_storage$
begin
  if to_regclass('public.review_media_upload_intents') is not null then
    drop policy if exists "Authenticated users can upload scoped review media quarantine intents" on storage.objects;
    execute 'create policy "Authenticated users can upload scoped review media quarantine intents"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = ''review-media-quarantine''
        and exists (
          select 1 from public.review_media_upload_intents intent
          where intent.quarantine_bucket_id = storage.objects.bucket_id
            and intent.quarantine_storage_path = storage.objects.name
            and intent.user_id = auth.uid()
            and public.account_is_active(intent.user_id)
            and intent.status = ''created''
            and intent.expires_at > now()
            and intent.quarantine_storage_path like (''pending/'' || auth.uid()::text || ''/'' || intent.id::text || ''/%'')
        )
      )';
  end if;
end
$phase1b_storage$;

create or replace function public.reject_frozen_account_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' and not public.account_is_active(auth.uid()) then
    raise exception 'account_deletion_in_progress' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_frozen_account_write() from public;
grant execute on function public.reject_frozen_account_write() to authenticated, service_role;

-- UUID-keyed direct-client tables do not all call current_profile_name(). Add a
-- single fail-closed guard without touching service-role cleanup operations.
do $phase1b_write_guards$
declare
  v_table text;
begin
  foreach v_table in array array[
    'recommendation_feedback',
    'user_tried_items',
    'post_visit_attributions',
    'post_views',
    'post_impressions',
    'user_location_preferences',
    'content_reports',
    'dish_candidates',
    'review_dish_mentions'
  ]
  loop
    if to_regclass('public.' || v_table) is not null then
      execute format('drop trigger if exists reject_frozen_account_write_trigger on public.%I', v_table);
      execute format('create trigger reject_frozen_account_write_trigger before insert or update on public.%I for each row execute function public.reject_frozen_account_write()', v_table);
    end if;
  end loop;
end
$phase1b_write_guards$;

create or replace function public.request_account_deletion()
returns table(job_id uuid, job_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner_name text;
  v_job_id uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select profile.username
  into v_owner_name
  from public.profiles profile
  where profile.id = v_uid
  for update;

  if v_owner_name is null then
    select job.id, job.status
    into v_job_id, v_status
    from public.account_deletion_jobs job
    where job.user_id = v_uid
    order by job.created_at desc
    limit 1;
    if v_job_id is null then
      raise exception 'profile_not_found' using errcode = 'P0002';
    end if;
    return query select v_job_id, v_status;
    return;
  end if;

  select job.id, job.status
  into v_job_id, v_status
  from public.account_deletion_jobs job
  where job.user_id = v_uid
    and job.status <> 'completed'
  order by job.created_at desc
  limit 1
  for update;

  if v_job_id is null then
    insert into public.account_deletion_jobs(user_id, owner_name, status)
    values (v_uid, v_owner_name, 'inventory_pending')
    returning id, status into v_job_id, v_status;
  end if;

  update public.profiles
  set account_status = 'deleting',
      deletion_started_at = coalesce(deletion_started_at, now())
  where id = v_uid;

  update public.reviews
  set deleted_at = coalesce(deleted_at, now()),
      status = 'deleted'
  where reviewer_name = v_owner_name;

  return query select v_job_id, v_status;
end;
$$;

revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;

create or replace function public.claim_account_deletion_jobs(
  p_limit integer default 10,
  p_worker text default 'account-deletion-worker',
  p_lease_seconds integer default 120,
  p_job_id uuid default null
)
returns setof public.account_deletion_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  return query
  with claimable as (
    select job.id
    from public.account_deletion_jobs job
    where job.status not in ('completed', 'failed')
      and (p_job_id is null or job.id = p_job_id)
      and job.next_retry_at <= now()
      and (job.lease_expires_at is null or job.lease_expires_at < now())
    order by job.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.account_deletion_jobs job
  set locked_at = now(),
      locked_by = left(coalesce(nullif(p_worker, ''), 'account-deletion-worker'), 120),
      lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900))),
      attempts = job.attempts + 1,
      updated_at = now()
  from claimable
  where job.id = claimable.id
  returning job.*;
end;
$$;

revoke all on function public.claim_account_deletion_jobs(integer, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_account_deletion_jobs(integer, text, integer, uuid) to service_role;

-- Authoritative database-backed Storage inventory. Results are service-only;
-- callers never supply a path. Optional mobile-only tables are queried through
-- guarded dynamic SQL so the mirrored migration remains valid in both roots.
create or replace function public.account_deletion_storage_candidates(p_job_id uuid)
returns table(bucket_id text, storage_path text, ownership_source text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_owner_name text;
  v_review_photos_table text;
  v_review_intents_table text;
  v_memory_photos_table text;
  v_memory_intents_table text;
  v_legacy_cleanup_table text;
  v_stories_table text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select job.user_id, job.owner_name
  into v_uid, v_owner_name
  from public.account_deletion_jobs job
  where job.id = p_job_id;
  if v_uid is null then
    raise exception 'account_deletion_job_not_found' using errcode = 'P0002';
  end if;

  return query
  select asset.source_bucket_id, asset.source_storage_path, 'media_asset_source'
  from public.media_assets asset
  where asset.owner_id = v_uid and asset.source_storage_path is not null;

  return query
  select derivative.bucket_id, derivative.storage_path, 'media_derivative'
  from public.media_derivatives derivative
  join public.media_assets asset on asset.id = derivative.asset_id
  where asset.owner_id = v_uid and derivative.storage_path is not null;

  return query
  select object->>'bucket', object->>'path', 'media_privacy_old_object'
  from public.media_privacy_migration_jobs migration_job
  join public.media_assets asset on asset.id = migration_job.asset_id
  cross join lateral jsonb_array_elements(migration_job.old_objects) object
  where asset.owner_id = v_uid and object ? 'bucket' and object ? 'path';

  return query
  select object->>'bucket', object->>'path', 'media_privacy_new_object'
  from public.media_privacy_migration_jobs migration_job
  join public.media_assets asset on asset.id = migration_job.asset_id
  cross join lateral jsonb_array_elements(migration_job.new_objects) object
  where asset.owner_id = v_uid and object ? 'bucket' and object ? 'path';

  select to_regclass('public.review_photos')::text into v_review_photos_table;
  select to_regclass('public.review_media_upload_intents')::text,
    to_regclass('public.shared_memory_photos')::text,
    to_regclass('public.shared_memory_upload_intents')::text,
    to_regclass('public.account_media_cleanup_jobs')::text,
    to_regclass('public.stories')::text
  into v_review_intents_table, v_memory_photos_table, v_memory_intents_table, v_legacy_cleanup_table, v_stories_table;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'review_photos' and column_name = 'owner_id'
  ) then
    return query execute format(
      'select ''review-photos''::text, photo.storage_path, ''review_photo'' from %s photo join public.reviews review on review.id = photo.review_id where (photo.owner_id = $1 or review.reviewer_name = $2) and photo.storage_path is not null',
      v_review_photos_table
    )
      using v_uid, v_owner_name;
  else
    return query execute
      'select ''review-photos''::text, photo.storage_path, ''review_photo'' from public.review_photos photo join public.reviews review on review.id = photo.review_id where review.reviewer_name = $1 and photo.storage_path is not null'
      using v_owner_name;
  end if;

  if v_review_intents_table is not null then
    return query execute format(
      'select final_bucket_id, storage_path, ''review_upload_intent_final'' from %s where user_id = $1 and storage_path is not null
       union all
       select quarantine_bucket_id, quarantine_storage_path, ''review_upload_intent_quarantine'' from %s where user_id = $1 and quarantine_storage_path is not null',
      v_review_intents_table, v_review_intents_table
    )
      using v_uid;
  end if;

  if v_memory_photos_table is not null then
    return query execute format(
      'select ''memory-media''::text, storage_path, ''memory_photo'' from %s where (uploader_id = $1 or (uploader_id is null and uploader_name = $2)) and storage_path is not null',
      v_memory_photos_table
    )
      using v_uid, v_owner_name;
  end if;

  if v_memory_intents_table is not null then
    return query execute format(
      'select ''memory-media''::text, storage_path, ''memory_upload_intent'' from %s where uploader_id = $1 and storage_path is not null',
      v_memory_intents_table
    )
      using v_uid;
  end if;

  if v_legacy_cleanup_table is not null then
    return query execute format(
      'select bucket_id, path, ''legacy_account_media_cleanup_job'' from %s cross join lateral unnest(storage_paths) path where user_id = $1 and path is not null',
      v_legacy_cleanup_table
    )
      using v_uid;
  end if;

  if v_stories_table is not null then
    return query execute format(
      'select ''review-photos''::text, storage_path, ''legacy_story'' from %s where author_name = $1 and storage_path is not null',
      v_stories_table
    )
      using v_owner_name;
  end if;
end;
$$;

revoke all on function public.account_deletion_storage_candidates(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_storage_candidates(uuid) to service_role;

-- Reports are retained for abuse/security handling, but direct reporter and
-- target identity is removed before profile deletion.
do $phase1b$
begin
  if to_regclass('public.content_reports') is not null then
    alter table public.content_reports alter column reporter_id drop not null;
    alter table public.content_reports drop constraint if exists content_reports_reporter_id_fkey;
    alter table public.content_reports
      add constraint content_reports_reporter_id_fkey
      foreign key (reporter_id) references public.profiles(id) on delete set null;
  end if;
end
$phase1b$;

create or replace function public.account_deletion_cleanup_database(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_owner_name text;
  v_pending bigint;
  v_ambiguous bigint;
  v_shared_rooms integer := 0;
  v_solo_rooms integer := 0;
  v_memory_rooms_table text;
  v_memory_members_table text;
  v_memory_messages_table text;
  v_memory_photos_table text;
  v_memory_dishes_table text;
  v_optional_table text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select job.user_id, job.owner_name
  into v_uid, v_owner_name
  from public.account_deletion_jobs job
  where job.id = p_job_id
  for update;
  if v_uid is null then
    raise exception 'account_deletion_job_not_found' using errcode = 'P0002';
  end if;

  select count(*) into v_pending
  from public.account_deletion_storage_items item
  where item.job_id = p_job_id and item.status not in ('deleted', 'already_missing');
  select count(*) into v_ambiguous
  from public.account_deletion_ambiguous_items item
  where item.job_id = p_job_id and item.resolved_at is null;
  if v_pending > 0 or v_ambiguous > 0 then
    raise exception 'account_deletion_storage_not_complete' using errcode = 'P0001';
  end if;

  if to_regclass('public.content_reports') is not null then
    execute 'update public.content_reports set reporter_id = null, reporter_name = ''deleted-account'', details = null, updated_at = now() where reporter_id = $1 or reporter_name = $2'
      using v_uid, v_owner_name;
    execute 'update public.content_reports set moderator_id = null, moderator_name = null, updated_at = now() where moderator_id = $1 or moderator_name = $2'
      using v_uid, v_owner_name;
    execute 'update public.content_reports set target_id = ''deleted-account'', details = null, updated_at = now() where target_type = ''profile'' and target_id in ($1, $2)'
      using v_uid::text, v_owner_name;
    execute 'update public.content_reports set target_id = ''deleted-account'', details = null, updated_at = now() where target_type = ''review'' and target_id in (select id::text from public.reviews where reviewer_name = $1)'
      using v_owner_name;
    execute 'update public.content_reports set target_id = ''deleted-account'', details = null, updated_at = now() where target_type = ''comment'' and target_id in (select id::text from public.comments where user_name = $1)'
      using v_owner_name;
    execute 'update public.content_reports set target_id = ''deleted-account'', details = null, updated_at = now() where target_type = ''media'' and target_id in (select id::text from public.media_assets where owner_id = $1)'
      using v_uid;
  end if;

  select to_regclass('public.shared_memory_rooms')::text,
    to_regclass('public.shared_memory_members')::text,
    to_regclass('public.shared_memory_messages')::text,
    to_regclass('public.shared_memory_photos')::text,
    to_regclass('public.shared_memory_dishes')::text
  into v_memory_rooms_table, v_memory_members_table, v_memory_messages_table, v_memory_photos_table, v_memory_dishes_table;
  if v_memory_rooms_table is not null then
    execute format('select count(*) from %s room where room.created_by = $1
      and not exists (select 1 from %s member where member.room_id = room.id and member.user_name <> $1)
      and not exists (select 1 from %s message where message.room_id = room.id and message.author_name <> $1)
      and not exists (select 1 from %s photo where photo.room_id = room.id and photo.uploader_name <> $1)
      and not exists (select 1 from %s dish where dish.room_id = room.id and dish.added_by <> $1)',
      v_memory_rooms_table, v_memory_members_table, v_memory_messages_table, v_memory_photos_table, v_memory_dishes_table)
      into v_solo_rooms using v_owner_name;
    execute format('select count(*) from %s room where room.created_by = $1
      and (exists (select 1 from %s member where member.room_id = room.id and member.user_name <> $1)
        or exists (select 1 from %s message where message.room_id = room.id and message.author_name <> $1)
        or exists (select 1 from %s photo where photo.room_id = room.id and photo.uploader_name <> $1)
        or exists (select 1 from %s dish where dish.room_id = room.id and dish.added_by <> $1))',
      v_memory_rooms_table, v_memory_members_table, v_memory_messages_table, v_memory_photos_table, v_memory_dishes_table)
      into v_shared_rooms using v_owner_name;

    execute format('delete from %s room where room.created_by = $1
      and not exists (select 1 from %s member where member.room_id = room.id and member.user_name <> $1)
      and not exists (select 1 from %s message where message.room_id = room.id and message.author_name <> $1)
      and not exists (select 1 from %s photo where photo.room_id = room.id and photo.uploader_name <> $1)
      and not exists (select 1 from %s dish where dish.room_id = room.id and dish.added_by <> $1)',
      v_memory_rooms_table, v_memory_members_table, v_memory_messages_table, v_memory_photos_table, v_memory_dishes_table)
      using v_owner_name;
    execute format('update %s set created_by = ''deleted-account'', updated_at = now() where created_by = $1', v_memory_rooms_table)
      using v_owner_name;

    if to_regclass('public.shared_memory_photos') is not null then
      execute format('delete from %s where uploader_id = $1 or uploader_name = $2', v_memory_photos_table) using v_uid, v_owner_name;
    end if;
    if to_regclass('public.shared_memory_messages') is not null then
      execute format('delete from %s where author_name = $1', v_memory_messages_table) using v_owner_name;
    end if;
    select to_regclass('public.shared_memory_dish_ratings')::text into v_optional_table;
    if v_optional_table is not null then
      execute format('delete from %s where rated_by = $1', v_optional_table) using v_owner_name;
    end if;
    if to_regclass('public.shared_memory_dishes') is not null then
      execute format('delete from %s where added_by = $1', v_memory_dishes_table) using v_owner_name;
    end if;
    select to_regclass('public.shared_memory_stops')::text into v_optional_table;
    if v_optional_table is not null then
      execute format('delete from %s where created_by = $1', v_optional_table) using v_owner_name;
    end if;
    select to_regclass('public.shared_memory_reads')::text into v_optional_table;
    if v_optional_table is not null then
      execute format('delete from %s where user_name = $1', v_optional_table) using v_owner_name;
    end if;
    select to_regclass('public.shared_memory_invites')::text into v_optional_table;
    if v_optional_table is not null then
      execute format('delete from %s where sender_name = $1 or receiver_name = $1', v_optional_table) using v_owner_name;
    end if;
    if to_regclass('public.shared_memory_members') is not null then
      execute format('delete from %s where user_name = $1', v_memory_members_table) using v_owner_name;
    end if;
  end if;

  -- Username-keyed content is hard deleted. Shared canonical dish, restaurant,
  -- and aggregate entities are intentionally not deleted.
  delete from public.notifications where recipient_user_id = v_uid or actor_user_id = v_uid or recipient_name = v_owner_name or actor_name = v_owner_name;
  delete from public.likes where user_name = v_owner_name;
  delete from public.comments where user_name = v_owner_name;
  delete from public.wishlist where user_name = v_owner_name;
  delete from public.circle_requests where sender_name = v_owner_name or receiver_name = v_owner_name;
  delete from public.circle_memberships where user_name = v_owner_name or member_name = v_owner_name;

  select to_regclass('public.blocked_users')::text into v_optional_table;
  if v_optional_table is not null then
    execute format('delete from %s where blocker_name = $1 or blocked_name = $1', v_optional_table) using v_owner_name;
  end if;
  select to_regclass('public.notification_settings')::text into v_optional_table;
  if v_optional_table is not null then
    execute format('delete from %s where user_name = $1', v_optional_table) using v_owner_name;
  end if;
  select to_regclass('public.push_tokens')::text into v_optional_table;
  if v_optional_table is not null then
    execute format('delete from %s where user_name = $1', v_optional_table) using v_owner_name;
  end if;
  select to_regclass('public.hungry_picks')::text into v_optional_table;
  if v_optional_table is not null then
    execute format('delete from %s where user_name = $1', v_optional_table) using v_owner_name;
  end if;
  select to_regclass('public.stories')::text into v_optional_table;
  if v_optional_table is not null then
    execute format('delete from %s where author_name = $1', v_optional_table) using v_owner_name;
  end if;
  select to_regclass('public.account_media_cleanup_jobs')::text into v_optional_table;
  if v_optional_table is not null then
    execute format('delete from %s where user_id = $1', v_optional_table) using v_uid;
  end if;
  delete from public.reviews where reviewer_name = v_owner_name;
  select to_regclass('public.review_media_upload_intents')::text into v_optional_table;
  if v_optional_table is not null then
    execute format('delete from %s where user_id = $1', v_optional_table) using v_uid;
  end if;
  select to_regclass('public.shared_memory_upload_intents')::text into v_optional_table;
  if v_optional_table is not null then
    execute format('delete from %s where uploader_id = $1', v_optional_table) using v_uid;
  end if;
  delete from public.media_assets where owner_id = v_uid;
  delete from public.profiles where id = v_uid;

  update public.account_deletion_jobs
  set database_completed_at = now(),
      status = 'auth_deletion_pending',
      progress = progress || jsonb_build_object(
        'sharedRoomsPreserved', v_shared_rooms,
        'soleRoomsDeleted', v_solo_rooms
      ),
      locked_at = null,
      locked_by = null,
      lease_expires_at = null,
      updated_at = now()
  where id = p_job_id;

  return jsonb_build_object(
    'sharedRoomsPreserved', v_shared_rooms,
    'soleRoomsDeleted', v_solo_rooms
  );
end;
$$;

revoke all on function public.account_deletion_cleanup_database(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_cleanup_database(uuid) to service_role;

create or replace function public.account_deletion_remaining_counts(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_owner_name text;
  v_pair record;
  v_count bigint;
  v_total bigint := 0;
  v_by_table jsonb := '{}'::jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  select user_id, owner_name into v_uid, v_owner_name
  from public.account_deletion_jobs where id = p_job_id;
  if v_uid is null then
    raise exception 'account_deletion_job_not_found' using errcode = 'P0002';
  end if;

  for v_pair in
    select * from (values
      ('profiles', 'id = $1'),
      ('reviews', 'reviewer_name = $2'),
      ('comments', 'user_name = $2'),
      ('likes', 'user_name = $2'),
      ('wishlist', 'user_name = $2'),
      ('circle_requests', 'sender_name = $2 or receiver_name = $2'),
      ('circle_memberships', 'user_name = $2 or member_name = $2'),
      ('notifications', 'recipient_user_id = $1 or actor_user_id = $1 or recipient_name = $2 or actor_name = $2'),
      ('recommendation_feedback', 'reviewer_user_id = $1 or feedback_user_id = $1'),
      ('user_tried_items', 'user_id = $1'),
      ('user_reputation', 'user_id = $1'),
      ('user_badges', 'user_id = $1'),
      ('post_visit_attributions', 'source_user_id = $1 or visitor_user_id = $1'),
      ('media_assets', 'owner_id = $1'),
      ('review_media_upload_intents', 'user_id = $1'),
      ('account_media_cleanup_jobs', 'user_id = $1'),
      ('shared_memory_upload_intents', 'uploader_id = $1'),
      ('shared_memory_members', 'user_name = $2'),
      ('shared_memory_messages', 'author_name = $2'),
      ('shared_memory_photos', 'uploader_id = $1 or uploader_name = $2'),
      ('shared_memory_dishes', 'added_by = $2'),
      ('shared_memory_dish_ratings', 'rated_by = $2'),
      ('shared_memory_stops', 'created_by = $2'),
      ('shared_memory_reads', 'user_name = $2'),
      ('shared_memory_invites', 'sender_name = $2 or receiver_name = $2'),
      ('blocked_users', 'blocker_name = $2 or blocked_name = $2'),
      ('notification_settings', 'user_name = $2'),
      ('push_tokens', 'user_name = $2'),
      ('hungry_picks', 'user_name = $2'),
      ('stories', 'author_name = $2'),
      ('post_views', 'user_id = $1'),
      ('post_impressions', 'viewer_user_id = $1'),
      ('review_dish_mentions', 'user_id = $1'),
      ('dish_candidates', 'created_by = $1'),
      ('user_location_preferences', 'user_id = $1')
    ) as rows(table_name, predicate)
  loop
    if to_regclass('public.' || v_pair.table_name) is null then
      continue;
    end if;
    execute format('select count(*) from public.%I where %s', v_pair.table_name, v_pair.predicate)
      into v_count using v_uid, v_owner_name;
    v_total := v_total + v_count;
    v_by_table := v_by_table || jsonb_build_object(v_pair.table_name, v_count);
  end loop;

  return jsonb_build_object('total', v_total, 'byTable', v_by_table);
end;
$$;

revoke all on function public.account_deletion_remaining_counts(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_remaining_counts(uuid) to service_role;

create or replace function public.purge_expired_account_deletion_records(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  with expired as (
    select job.id
    from public.account_deletion_jobs job
    where job.status = 'completed'
      and job.retain_until <= now()
    order by job.retain_until, job.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  )
  delete from public.account_deletion_jobs job
  using expired
  where job.id = expired.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_expired_account_deletion_records(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_account_deletion_records(integer) to service_role;

-- Retire the legacy function that deleted auth.users inside the client RPC.
-- Existing clients receive a fail-closed error instead of performing the old,
-- unrecoverable ordering.
create or replace function public.delete_current_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'use_durable_account_deletion' using errcode = '55000';
end;
$$;

revoke all on function public.delete_current_account() from public, anon;
grant execute on function public.delete_current_account() to authenticated;

comment on table public.account_deletion_jobs is
  'Service-only durable Phase 1B deletion state. Completed records purge at retain_until; incomplete failed records remain only for operator recovery.';
comment on table public.account_deletion_storage_items is
  'Service-only authoritative Storage deletion inventory. Paths must never be returned to clients or logs.';
comment on function public.request_account_deletion() is
  'Owner-only idempotent deletion request. Freezes and suppresses the account before asynchronous inventory.';
comment on function public.account_deletion_cleanup_database(uuid) is
  'Service-only application cleanup. Requires verified Storage completion and intentionally does not delete auth.users.';
