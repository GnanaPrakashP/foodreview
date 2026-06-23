-- Final independent audit hardening for Table Memory phases 1-6.
--
-- This migration preserves earlier trust-boundary rules and fixes repository
-- audit blockers found after phases 1-6:
--   1. blocked users cannot be added to, or continue reading, shared rooms,
--   2. upload intent finalization and photo row creation are one DB transaction,
--   3. room summary pagination limits the expensive summary work to a page.
--
-- Rollback notes:
--   drop trigger if exists shared_memory_members_security_guard on public.shared_memory_members;
--   drop function if exists public.validate_shared_memory_member_write();
--   drop function if exists public.finalize_shared_memory_upload_intent(uuid, uuid, integer, bigint, text, text, timestamptz, timestamptz);
--   -- Reapply can_read_shared_memory(), create_shared_memory_room(), and
--   -- shared_memory_room_summaries() from their prior migrations only if the
--   -- blocked-read and atomic-finalize protections are intentionally removed.

create or replace function public.shared_memory_user_pair_blocked(
  p_user_a text,
  p_user_b text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.blocked_users block
      where nullif(btrim(coalesce(p_user_a, '')), '') is not null
        and nullif(btrim(coalesce(p_user_b, '')), '') is not null
        and p_user_a <> p_user_b
        and (
          (block.blocker_name = p_user_a and block.blocked_name = p_user_b)
          or
          (block.blocker_name = p_user_b and block.blocked_name = p_user_a)
        )
    ),
    false
  );
$$;

grant execute on function public.shared_memory_user_pair_blocked(text, text)
  to authenticated, service_role;

create or replace function public.can_read_shared_memory(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shared_memory_members smm
    where smm.room_id = target_room_id
      and smm.user_name = public.current_profile_name()
  )
  and not public.shared_memory_room_has_blocked_relationship(
    target_room_id,
    public.current_profile_name()
  );
$$;

grant execute on function public.can_read_shared_memory(uuid) to authenticated, service_role;

create or replace function public.validate_shared_memory_member_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(new.user_name), '') is null then
    raise exception 'shared_memory_member_user_required' using errcode = '23514';
  end if;

  if public.shared_memory_room_has_blocked_relationship(new.room_id, new.user_name) then
    raise exception 'shared_memory_member_blocked_relationship' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists shared_memory_members_security_guard on public.shared_memory_members;
create trigger shared_memory_members_security_guard
  before insert or update on public.shared_memory_members
  for each row
  execute function public.validate_shared_memory_member_write();

drop policy if exists "Block relationships prevent memory member inserts" on public.shared_memory_members;
create policy "Block relationships prevent memory member inserts"
  on public.shared_memory_members as restrictive for insert to authenticated
  with check (not public.shared_memory_room_has_blocked_relationship(room_id, user_name));

drop policy if exists "Room members can leave rooms" on public.shared_memory_members;
create policy "Room members can leave rooms"
  on public.shared_memory_members for delete to authenticated
  using (user_name = public.current_profile_name());

create or replace function public.create_shared_memory_room(
  p_restaurant_name text,
  p_restaurant_id text default null,
  p_area text default null,
  p_visit_date date default null,
  p_source_post_id uuid default null,
  p_participant_usernames text[] default '{}'::text[]
)
returns table(id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator text;
  v_room_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select p.username
    into v_creator
    from public.profiles p
    where p.id = auth.uid()
    limit 1;

  if v_creator is null then
    raise exception 'profile_required' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(p_restaurant_name, '')), '') is null then
    raise exception 'restaurant_name_required' using errcode = 'P0001';
  end if;

  insert into public.shared_memory_rooms (
    title,
    restaurant_name,
    restaurant_id,
    area,
    visit_date,
    source_post_id,
    created_by,
    status
  )
  values (
    btrim(p_restaurant_name),
    btrim(p_restaurant_name),
    nullif(btrim(coalesce(p_restaurant_id, '')), ''),
    nullif(btrim(coalesce(p_area, '')), ''),
    p_visit_date,
    p_source_post_id,
    v_creator,
    'draft'
  )
  returning shared_memory_rooms.id into v_room_id;

  insert into public.shared_memory_members (room_id, user_name, role)
  values (v_room_id, v_creator, 'owner')
  on conflict (room_id, user_name) do update set role = 'owner';

  with requested as (
    select distinct lower(regexp_replace(btrim(value), '^@', '')) as username
    from unnest(coalesce(p_participant_usernames, '{}'::text[])) as value
  ),
  candidates as (
    select p.username
    from requested
    join public.profiles p on p.username = requested.username
    where requested.username <> ''
      and p.username <> v_creator
  ),
  safe_candidates as (
    select candidate.username
    from candidates candidate
    where not exists (
      select 1
      from candidates other_candidate
      where other_candidate.username <> candidate.username
        and public.shared_memory_user_pair_blocked(candidate.username, other_candidate.username)
    )
      and not public.shared_memory_user_pair_blocked(v_creator, candidate.username)
  )
  insert into public.shared_memory_members (room_id, user_name, role)
  select v_room_id, safe_candidates.username, 'participant'
  from safe_candidates
  on conflict (room_id, user_name) do nothing;

  return query select v_room_id;
