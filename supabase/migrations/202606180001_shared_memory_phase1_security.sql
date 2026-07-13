-- Phase 1 critical security hardening for Table Memory.
--
-- Enforces DB-level media row integrity, same-room media/message binding,
-- blocked-user write prevention, and the 1000-character message limit.
--
-- Compatibility note: storage paths currently include mutable usernames:
--   memories/{room_id}/{uploader_name}/...
-- TODO Phase 2: move storage ownership paths to immutable user ids and migrate
-- existing objects with a service-role job.
--
-- Rollback outline:
--   drop trigger if exists shared_memory_messages_security_guard on public.shared_memory_messages;
--   drop trigger if exists shared_memory_photos_security_guard on public.shared_memory_photos;
--   drop function if exists public.validate_shared_memory_message_write();
--   drop function if exists public.validate_shared_memory_photo_integrity();
--   drop function if exists public.shared_memory_room_has_blocked_relationship(uuid, text);
--   drop policy if exists "Block relationships prevent memory message inserts" on public.shared_memory_messages;
--   drop policy if exists "Block relationships prevent memory message updates" on public.shared_memory_messages;
--   drop policy if exists "Block relationships prevent memory photo inserts" on public.shared_memory_photos;
--   then recreate the prior storage.objects upload policy from 202606140001.

create or replace function public.shared_memory_room_has_blocked_relationship(
  target_room_id uuid,
  actor_name text
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
      from public.shared_memory_members member
      join public.blocked_users block
        on (
          block.blocker_name = actor_name
          and block.blocked_name = member.user_name
        )
        or (
          block.blocked_name = actor_name
          and block.blocker_name = member.user_name
        )
      where member.room_id = target_room_id
        and nullif(btrim(actor_name), '') is not null
        and member.user_name <> actor_name
    ),
    false
  );
$$;

grant execute on function public.shared_memory_room_has_blocked_relationship(uuid, text)
  to authenticated, service_role;

create or replace function public.validate_shared_memory_message_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.body is null or char_length(new.body) > 1000 then
    raise exception 'shared_memory_message_body_too_long' using errcode = '23514';
  end if;

  if nullif(btrim(new.author_name), '') is null then
    raise exception 'shared_memory_message_author_required' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.shared_memory_members member
    where member.room_id = new.room_id
      and member.user_name = new.author_name
  ) then
    raise exception 'shared_memory_message_author_not_room_member' using errcode = '42501';
  end if;

  if public.shared_memory_room_has_blocked_relationship(new.room_id, new.author_name) then
    raise exception 'shared_memory_blocked_relationship' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists shared_memory_messages_security_guard on public.shared_memory_messages;
create trigger shared_memory_messages_security_guard
  before insert or update on public.shared_memory_messages
  for each row
  execute function public.validate_shared_memory_message_write();

create or replace function public.validate_shared_memory_photo_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parts text[];
  v_part text;
  v_message_room_id uuid;
  v_message_author_name text;
