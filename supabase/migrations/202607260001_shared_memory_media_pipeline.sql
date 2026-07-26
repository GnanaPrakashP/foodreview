-- Table Memory image/video migration to the shared, processed media pipeline.
--
-- Legacy memory-media rows remain valid and readable. New processed rows link
-- to media_assets and deliberately keep storage_path/public_url null: binary
-- locations are delivery details, not durable room state.

alter table public.shared_memory_photos
  alter column storage_path drop not null;

create unique index if not exists shared_memory_photos_media_asset_unique_idx
  on public.shared_memory_photos(media_asset_id)
  where media_asset_id is not null;

alter table public.shared_memory_photos
  drop constraint if exists shared_memory_photos_media_source_check;
alter table public.shared_memory_photos
  add constraint shared_memory_photos_media_source_check
  check (
    (
      media_asset_id is null
      and nullif(btrim(storage_path), '') is not null
    )
    or
    (
      media_asset_id is not null
      and storage_path is null
      and public_url is null
      and upload_intent_id is null
    )
  ) not valid;
alter table public.shared_memory_photos
  validate constraint shared_memory_photos_media_source_check;

create or replace function public.validate_shared_memory_photo_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.media_assets%rowtype;
  v_derivative_count integer;
  v_intent public.shared_memory_upload_intents%rowtype;
  v_message_author_name text;
  v_message_room_id uuid;
  v_part text;
  v_parts text[];
  v_profile_username text;
begin
  if new.uploader_id is not null then
    select profile.username
    into v_profile_username
    from public.profiles profile
    where profile.id = new.uploader_id;

    if v_profile_username is distinct from new.uploader_name then
      raise exception 'shared_memory_photo_uploader_id_mismatch' using errcode = '23514';
    end if;
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

  if new.media_asset_id is not null then
    if new.storage_path is not null or new.public_url is not null or new.upload_intent_id is not null then
      raise exception 'shared_memory_processed_media_location_forbidden' using errcode = '23514';
    end if;
    if new.uploader_id is null then
      raise exception 'shared_memory_processed_media_uploader_required' using errcode = '23514';
    end if;

    select asset.*
    into v_asset
    from public.media_assets asset
    where asset.id = new.media_asset_id;

    if v_asset.id is null then
      raise exception 'shared_memory_media_asset_not_found' using errcode = '23503';
    end if;
    if v_asset.owner_id <> new.uploader_id
      or v_asset.owner_name <> new.uploader_name
      or v_asset.surface <> 'memory'
      or v_asset.media_type <> new.media_type
      or v_asset.status <> 'ready'
      or v_asset.access_class <> 'memory_private'
      or v_asset.visibility <> 'private'
      or v_asset.privacy_state <> 'stable'
      or v_asset.moderation_status <> 'approved'
      or v_asset.consumed_at is null
      or new.moderation_status <> 'approved'
    then
      raise exception 'shared_memory_media_asset_mismatch' using errcode = '23514';
    end if;

    select count(*)
    into v_derivative_count
    from public.media_derivatives derivative
    where derivative.asset_id = v_asset.id
      and derivative.bucket_id = 'media-private'
      and derivative.public_url is null
      and derivative.storage_path like (
        'memories/' || v_asset.owner_id::text || '/' || v_asset.id::text || '/%'
      )
      and derivative.kind = any(
        case when v_asset.media_type = 'image'
          then array['canonical', 'thumbnail']::text[]
          else array['canonical', 'poster']::text[]
        end
      );

    if v_derivative_count <> 2 then
      raise exception 'shared_memory_media_derivatives_incomplete' using errcode = '23514';
    end if;
    return new;
  end if;

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
  if v_parts[3] <> new.uploader_name
    and (new.uploader_id is null or v_parts[3] <> new.uploader_id::text)
  then
    raise exception 'shared_memory_storage_path_uploader_mismatch' using errcode = '23514';
  end if;
  if new.public_url is not null and new.public_url <> new.storage_path then
    raise exception 'shared_memory_photo_public_url_mismatch' using errcode = '23514';
  end if;

  if new.upload_intent_id is not null then
    select intent.*
    into v_intent
    from public.shared_memory_upload_intents intent
    where intent.id = new.upload_intent_id;

    if v_intent.id is null then
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

  return new;
end;
$$;

revoke all on function public.validate_shared_memory_photo_integrity() from public, anon;
grant execute on function public.validate_shared_memory_photo_integrity() to authenticated, service_role;