end;
$$;

grant execute on function public.create_shared_memory_room(text, text, text, date, uuid, text[]) to authenticated;

create or replace function public.finalize_shared_memory_upload_intent(
  p_intent_id uuid,
  p_message_id uuid,
  p_position integer,
  p_file_size_bytes bigint,
  p_moderation_status text,
  p_moderation_reason text,
  p_moderated_at timestamptz,
  p_now timestamptz default now()
)
returns table(
  id uuid,
  room_id uuid,
  message_id uuid,
  uploader_name text,
  uploader_id uuid,
  public_url text,
  storage_path text,
  media_type text,
  image_width integer,
  image_height integer,
  "position" integer,
  upload_intent_id uuid,
  moderation_status text,
  moderation_reason text,
  file_size_bytes bigint,
  mime_type text,
  duration_ms integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.shared_memory_upload_intents%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  if p_moderation_status not in ('pending', 'approved', 'rejected') then
    raise exception 'shared_memory_finalize_invalid_moderation_status' using errcode = '23514';
  end if;

  select *
    into v_intent
    from public.shared_memory_upload_intents intent
    where intent.id = p_intent_id
    for update;

  if not found then
    raise exception 'shared_memory_upload_intent_not_found' using errcode = '23503';
  end if;

  if v_intent.status <> 'created' then
    raise exception 'shared_memory_upload_intent_not_created' using errcode = '23514';
  end if;

  if v_intent.expires_at <= p_now then
    raise exception 'shared_memory_upload_intent_expired' using errcode = '23514';
  end if;

  if v_intent.file_size_bytes is distinct from p_file_size_bytes then
    raise exception 'shared_memory_upload_intent_file_size_mismatch' using errcode = '23514';
  end if;

  update public.shared_memory_upload_intents intent
  set finalized_at = p_now,
      moderation_reason = p_moderation_reason,
      moderation_status = p_moderation_status,
      status = 'finalized'
  where intent.id = p_intent_id;

  return query
  insert into public.shared_memory_photos (
    duration_ms,
    file_size_bytes,
    image_height,
    image_width,
    media_type,
    message_id,
    mime_type,
    moderated_at,
    moderation_reason,
    moderation_status,
    position,
    public_url,
    room_id,
    storage_path,
    upload_intent_id,
    uploader_id,
    uploader_name
  )
  values (
    v_intent.duration_ms,
    p_file_size_bytes,
    v_intent.image_height,
    v_intent.image_width,
    v_intent.media_type,
    p_message_id,
    v_intent.mime_type,
    p_moderated_at,
    p_moderation_reason,
    p_moderation_status,
    greatest(coalesce(p_position, 0), 0),
    null,
    v_intent.room_id,
    v_intent.storage_path,
    v_intent.id,
    v_intent.uploader_id,
    v_intent.uploader_name
  )
  returning
    shared_memory_photos.id,
    shared_memory_photos.room_id,
    shared_memory_photos.message_id,
    shared_memory_photos.uploader_name,
    shared_memory_photos.uploader_id,
    shared_memory_photos.public_url,
    shared_memory_photos.storage_path,
    shared_memory_photos.media_type,
    shared_memory_photos.image_width,
    shared_memory_photos.image_height,
    shared_memory_photos.position,
    shared_memory_photos.upload_intent_id,
    shared_memory_photos.moderation_status,
    shared_memory_photos.moderation_reason,
    shared_memory_photos.file_size_bytes,
    shared_memory_photos.mime_type,
    shared_memory_photos.duration_ms,
    shared_memory_photos.created_at;
end;
$$;

revoke all on function public.finalize_shared_memory_upload_intent(uuid, uuid, integer, bigint, text, text, timestamptz, timestamptz) from public;
revoke all on function public.finalize_shared_memory_upload_intent(uuid, uuid, integer, bigint, text, text, timestamptz, timestamptz) from anon;
revoke all on function public.finalize_shared_memory_upload_intent(uuid, uuid, integer, bigint, text, text, timestamptz, timestamptz) from authenticated;
grant execute on function public.finalize_shared_memory_upload_intent(uuid, uuid, integer, bigint, text, text, timestamptz, timestamptz) to service_role;

comment on function public.finalize_shared_memory_upload_intent(uuid, uuid, integer, bigint, text, text, timestamptz, timestamptz) is
  'Service-role-only atomic upload finalization. Intent update and shared_memory_photos insert commit or roll back together.';

create or replace function public.shared_memory_account_media_paths(p_user_id uuid)
returns table(storage_path text)
language sql
security definer
set search_path = public
as $$
  with target_profile as (
    select profile.id, profile.username
    from public.profiles profile
    where profile.id = p_user_id
  )
  select distinct photo.storage_path
  from public.shared_memory_photos photo
  join target_profile profile
    on photo.uploader_id = profile.id
    or (
      photo.uploader_id is null
      and photo.uploader_name = profile.username
      and photo.storage_path like ('memories/' || photo.room_id::text || '/' || photo.uploader_name || '/%')
    )
  where photo.storage_path is not null
    and (
      photo.storage_path like ('memories/' || photo.room_id::text || '/' || profile.id::text || '/%')
      or photo.storage_path like ('memories/' || photo.room_id::text || '/' || photo.uploader_name || '/%')
      or photo.upload_intent_id is not null
    );
$$;

revoke all on function public.shared_memory_account_media_paths(uuid) from public;
revoke all on function public.shared_memory_account_media_paths(uuid) from anon;
revoke all on function public.shared_memory_account_media_paths(uuid) from authenticated;
grant execute on function public.shared_memory_account_media_paths(uuid) to service_role;

comment on function public.shared_memory_account_media_paths(uuid) is
  'Service-role-only account media sweep helper. It prefers immutable uploader_id and includes DB-backed legacy username paths only while the profile still exists.';

create or replace function public.shared_memory_room_summaries(
  p_user_name text default null,
  p_limit integer default 100,
  p_before_activity_at timestamptz default null,
  p_before_room_id uuid default null
)
returns table(
  id uuid,
  title text,
  restaurant_name text,
  area text,
  visit_date date,
  source_post_id uuid,
  created_by text,
  participant_count bigint,
  photo_count bigint,
  message_count bigint,
  unread_count bigint,
  latest_message text,
  latest_activity_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_current_user_name text := public.current_profile_name();
  v_user_name text := nullif(btrim(coalesce(p_user_name, public.current_profile_name(), '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
begin
  if auth.role() <> 'service_role' and (v_current_user_name is null or v_user_name is distinct from v_current_user_name) then
    raise exception 'shared_memory_summary_forbidden' using errcode = '42501';
  end if;

  if v_user_name is null then
    return;
  end if;

  return query
  with room_activity as (
    select
      room.id,
      room.title,
      room.restaurant_name,
      room.area,
      room.visit_date,
      room.source_post_id,
      room.created_by,
      latest_message.body as latest_message,
      greatest(room.created_at, coalesce(latest_message.created_at, room.created_at)) as latest_activity_at,
      room.created_at
    from public.shared_memory_members visible_member
    join public.shared_memory_rooms room
      on room.id = visible_member.room_id
    left join lateral (
      select message.body, message.created_at
      from public.shared_memory_messages message
      where message.room_id = room.id
      order by message.created_at desc, message.id desc
      limit 1
    ) latest_message on true
    where visible_member.user_name = v_user_name
      and not public.shared_memory_room_has_blocked_relationship(room.id, v_user_name)
  ),
  paged_rooms as (
    select *
    from room_activity
    where p_before_activity_at is null
      or room_activity.latest_activity_at < p_before_activity_at
      or (
        room_activity.latest_activity_at = p_before_activity_at
        and p_before_room_id is not null
        and room_activity.id < p_before_room_id
      )
    order by room_activity.latest_activity_at desc, room_activity.id desc
    limit v_limit
  )
  select
    room.id,
    room.title,
    room.restaurant_name,
    room.area,
    room.visit_date,
    room.source_post_id,
    room.created_by,
    coalesce(member_counts.participant_count, 0)::bigint as participant_count,
    coalesce(photo_counts.photo_count, 0)::bigint as photo_count,
    coalesce(message_counts.message_count, 0)::bigint as message_count,
    coalesce(unread_counts.unread_count, 0)::bigint as unread_count,
    room.latest_message,
    room.latest_activity_at,
    room.created_at
  from paged_rooms room
  left join lateral (
    select count(*)::bigint as participant_count
    from public.shared_memory_members member
    where member.room_id = room.id
  ) member_counts on true
  left join lateral (
    select count(*)::bigint as message_count
    from public.shared_memory_messages message
    where message.room_id = room.id
  ) message_counts on true
  left join lateral (
    select count(*)::bigint as unread_count
    from public.shared_memory_messages message
    left join public.shared_memory_reads read
      on read.room_id = room.id
     and read.user_name = v_user_name
    where message.room_id = room.id
      and message.author_name <> v_user_name
      and message.created_at > coalesce(read.last_read_at, '-infinity'::timestamptz)
  ) unread_counts on to_regclass('public.shared_memory_reads') is not null
  left join lateral (
    select count(*)::bigint as photo_count
    from public.shared_memory_photos photo
    where photo.room_id = room.id
      and (
        coalesce(photo.moderation_status, 'approved') = 'approved'
        or (
          coalesce(photo.moderation_status, 'approved') = 'pending'
          and photo.uploader_name = v_user_name
        )
      )
  ) photo_counts on true
  order by room.latest_activity_at desc, room.id desc;
end;
$$;

revoke all on function public.shared_memory_room_summaries(text, integer, timestamptz, uuid) from public;
revoke all on function public.shared_memory_room_summaries(text, integer, timestamptz, uuid) from anon;
grant execute on function public.shared_memory_room_summaries(text, integer, timestamptz, uuid) to authenticated, service_role;

comment on function public.shared_memory_room_summaries(text, integer, timestamptz, uuid) is
  'Bounded Table Memory room summary query. It pages visible rooms before running per-room summary counts.';
