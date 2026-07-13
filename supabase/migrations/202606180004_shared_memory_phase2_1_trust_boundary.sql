-- Phase 2.1 final media upload trust-boundary hardening.
--
-- This migration makes shared_memory_photos row creation server-only, adds
-- one-use media intent constraints, and prevents duplicate storage paths from
-- turning pending media into approved media.
--
-- Rollback notes:
--   drop index if exists public.shared_memory_photos_upload_intent_unique_idx;
--   drop index if exists public.shared_memory_photos_storage_path_unique_idx;
--   -- Recreate "Upload intents finalize memory photos" only if intentionally
--   -- rolling back to client-side finalization. That weakens Phase 2.1.
--   -- Recreate validate_shared_memory_photo_integrity() from 202606180003.

do $$
declare
  v_duplicate_intent_count integer;
  v_duplicate_path_count integer;
begin
  select count(*)
    into v_duplicate_intent_count
    from (
      select upload_intent_id
      from public.shared_memory_photos
      where upload_intent_id is not null
      group by upload_intent_id
      having count(*) > 1
    ) duplicates;

  if v_duplicate_intent_count > 0 then
    raise exception
      'shared_memory_phase2_1_preflight_failed: % duplicate upload_intent_id values exist in shared_memory_photos. Clean manually before applying this migration.',
      v_duplicate_intent_count
      using errcode = '23505';
  end if;

  select count(*)
    into v_duplicate_path_count
    from (
      select storage_path
      from public.shared_memory_photos
      group by storage_path
      having count(*) > 1
    ) duplicates;

  if v_duplicate_path_count > 0 then
    raise exception
      'shared_memory_phase2_1_preflight_failed: % duplicate storage_path values exist in shared_memory_photos. Clean manually before applying this migration.',
      v_duplicate_path_count
      using errcode = '23505';
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'memory-media',
  'memory-media',
  false,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create unique index if not exists shared_memory_photos_upload_intent_unique_idx
  on public.shared_memory_photos(upload_intent_id)
  where upload_intent_id is not null;

create unique index if not exists shared_memory_photos_storage_path_unique_idx
  on public.shared_memory_photos(storage_path);

drop policy if exists "Upload intents finalize memory photos" on public.shared_memory_photos;
drop policy if exists "Room members can add photos" on public.shared_memory_photos;
drop policy if exists "Room members can update photos" on public.shared_memory_photos;
drop policy if exists "Room members can update own photos" on public.shared_memory_photos;
drop policy if exists "Memory members can update own memory media" on public.shared_memory_photos;

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
  v_profile_username text;
  v_intent record;
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

  if new.uploader_id is not null then
    select profile.username
      into v_profile_username
      from public.profiles profile
      where profile.id = new.uploader_id;

    if v_profile_username is distinct from new.uploader_name then
      raise exception 'shared_memory_photo_uploader_id_mismatch' using errcode = '23514';
    end if;
  end if;

  if v_parts[3] <> new.uploader_name
    and (new.uploader_id is null or v_parts[3] <> new.uploader_id::text)
  then
    raise exception 'shared_memory_storage_path_uploader_mismatch' using errcode = '23514';
  end if;

  if new.public_url is not null and new.public_url <> new.storage_path then
    raise exception 'shared_memory_photo_public_url_mismatch' using errcode = '23514';
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

  if new.upload_intent_id is not null then
    select *
      into v_intent
      from public.shared_memory_upload_intents intent
      where intent.id = new.upload_intent_id;

    if not found then
      raise exception 'shared_memory_photo_upload_intent_not_found' using errcode = '23503';
    end if;

    if v_intent.status <> 'finalized' then
      raise exception 'shared_memory_photo_upload_intent_not_finalized' using errcode = '23514';
    end if;

    if v_intent.room_id <> new.room_id
      or v_intent.uploader_name <> new.uploader_name
      or v_intent.uploader_id <> new.uploader_id
      or v_intent.storage_path <> new.storage_path
      or v_intent.media_type <> new.media_type
      or v_intent.mime_type is distinct from new.mime_type
      or v_intent.file_size_bytes is distinct from new.file_size_bytes
      or v_intent.moderation_status is distinct from new.moderation_status
      or v_intent.moderation_reason is distinct from new.moderation_reason
    then
      raise exception 'shared_memory_photo_upload_intent_mismatch' using errcode = '23514';
    end if;

    if new.moderation_status = 'approved' and new.moderated_at is null then
      raise exception 'shared_memory_photo_approved_without_moderation_time' using errcode = '23514';
    end if;
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

grant execute on function public.validate_shared_memory_photo_integrity() to authenticated, service_role;