create or replace function public.attach_shared_memory_media_assets_v1(
  p_room_id uuid,
  p_owner_id uuid,
  p_owner_name text,
  p_body text,
  p_reply_to_message_id uuid,
  p_client_id text,
  p_asset_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_count integer;
  v_asset_ids uuid[];
  v_existing_asset_ids uuid[];
  v_message public.shared_memory_messages%rowtype;
  v_result jsonb;
  v_updated_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_room_id is null
    or p_owner_id is null
    or nullif(btrim(p_owner_name), '') is null
    or p_body is null
    or char_length(p_body) > 1000
    or p_client_id is null
    or p_client_id !~ '^[A-Za-z0-9._:-]{16,128}$'
  then
    raise exception 'shared_memory_media_attach_invalid' using errcode = '22023';
  end if;

  select array_agg(requested.asset_id order by requested.position), count(*)
  into v_asset_ids, v_asset_count
  from (
    select asset_id, position
    from unnest(coalesce(p_asset_ids, '{}'::uuid[])) with ordinality requested(asset_id, position)
    where asset_id is not null
  ) requested;

  if v_asset_count < 1
    or v_asset_count > 10
    or (select count(distinct item.asset_id) from unnest(v_asset_ids) item(asset_id)) <> v_asset_count
  then
    raise exception 'shared_memory_media_attach_assets_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_owner_id
      and profile.username = p_owner_name
      and coalesce(profile.account_status, 'active') = 'active'
      and profile.deletion_started_at is null
  ) then
    raise exception 'shared_memory_media_attach_owner_invalid' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.shared_memory_members member
    where member.room_id = p_room_id
      and member.user_name = p_owner_name
  ) then
    raise exception 'shared_memory_media_attach_room_not_found' using errcode = '42501';
  end if;
  if public.shared_memory_room_has_blocked_relationship(p_room_id, p_owner_name) then
    raise exception 'shared_memory_blocked_relationship' using errcode = '42501';
  end if;
  if p_reply_to_message_id is not null and not exists (
    select 1
    from public.shared_memory_messages reply
    where reply.id = p_reply_to_message_id
      and reply.room_id = p_room_id
  ) then
    raise exception 'shared_memory_media_reply_invalid' using errcode = '23514';
  end if;

  select message.*
  into v_message
  from public.shared_memory_messages message
  where message.room_id = p_room_id
    and message.author_name = p_owner_name
    and message.client_id = p_client_id
  for update;

  if v_message.id is not null then
    if v_message.body <> p_body or v_message.reply_to_message_id is distinct from p_reply_to_message_id then
      raise exception 'shared_memory_media_idempotency_mismatch' using errcode = '23505';
    end if;
    select array_agg(photo.media_asset_id order by photo.position, photo.id)
    into v_existing_asset_ids
    from public.shared_memory_photos photo
    where photo.message_id = v_message.id;
    if v_existing_asset_ids is distinct from v_asset_ids then
      raise exception 'shared_memory_media_idempotency_mismatch' using errcode = '23505';
    end if;
  else
    perform 1
    from public.media_assets asset
    where asset.id = any(v_asset_ids)
    order by asset.id
    for update;

    select count(*)
    into v_asset_count
    from public.media_assets asset
    where asset.id = any(v_asset_ids)
      and asset.owner_id = p_owner_id
      and asset.owner_name = p_owner_name
      and asset.surface = 'memory'
      and asset.status = 'ready'
      and asset.access_class = 'memory_private'
      and asset.visibility = 'private'
      and asset.privacy_state = 'stable'
      and asset.moderation_status = 'approved'
      and asset.consumed_at is null;

    if v_asset_count <> cardinality(v_asset_ids) then
      raise exception 'shared_memory_media_assets_not_ready' using errcode = '23514';
    end if;

    update public.media_assets asset
    set consumed_at = now(), updated_at = now()
    where asset.id = any(v_asset_ids)
      and asset.owner_id = p_owner_id
      and asset.surface = 'memory'
      and asset.status = 'ready'
      and asset.moderation_status = 'approved'
      and asset.consumed_at is null;
    get diagnostics v_updated_count = row_count;
    if v_updated_count <> cardinality(v_asset_ids) then
      raise exception 'shared_memory_media_asset_consume_race' using errcode = '40001';
    end if;

    insert into public.shared_memory_messages (
      room_id, author_name, body, reply_to_message_id, client_id
    ) values (
      p_room_id, p_owner_name, p_body, p_reply_to_message_id, p_client_id
    )
    returning * into v_message;

    insert into public.shared_memory_photos (
      room_id,
      message_id,
      uploader_id,
      uploader_name,
      public_url,
      storage_path,
      media_asset_id,
      media_type,
      image_width,
      image_height,
      position,
      upload_intent_id,
      moderation_status,
      moderation_reason,
      moderated_at,
      file_size_bytes,
      mime_type,
      duration_ms
    )
    select
      p_room_id,
      v_message.id,
      p_owner_id,
      p_owner_name,
      null,
      null,
      asset.id,
      asset.media_type,
      canonical.width,
      canonical.height,
      requested.position - 1,
      null,
      'approved',
      null,
      coalesce(asset.moderated_at, now()),
      canonical.file_size_bytes,
      canonical.mime_type,
      coalesce(canonical.duration_ms, asset.duration_ms)
    from unnest(v_asset_ids) with ordinality requested(asset_id, position)
    join public.media_assets asset on asset.id = requested.asset_id
    join public.media_derivatives canonical
      on canonical.asset_id = asset.id
      and canonical.kind = 'canonical'
      and canonical.bucket_id = 'media-private'
      and canonical.public_url is null
    order by requested.position;
  end if;

  select jsonb_build_object(
    'message', to_jsonb(message_row) - 'client_id',
    'photos', coalesce(
      (
        select jsonb_agg(to_jsonb(photo_row) order by photo_row.position, photo_row.id)
        from public.shared_memory_photos photo_row
        where photo_row.message_id = message_row.id
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from public.shared_memory_messages message_row
  where message_row.id = v_message.id;

  return v_result;
end;
$$;

revoke all on function public.attach_shared_memory_media_assets_v1(uuid, uuid, text, text, uuid, text, uuid[])
  from public;
grant execute on function public.attach_shared_memory_media_assets_v1(uuid, uuid, text, text, uuid, text, uuid[])
  to anon, authenticated, service_role;

create or replace function public.delete_shared_memory_media_items_v1(
  p_room_id uuid,
  p_owner_id uuid,
  p_owner_name text,
  p_message_ids uuid[],
  p_photo_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_ids uuid[];
  v_legacy_paths text[];
  v_message_ids uuid[];
  v_photo_ids uuid[];
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_room_id is null or p_owner_id is null or nullif(btrim(p_owner_name), '') is null then
    raise exception 'shared_memory_media_delete_invalid' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct id), '{}'::uuid[])
  into v_message_ids
  from unnest(coalesce(p_message_ids, '{}'::uuid[])) id
  where id is not null;
  select coalesce(array_agg(distinct id), '{}'::uuid[])
  into v_photo_ids
  from unnest(coalesce(p_photo_ids, '{}'::uuid[])) id
  where id is not null;

  if cardinality(v_message_ids) + cardinality(v_photo_ids) < 1
    or cardinality(v_message_ids) + cardinality(v_photo_ids) > 100
  then
    raise exception 'shared_memory_media_delete_selection_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_owner_id and profile.username = p_owner_name
  ) or not exists (
    select 1
    from public.shared_memory_members member
    where member.room_id = p_room_id and member.user_name = p_owner_name
  ) then
    raise exception 'shared_memory_media_delete_not_found' using errcode = '42501';
  end if;

  select
    coalesce(array_agg(distinct photo.media_asset_id) filter (where photo.media_asset_id is not null), '{}'::uuid[]),
    coalesce(array_agg(distinct photo.storage_path) filter (where photo.storage_path is not null), '{}'::text[])
  into v_asset_ids, v_legacy_paths
  from public.shared_memory_photos photo
  left join public.shared_memory_messages message on message.id = photo.message_id
  where photo.room_id = p_room_id
    and (photo.uploader_id is null or photo.uploader_id = p_owner_id)
    and photo.uploader_name = p_owner_name
    and (
      photo.id = any(v_photo_ids)
      or (
        photo.message_id = any(v_message_ids)
        and message.author_name = p_owner_name
      )
    );

  delete from public.shared_memory_messages message
  where message.room_id = p_room_id
    and message.author_name = p_owner_name
    and message.id = any(v_message_ids);

  delete from public.shared_memory_photos photo
  where photo.room_id = p_room_id
    and (photo.uploader_id is null or photo.uploader_id = p_owner_id)
    and photo.uploader_name = p_owner_name
    and photo.id = any(v_photo_ids);

  update public.media_assets asset
  set
    consumed_at = null,
    failure_code = 'owner_deleted',
    failure_reason = null,
    source_cleanup_after = now(),
    status = 'cancelled',
    updated_at = now()
  where asset.id = any(v_asset_ids)
    and asset.owner_id = p_owner_id
    and asset.surface = 'memory';

  return jsonb_build_object('legacyPaths', to_jsonb(v_legacy_paths));
end;
$$;

revoke all on function public.delete_shared_memory_media_items_v1(uuid, uuid, text, uuid[], uuid[])
  from public;
grant execute on function public.delete_shared_memory_media_items_v1(uuid, uuid, text, uuid[], uuid[])
  to anon, authenticated, service_role;

comment on function public.attach_shared_memory_media_assets_v1(uuid, uuid, text, text, uuid, text, uuid[]) is
  'Service-guarded atomic Table Memory message/media attachment for ready private media assets.';
comment on function public.delete_shared_memory_media_items_v1(uuid, uuid, text, uuid[], uuid[]) is
  'Service-guarded Table Memory deletion that detaches processed assets for asynchronous binary cleanup.';
