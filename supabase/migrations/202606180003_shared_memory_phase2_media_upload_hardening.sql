-- Phase 2 media upload and storage hardening for Table Memory.
--
-- Adds upload intents, immutable-user-id storage paths for new media, pending
-- moderation visibility, and storage policies that require an active intent.
-- This migration intentionally keeps the Phase 1/1.1 trigger protections.

create table if not exists public.shared_memory_upload_intents (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  uploader_name text not null,
  media_type text not null,
  mime_type text not null,
  extension text not null,
  file_size_bytes bigint not null,
  max_file_size_bytes bigint not null,
  duration_ms integer,
  image_width integer,
  image_height integer,
  storage_path text not null unique,
  status text not null default 'created',
  moderation_status text not null default 'pending',
  moderation_reason text,
  expires_at timestamptz not null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  constraint shared_memory_upload_intents_media_type_check check (media_type in ('image', 'video')),
  constraint shared_memory_upload_intents_status_check check (status in ('created', 'finalized', 'expired', 'rejected')),
  constraint shared_memory_upload_intents_moderation_check check (moderation_status in ('pending', 'approved', 'rejected')),
  constraint shared_memory_upload_intents_size_check check (file_size_bytes > 0 and max_file_size_bytes > 0 and file_size_bytes <= max_file_size_bytes),
  constraint shared_memory_upload_intents_extension_check check (extension ~ '^[a-z0-9]+$'),
  constraint shared_memory_upload_intents_path_check check (
    storage_path ~ ('^memories/' || room_id::text || '/' || uploader_id::text || '/' || id::text || '/[A-Za-z0-9._~-]+$')
  )
);

create index if not exists shared_memory_upload_intents_room_idx
  on public.shared_memory_upload_intents(room_id, created_at desc);
create index if not exists shared_memory_upload_intents_uploader_idx
  on public.shared_memory_upload_intents(uploader_id, created_at desc);
create index if not exists shared_memory_upload_intents_cleanup_idx
  on public.shared_memory_upload_intents(status, expires_at);

alter table public.shared_memory_upload_intents enable row level security;

drop policy if exists "Users can read own memory upload intents" on public.shared_memory_upload_intents;
create policy "Users can read own memory upload intents"
  on public.shared_memory_upload_intents for select to authenticated
  using (
    uploader_id = auth.uid()
    and public.can_read_shared_memory(room_id)
  );

alter table public.shared_memory_photos
  add column if not exists uploader_id uuid references public.profiles(id) on delete set null,
  add column if not exists upload_intent_id uuid references public.shared_memory_upload_intents(id) on delete set null,
  add column if not exists moderation_status text not null default 'approved',
  add column if not exists moderation_reason text,
  add column if not exists moderated_at timestamptz,
  add column if not exists file_size_bytes bigint,
  add column if not exists mime_type text,
  add column if not exists duration_ms integer;

alter table public.shared_memory_photos
  drop constraint if exists shared_memory_photos_moderation_status_check;
alter table public.shared_memory_photos
  add constraint shared_memory_photos_moderation_status_check
  check (moderation_status in ('pending', 'approved', 'rejected'));

create index if not exists shared_memory_photos_upload_intent_idx
  on public.shared_memory_photos(upload_intent_id);
create index if not exists shared_memory_photos_moderation_idx
  on public.shared_memory_photos(room_id, moderation_status, created_at desc);
create index if not exists shared_memory_photos_storage_path_idx
  on public.shared_memory_photos(storage_path);

create or replace function public.memory_upload_intent_allows_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.shared_memory_upload_intents intent
      where intent.storage_path = object_name
        and intent.uploader_id = auth.uid()
        and intent.status = 'created'
        and intent.expires_at > now()
        and public.can_read_shared_memory(intent.room_id)
        and not public.shared_memory_room_has_blocked_relationship(intent.room_id, intent.uploader_name)
    ),
    false
  );
$$;

grant execute on function public.memory_upload_intent_allows_object(text) to authenticated, service_role;

create or replace function public.can_read_memory_media_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.shared_memory_photos photo
      where photo.storage_path = object_name
        and public.can_read_shared_memory(photo.room_id)
        and (
          coalesce(photo.moderation_status, 'approved') = 'approved'
          or (
            coalesce(photo.moderation_status, 'approved') = 'pending'
            and photo.uploader_name = public.current_profile_name()
          )
        )
    ),
    false
  );
$$;

grant execute on function public.can_read_memory_media_object(text) to authenticated, service_role;

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

    if v_intent.id is null then
      raise exception 'shared_memory_photo_upload_intent_not_found' using errcode = '23503';
    end if;

    if v_intent.room_id <> new.room_id
      or v_intent.uploader_name <> new.uploader_name
      or v_intent.uploader_id <> new.uploader_id
      or v_intent.storage_path <> new.storage_path
      or v_intent.media_type <> new.media_type
    then
      raise exception 'shared_memory_photo_upload_intent_mismatch' using errcode = '23514';
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

drop policy if exists "Photos readable by participants" on public.shared_memory_photos;
drop policy if exists "Photos readable by room members" on public.shared_memory_photos;
create policy "Photos readable by participants"
  on public.shared_memory_photos for select to authenticated
  using (
    public.can_read_shared_memory(room_id)
    and (
      coalesce(moderation_status, 'approved') = 'approved'
      or (
        coalesce(moderation_status, 'approved') = 'pending'
        and uploader_name = public.current_profile_name()
      )
    )
  );

drop policy if exists "Room members can add photos" on public.shared_memory_photos;
create policy "Upload intents finalize memory photos"
  on public.shared_memory_photos for insert to authenticated
  with check (
    uploader_name = public.current_profile_name()
    and uploader_id = auth.uid()
    and upload_intent_id is not null
    and exists (
      select 1
      from public.shared_memory_upload_intents intent
      where intent.id = upload_intent_id
        and intent.room_id = room_id
        and intent.uploader_id = auth.uid()
        and intent.storage_path = storage_path
        and intent.status = 'finalized'
    )
  );

drop policy if exists "Memory members can view memory media" on storage.objects;
create policy "Memory members can view memory media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'memory-media'
    and public.can_read_memory_media_object(name)
  );

drop policy if exists "Memory members can upload own memory media" on storage.objects;
create policy "Memory members can upload own memory media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'memory-media'
    and coalesce((storage.foldername(name))[1], '') = 'memories'
    and public.memory_upload_intent_allows_object(name)
  );

drop policy if exists "Memory members can delete own memory media" on storage.objects;
create policy "Memory members can delete own memory media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'memory-media'
    and coalesce((storage.foldername(name))[1], '') = 'memories'
    and (
      (storage.foldername(name))[3] = public.current_profile_name()
      or (storage.foldername(name))[3] = auth.uid()::text
    )
    and public.can_read_shared_memory(public.memory_media_room_id(name))
  );