begin
  if nullif(btrim(new.storage_path), '') is null then
    raise exception 'shared_memory_storage_path_required' using errcode = '23514';
  end if;

  if new.storage_path <> btrim(new.storage_path) then
    raise exception 'shared_memory_storage_path_not_normalized' using errcode = '23514';
  end if;

  if new.storage_path like '/%' or new.storage_path like '%/' or new.storage_path like '%//%' then
    raise exception 'shared_memory_storage_path_invalid_segments' using errcode = '23514';
  end if;

  if position('..' in new.storage_path) > 0
    or position('?' in new.storage_path) > 0
    or position('#' in new.storage_path) > 0
    or position(chr(92) in new.storage_path) > 0
  then
    raise exception 'shared_memory_storage_path_unsafe' using errcode = '23514';
  end if;

  if new.storage_path !~ '^[A-Za-z0-9._~/-]+$' then
    raise exception 'shared_memory_storage_path_unsafe_characters' using errcode = '23514';
  end if;

  v_parts := string_to_array(new.storage_path, '/');
  if array_length(v_parts, 1) < 4 then
    raise exception 'shared_memory_storage_path_invalid_shape' using errcode = '23514';
  end if;

  foreach v_part in array v_parts loop
    if nullif(v_part, '') is null or v_part = '.' or v_part = '..' then
      raise exception 'shared_memory_storage_path_empty_segment' using errcode = '23514';
    end if;
  end loop;

  if v_parts[1] <> 'memories' then
    raise exception 'shared_memory_storage_path_invalid_prefix' using errcode = '23514';
  end if;

  if v_parts[2] <> new.room_id::text then
    raise exception 'shared_memory_storage_path_room_mismatch' using errcode = '23514';
  end if;

  if v_parts[3] <> new.uploader_name then
    raise exception 'shared_memory_storage_path_uploader_mismatch' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.shared_memory_members member
    where member.room_id = new.room_id
      and member.user_name = new.uploader_name
  ) then
    raise exception 'shared_memory_photo_uploader_not_room_member' using errcode = '42501';
  end if;

  if public.shared_memory_room_has_blocked_relationship(new.room_id, new.uploader_name) then
    raise exception 'shared_memory_blocked_relationship' using errcode = '42501';
  end if;

  if new.message_id is not null then
    select message.room_id, message.author_name
      into v_message_room_id, v_message_author_name
      from public.shared_memory_messages message
      where message.id = new.message_id;

    if v_message_room_id is null then
      raise exception 'shared_memory_photo_message_not_found' using errcode = '23503';
    end if;

    if v_message_room_id <> new.room_id then
      raise exception 'shared_memory_photo_message_room_mismatch' using errcode = '23514';
    end if;

    if v_message_author_name <> new.uploader_name then
      raise exception 'shared_memory_photo_message_author_mismatch' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

do $$
declare
  v_legacy_or_invalid_count integer;
begin
  select count(*)
    into v_legacy_or_invalid_count
    from public.shared_memory_photos photo
    where photo.storage_path is null
       or photo.storage_path not like 'memories/%'
       or photo.storage_path like '%//%'
       or position('..' in photo.storage_path) > 0
       or position('?' in photo.storage_path) > 0
       or position('#' in photo.storage_path) > 0
       or position(chr(92) in photo.storage_path) > 0;

  if v_legacy_or_invalid_count > 0 then
    raise notice 'shared_memory_photos has % legacy/invalid rows; this migration enforces new INSERT/UPDATE writes only until those rows are cleaned up.',
      v_legacy_or_invalid_count;
  end if;
end $$;

drop trigger if exists shared_memory_photos_security_guard on public.shared_memory_photos;
create trigger shared_memory_photos_security_guard
  before insert or update on public.shared_memory_photos
  for each row
  execute function public.validate_shared_memory_photo_integrity();

drop policy if exists "Block relationships prevent memory message inserts" on public.shared_memory_messages;
create policy "Block relationships prevent memory message inserts"
  on public.shared_memory_messages as restrictive for insert to authenticated
  with check (not public.shared_memory_room_has_blocked_relationship(room_id, author_name));

drop policy if exists "Block relationships prevent memory message updates" on public.shared_memory_messages;
create policy "Block relationships prevent memory message updates"
  on public.shared_memory_messages as restrictive for update to authenticated
  using (not public.shared_memory_room_has_blocked_relationship(room_id, author_name))
  with check (not public.shared_memory_room_has_blocked_relationship(room_id, author_name));

drop policy if exists "Block relationships prevent memory photo inserts" on public.shared_memory_photos;
create policy "Block relationships prevent memory photo inserts"
  on public.shared_memory_photos as restrictive for insert to authenticated
  with check (not public.shared_memory_room_has_blocked_relationship(room_id, uploader_name));

drop policy if exists "Memory members can upload own memory media" on storage.objects;
create policy "Memory members can upload own memory media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'memory-media'
    and coalesce((storage.foldername(name))[1], '') = 'memories'
    and (storage.foldername(name))[3] = public.current_profile_name()
    and public.can_read_shared_memory(public.memory_media_room_id(name))
    and not public.shared_memory_room_has_blocked_relationship(
      public.memory_media_room_id(name),
      public.current_profile_name()
    )
  );
