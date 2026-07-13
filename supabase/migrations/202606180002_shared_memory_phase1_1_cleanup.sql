-- Phase 1.1 final critical security cleanup for Table Memory.
--
-- This migration intentionally does not redesign uploads, storage paths, media
-- processing, or moderation. It closes the remaining Phase 1 integrity gaps:
--   1. abort rollout when existing media rows violate Phase 1 rules,
--   2. enforce same-room replies,
--   3. stop trusting arbitrary shared_memory_photos.public_url values.
--
-- Rollback outline:
--   alter table public.shared_memory_photos
--     drop constraint if exists shared_memory_photos_public_url_matches_storage_path;
--   alter table public.shared_memory_photos alter column public_url set not null;
--   then re-apply validate_shared_memory_message_write() and
--   validate_shared_memory_photo_integrity() from 202606180001 if needed.

do $$
declare
  v_invalid_photo_count integer;
  v_invalid_reply_count integer;
begin
  with photo_parts as (
    select
      photo.id,
      photo.room_id,
      photo.uploader_name,
      photo.message_id,
      photo.public_url,
      photo.storage_path,
      string_to_array(coalesce(photo.storage_path, ''), '/') as parts
    from public.shared_memory_photos photo
  ),
  photo_violations as (
    select
      photo.id,
      array_remove(array[
        case
          when nullif(btrim(photo.storage_path), '') is null
            or photo.storage_path <> btrim(photo.storage_path)
          then 'invalid_or_null_storage_path'
        end,
        case
          when photo.storage_path like '/%'
            or photo.storage_path like '%/'
            or photo.storage_path like '%//%'
            or coalesce(array_length(photo.parts, 1), 0) < 4
            or exists (
              select 1
              from unnest(photo.parts) as segment(value)
              where nullif(segment.value, '') is null
                or segment.value in ('.', '..')
            )
          then 'malformed_path_segments'
        end,
        case
          when position('..' in photo.storage_path) > 0
            or position('?' in photo.storage_path) > 0
            or position('#' in photo.storage_path) > 0
            or position(chr(92) in photo.storage_path) > 0
            or photo.storage_path !~ '^[A-Za-z0-9._~/-]+$'
          then 'unsafe_path_traversal_or_characters'
        end,
        case
          when photo.parts[1] is distinct from 'memories'
          then 'storage_path_prefix_mismatch'
        end,
        case
          when photo.parts[2] is distinct from photo.room_id::text
          then 'storage_path_room_id_mismatch'
        end,
        case
          when photo.parts[3] is distinct from photo.uploader_name
          then 'storage_path_uploader_mismatch'
        end,
        case
          when not exists (
            select 1
            from public.shared_memory_members member
            where member.room_id = photo.room_id
              and member.user_name = photo.uploader_name
          )
          then 'uploader_not_room_member'
        end,
        case
          when photo.message_id is not null
            and message.id is null
          then 'message_id_not_found'
        end,
        case
          when photo.message_id is not null
            and message.id is not null
            and message.room_id <> photo.room_id
          then 'message_id_room_mismatch'
        end,
        case
          when photo.message_id is not null
            and message.id is not null
            and message.author_name <> photo.uploader_name
          then 'message_author_uploader_mismatch'
        end,
        case
          when photo.public_url is not null
            and photo.public_url <> photo.storage_path
          then 'public_url_diverges_from_storage_path'
        end
      ]::text[], null) as reasons
    from photo_parts photo
    left join public.shared_memory_messages message
      on message.id = photo.message_id
  )
  select count(*)
    into v_invalid_photo_count
    from photo_violations
    where cardinality(reasons) > 0;

  if v_invalid_photo_count > 0 then
    raise exception
      'shared_memory_phase1_1_preflight_failed: % shared_memory_photos rows violate Phase 1.1 integrity rules. Run the README preflight query and clean/backfill manually before applying this migration.',
      v_invalid_photo_count
      using errcode = '23514';
  end if;

  select count(*)
    into v_invalid_reply_count
    from public.shared_memory_messages message
    left join public.shared_memory_messages reply
      on reply.id = message.reply_to_message_id
    where message.reply_to_message_id is not null
      and (
        reply.id is null
        or reply.room_id <> message.room_id
        or reply.id = message.id
      );

  if v_invalid_reply_count > 0 then
    raise exception
      'shared_memory_phase1_1_preflight_failed: % shared_memory_messages replies are missing, cross-room, or self-referential. Clean/backfill manually before applying this migration.',
      v_invalid_reply_count
      using errcode = '23514';
  end if;
end $$;

alter table public.shared_memory_photos
  alter column public_url drop not null;

alter table public.shared_memory_photos
  drop constraint if exists shared_memory_photos_public_url_matches_storage_path;

alter table public.shared_memory_photos
  add constraint shared_memory_photos_public_url_matches_storage_path
  check (public_url is null or public_url = storage_path);

create or replace function public.validate_shared_memory_message_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reply_room_id uuid;
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

  if new.reply_to_message_id is not null then
    if new.reply_to_message_id = new.id then
      raise exception 'shared_memory_message_self_reply' using errcode = '23514';
    end if;

    select reply.room_id
      into v_reply_room_id
      from public.shared_memory_messages reply
      where reply.id = new.reply_to_message_id;

    if v_reply_room_id is null then
      raise exception 'shared_memory_message_reply_not_found' using errcode = '23503';
    end if;

    if v_reply_room_id <> new.room_id then
      raise exception 'shared_memory_message_reply_room_mismatch' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

grant execute on function public.validate_shared_memory_message_write() to authenticated, service_role;

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
