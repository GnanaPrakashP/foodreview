-- Publish Table Memory media after the private source upload is verified,
-- while keeping derivative processing asynchronous and in-place.

alter table public.shared_memory_messages
  add column if not exists activity_kind text not null default 'chat';

alter table public.shared_memory_messages
  drop constraint if exists shared_memory_messages_activity_kind_check;
alter table public.shared_memory_messages
  add constraint shared_memory_messages_activity_kind_check
  check (activity_kind in ('chat', 'media'));

-- Historical rooms may retain messages from members who later left. The
-- ordinary write guard correctly rejects edits by/for former members, but
-- this one data-only classification backfill must cover those immutable
-- historical messages as well. Disable only that guard for the exact update;
-- PostgreSQL rolls the trigger state back if the migration fails.
alter table public.shared_memory_messages
  disable trigger shared_memory_messages_security_guard;

update public.shared_memory_messages message
set activity_kind = 'media'
where message.activity_kind = 'chat'
  and exists (
    select 1 from public.shared_memory_photos photo
    where photo.message_id = message.id
  );

alter table public.shared_memory_messages
  enable trigger shared_memory_messages_security_guard;

alter table public.shared_memory_photos
  add column if not exists processing_status text,
  add column if not exists processing_failure_code text;

-- The same historical-member condition applies to legacy media rows. This
-- guard is replaced below with the split ready/processing guards, so bypass it
-- only while setting the initial ready classification.
alter table public.shared_memory_photos
  disable trigger shared_memory_photos_security_guard;

update public.shared_memory_photos
set processing_status = 'ready'
where media_asset_id is not null
  and processing_status is null;

alter table public.shared_memory_photos
  enable trigger shared_memory_photos_security_guard;

alter table public.shared_memory_photos
  drop constraint if exists shared_memory_photos_processing_status_check;
alter table public.shared_memory_photos
  add constraint shared_memory_photos_processing_status_check
  check (
    (media_asset_id is null and processing_status is null)
    or
    (media_asset_id is not null and processing_status in (
      'uploaded', 'processing', 'ready', 'failed', 'rejected', 'cancelled'
    ))
  );

alter table public.shared_memory_photos
  drop constraint if exists shared_memory_photos_processing_failure_code_check;
alter table public.shared_memory_photos
  add constraint shared_memory_photos_processing_failure_code_check
  check (
    processing_failure_code is null
    or processing_failure_code ~ '^[a-z0-9_]{1,80}$'
  );

-- A deterministic processing rejection must remain visible to its uploader so
-- the app can render the permanent failure state. It stays fail-closed to all
-- other members, just like legacy pending moderation.
drop policy if exists "Photos readable by participants" on public.shared_memory_photos;
create policy "Photos readable by participants"
on public.shared_memory_photos for select to authenticated
using (
  public.can_read_shared_memory(room_id)
  and (
    coalesce(moderation_status, 'approved') = 'approved'
    or (
      coalesce(moderation_status, 'approved') in ('pending', 'rejected')
      and uploader_name = public.current_profile_name()
    )
  )
);

create or replace function public.validate_shared_memory_processing_photo_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.media_assets%rowtype;
  v_message_author_name text;
  v_message_room_id uuid;
  v_profile_username text;
begin
  if new.media_asset_id is null or new.processing_status = 'ready' then
    return new;
  end if;
  if new.storage_path is not null or new.public_url is not null or new.upload_intent_id is not null then
    raise exception 'shared_memory_processed_media_location_forbidden' using errcode = '23514';
  end if;
  if new.uploader_id is null then
    raise exception 'shared_memory_processed_media_uploader_required' using errcode = '23514';
  end if;

  select profile.username into v_profile_username
  from public.profiles profile
  where profile.id = new.uploader_id;
  if v_profile_username is distinct from new.uploader_name then
    raise exception 'shared_memory_photo_uploader_id_mismatch' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.shared_memory_members member
    where member.room_id = new.room_id and member.user_name = new.uploader_name
  ) then
    raise exception 'shared_memory_photo_uploader_not_room_member' using errcode = '42501';
  end if;
  if public.shared_memory_room_has_blocked_relationship(new.room_id, new.uploader_name) then
    raise exception 'shared_memory_blocked_relationship' using errcode = '42501';
  end if;

  if new.message_id is null then
    raise exception 'shared_memory_photo_message_not_found' using errcode = '23503';
  end if;
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

  select asset.* into v_asset
  from public.media_assets asset
  where asset.id = new.media_asset_id;
  if v_asset.id is null then
    raise exception 'shared_memory_media_asset_not_found' using errcode = '23503';
  end if;
  if v_asset.owner_id <> new.uploader_id
    or v_asset.owner_name <> new.uploader_name
    or v_asset.surface <> 'memory'
    or v_asset.media_type <> new.media_type
    or v_asset.status <> new.processing_status
    or v_asset.status not in ('uploaded', 'processing', 'failed', 'rejected', 'cancelled')
    or v_asset.access_class <> 'memory_private'
    or v_asset.visibility <> 'private'
    or v_asset.privacy_state <> 'stable'
    or v_asset.source_bucket_id <> 'media-sources'
    or v_asset.uploaded_at is null
    or v_asset.consumed_at is not null
    or v_asset.source_storage_path !~ (
      '^sources/memory/' || v_asset.owner_id::text || '/' || v_asset.id::text || '/original\.[A-Za-z0-9]+$'
    )
  then
    raise exception 'shared_memory_media_asset_mismatch' using errcode = '23514';
  end if;
  if new.moderation_status <> (case
      when v_asset.status in ('failed', 'rejected', 'cancelled') then 'rejected'
      else 'approved'
    end)
  then
    raise exception 'shared_memory_media_moderation_state_mismatch' using errcode = '23514';
  end if;
  if new.processing_failure_code is distinct from (case
      when v_asset.status in ('failed', 'rejected', 'cancelled') then v_asset.failure_code
      else null
    end)
  then
    raise exception 'shared_memory_media_failure_state_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_shared_memory_processing_photo_v1()
  from public, anon, authenticated;
grant execute on function public.validate_shared_memory_processing_photo_v1()
  to service_role;

drop trigger if exists shared_memory_photos_security_guard on public.shared_memory_photos;
create trigger shared_memory_photos_security_guard
before insert or update on public.shared_memory_photos
for each row
when (new.media_asset_id is null or new.processing_status = 'ready')
execute function public.validate_shared_memory_photo_integrity();

drop trigger if exists shared_memory_processing_photos_security_guard on public.shared_memory_photos;
create trigger shared_memory_processing_photos_security_guard
before insert or update on public.shared_memory_photos
for each row
when (new.media_asset_id is not null and new.processing_status <> 'ready')
execute function public.validate_shared_memory_processing_photo_v1();

create or replace function public.prepare_attached_memory_asset_ready_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.surface = 'memory'
    and new.status = 'ready'
    and old.status is distinct from 'ready'
    and exists (
      select 1 from public.shared_memory_photos photo
      where photo.media_asset_id = new.id
    )
  then
    new.consumed_at := coalesce(new.consumed_at, now());
  end if;
  return new;
end;
$$;

revoke all on function public.prepare_attached_memory_asset_ready_v1()
  from public, anon, authenticated;
grant execute on function public.prepare_attached_memory_asset_ready_v1()
  to service_role;

drop trigger if exists prepare_attached_memory_asset_ready on public.media_assets;
create trigger prepare_attached_memory_asset_ready
before update of status on public.media_assets
for each row execute function public.prepare_attached_memory_asset_ready_v1();

create or replace function public.sync_shared_memory_photo_from_asset_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.surface <> 'memory' or not exists (
    select 1 from public.shared_memory_photos photo
    where photo.media_asset_id = new.id
  ) then
    return new;
  end if;

  if new.status = 'ready' then
    update public.shared_memory_photos photo
    set
      processing_status = 'ready',
      processing_failure_code = null,
      moderation_status = 'approved',
      moderation_reason = null,
      moderated_at = coalesce(new.moderated_at, now()),
      image_width = canonical.width,
      image_height = canonical.height,
      file_size_bytes = canonical.file_size_bytes,
      mime_type = canonical.mime_type,
      duration_ms = coalesce(canonical.duration_ms, new.duration_ms)
    from public.media_derivatives canonical
    where photo.media_asset_id = new.id
      and canonical.asset_id = new.id
      and canonical.kind = 'canonical'
      and canonical.bucket_id = 'media-private'
      and canonical.public_url is null;
  elsif new.status in ('uploaded', 'processing') then
    update public.shared_memory_photos photo
    set
      processing_status = new.status,
      processing_failure_code = null,
      moderation_status = 'approved',
      moderation_reason = null
    where photo.media_asset_id = new.id;
  elsif new.status in ('failed', 'rejected', 'cancelled') then
    update public.shared_memory_photos photo
    set
      processing_status = new.status,
      processing_failure_code = new.failure_code,
      moderation_status = 'rejected',
      moderation_reason = new.failure_code,
      moderated_at = now()
    where photo.media_asset_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_shared_memory_photo_from_asset_v1()
  from public, anon, authenticated;
grant execute on function public.sync_shared_memory_photo_from_asset_v1()
  to service_role;

drop trigger if exists sync_shared_memory_photo_from_asset on public.media_assets;
create trigger sync_shared_memory_photo_from_asset
after update of status, failure_code, moderation_status on public.media_assets
for each row execute function public.sync_shared_memory_photo_from_asset_v1();

create or replace function public.attach_shared_memory_media_assets_v3(
  p_room_id uuid,
  p_owner_id uuid,
  p_owner_name text,
  p_body text,
  p_reply_to_message_id uuid,
  p_client_id text,
  p_client_created_at timestamptz,
  p_client_sequence bigint,
  p_client_order_key text,
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
    or p_client_created_at is null
    or p_client_created_at > now() + interval '5 minutes'
    or p_client_sequence is null
    or p_client_sequence < 0
    or p_client_sequence > 9007199254740991
    or p_client_order_key is null
    or char_length(p_client_order_key) not between 16 and 200
    or p_client_order_key !~ '^[ -~]+$'
    or right(p_client_order_key, char_length(p_client_id) + 1) <> ':' || p_client_id
  then
    raise exception 'shared_memory_media_attach_invalid' using errcode = '22023';
  end if;

  select array_agg(requested.asset_id order by requested.position), count(*)
  into v_asset_ids, v_asset_count
  from unnest(coalesce(p_asset_ids, '{}'::uuid[])) with ordinality requested(asset_id, position)
  where requested.asset_id is not null;
  if v_asset_count < 1
    or v_asset_count > 10
    or (select count(distinct item.asset_id) from unnest(v_asset_ids) item(asset_id)) <> v_asset_count
  then
    raise exception 'shared_memory_media_attach_assets_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_owner_id
      and profile.username = p_owner_name
      and coalesce(profile.account_status, 'active') = 'active'
      and profile.deletion_started_at is null
  ) then
    raise exception 'shared_memory_media_attach_owner_invalid' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.shared_memory_members member
    where member.room_id = p_room_id and member.user_name = p_owner_name
  ) then
    raise exception 'shared_memory_media_attach_room_not_found' using errcode = '42501';
  end if;
  if public.shared_memory_room_has_blocked_relationship(p_room_id, p_owner_name) then
    raise exception 'shared_memory_blocked_relationship' using errcode = '42501';
  end if;
  if p_reply_to_message_id is not null and not exists (
    select 1 from public.shared_memory_messages message
      where message.id = p_reply_to_message_id and message.room_id = p_room_id
    union all
    select 1 from public.shared_memory_dishes dish
      where dish.id = p_reply_to_message_id and dish.room_id = p_room_id
  ) then
    raise exception 'shared_memory_media_reply_invalid' using errcode = '23514';
  end if;

  select message.* into v_message
  from public.shared_memory_messages message
  where message.room_id = p_room_id
    and message.author_name = p_owner_name
    and message.client_id = p_client_id
  for update;

  if v_message.id is not null then
    if v_message.body <> p_body
      or v_message.reply_to_message_id is distinct from p_reply_to_message_id
      or v_message.client_created_at is distinct from p_client_created_at
      or v_message.client_sequence is distinct from p_client_sequence
      or v_message.client_order_key is distinct from p_client_order_key
      or v_message.activity_kind <> 'media'
    then
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
    perform 1 from public.media_assets asset
    where asset.id = any(v_asset_ids)
    order by asset.id
    for update;

    select count(*) into v_asset_count
    from public.media_assets asset
    where asset.id = any(v_asset_ids)
      and asset.owner_id = p_owner_id
      and asset.owner_name = p_owner_name
      and asset.surface = 'memory'
      and asset.status in ('uploaded', 'processing', 'ready')
      and asset.access_class = 'memory_private'
      and asset.visibility = 'private'
      and asset.privacy_state = 'stable'
      and asset.source_bucket_id = 'media-sources'
      and asset.uploaded_at is not null
      and asset.consumed_at is null
      and not exists (
        select 1 from public.shared_memory_photos photo
        where photo.media_asset_id = asset.id
      );
    if v_asset_count <> cardinality(v_asset_ids) then
      raise exception 'shared_memory_media_assets_not_publishable' using errcode = '23514';
    end if;

    update public.media_assets asset
    set consumed_at = now(), updated_at = now()
    where asset.id = any(v_asset_ids)
      and asset.status = 'ready'
      and asset.consumed_at is null;

    insert into public.shared_memory_messages (
      room_id, author_name, body, reply_to_message_id, client_id,
      client_created_at, client_sequence, client_order_key, activity_kind
    ) values (
      p_room_id, p_owner_name, p_body, p_reply_to_message_id, p_client_id,
      p_client_created_at, p_client_sequence, p_client_order_key, 'media'
    ) returning * into v_message;

    insert into public.shared_memory_photos (
      room_id, message_id, uploader_id, uploader_name, public_url,
      storage_path, media_asset_id, media_type, image_width, image_height,
      position, upload_intent_id, moderation_status, moderation_reason,
      moderated_at, processing_status, processing_failure_code,
      file_size_bytes, mime_type, duration_ms
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
      coalesce(canonical.width, asset.original_width),
      coalesce(canonical.height, asset.original_height),
      requested.position - 1,
      null,
      'approved',
      null,
      case when asset.status = 'ready' then coalesce(asset.moderated_at, now()) else now() end,
      asset.status,
      null,
      coalesce(canonical.file_size_bytes, asset.original_file_size_bytes),
      coalesce(canonical.mime_type, asset.original_mime_type),
      coalesce(canonical.duration_ms, asset.duration_ms)
    from unnest(v_asset_ids) with ordinality requested(asset_id, position)
    join public.media_assets asset on asset.id = requested.asset_id
    left join public.media_derivatives canonical
      on canonical.asset_id = asset.id
      and canonical.kind = 'canonical'
      and canonical.bucket_id = 'media-private'
      and canonical.public_url is null
    order by requested.position;
  end if;

  select jsonb_build_object(
    'message', to_jsonb(message_row),
    'photos', coalesce((
      select jsonb_agg(to_jsonb(photo_row) order by photo_row.position, photo_row.id)
      from public.shared_memory_photos photo_row
      where photo_row.message_id = message_row.id
    ), '[]'::jsonb)
  ) into v_result
  from public.shared_memory_messages message_row
  where message_row.id = v_message.id;
  return v_result;
end;
$$;

revoke all on function public.attach_shared_memory_media_assets_v3(
  uuid, uuid, text, text, uuid, text, timestamptz, bigint, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.attach_shared_memory_media_assets_v3(
  uuid, uuid, text, text, uuid, text, timestamptz, bigint, text, uuid[]
) to service_role;

-- Media messages notify through their now-existing attachment, never through
-- the earlier message insert. Both rows and the private source authorization
-- still commit atomically in attach_shared_memory_media_assets_v3().
create or replace function public.enqueue_table_memory_activity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activity_id uuid;
  v_actor_name text;
  v_actor_user_id uuid;
  v_created_at timestamptz;
  v_kind text;
  v_message text;
  v_notification_id uuid;
  v_notification_key text;
  v_room_id uuid;
  v_recipient record;
begin
  if tg_table_name = 'shared_memory_messages' then
    if tg_op <> 'INSERT' or new.activity_kind = 'media' then return new; end if;
    v_activity_id := new.id;
    v_actor_name := new.author_name;
    v_created_at := new.created_at;
    v_kind := 'message';
    v_message := 'You have a new Table Memory message.';
    v_room_id := new.room_id;
  elsif tg_table_name = 'shared_memory_dishes' then
    if tg_op <> 'INSERT' then return new; end if;
    v_activity_id := new.id;
    v_actor_name := new.added_by;
    v_created_at := new.created_at;
    v_kind := 'dish';
    v_message := 'A dish was added to your Table Memory.';
    v_room_id := new.room_id;
  elsif tg_table_name = 'shared_memory_photos' then
    if tg_op = 'UPDATE' and (
      coalesce(old.moderation_status, 'pending') = 'approved'
      or coalesce(new.moderation_status, 'pending') <> 'approved'
    ) then return new; end if;
    if tg_op = 'INSERT' and coalesce(new.moderation_status, 'approved') <> 'approved' then return new; end if;
    v_activity_id := new.id;
    v_actor_name := new.uploader_name;
    v_created_at := new.created_at;
    v_kind := 'media';
    v_message := 'Media was added to your Table Memory.';
    v_room_id := new.room_id;
  else
    return new;
  end if;

  select profile.id into v_actor_user_id
  from public.profiles profile
  where profile.username = v_actor_name
  limit 1;

  for v_recipient in
    select profile.id as user_id, member.user_name
    from public.shared_memory_members member
    join public.profiles profile on profile.username = member.user_name
    where member.room_id = v_room_id
      and member.user_name <> v_actor_name
      and not public.shared_memory_room_has_blocked_relationship(v_room_id, member.user_name)
  loop
    v_notification_key := encode(extensions.digest(
      convert_to('table-memory:' || v_kind || ':' || v_activity_id::text || ':' || v_recipient.user_id::text, 'UTF8'),
      'sha256'
    ), 'hex');
    insert into public.notifications (
      actor_name, actor_user_id, created_at, dedupe_key, entity_id,
      entity_type, is_read, message, metadata, read, recipient_name,
      recipient_user_id, title, type, updated_at
    ) values (
      v_actor_name, v_actor_user_id, v_created_at, v_notification_key,
      v_room_id::text, 'TABLE_MEMORY', false, v_message,
      jsonb_build_object('activityId', v_activity_id::text, 'kind', v_kind),
      false, v_recipient.user_name, v_recipient.user_id, 'Table Memory',
      'TABLE_MEMORY_ACTIVITY', v_created_at
    )
    on conflict (dedupe_key) where dedupe_key is not null do update
      set dedupe_key = excluded.dedupe_key
    returning id into v_notification_id;

    if v_kind = 'message' and coalesce((
      select setting.push_enabled and setting.memory_activity
      from public.notification_settings setting
      where setting.user_name = v_recipient.user_name
    ), true) then
      insert into public.push_delivery_jobs (
        correlation_id, dedupe_key, notification_id, notification_type,
        push_token_id, status, user_id
      )
      select
        v_activity_id::text,
        encode(extensions.digest(
          convert_to(v_notification_id::text || ':' || token.id::text, 'UTF8'),
          'sha256'
        ), 'hex'),
        v_notification_id, 'TABLE_MEMORY_ACTIVITY', token.id, 'queued',
        v_recipient.user_id
      from public.push_tokens token
      where token.user_id = v_recipient.user_id and token.disabled_at is null
      on conflict (dedupe_key) do nothing;
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.enqueue_table_memory_activity_v1()
  from public, anon, authenticated;

comment on function public.attach_shared_memory_media_assets_v3(
  uuid, uuid, text, text, uuid, text, timestamptz, bigint, text, uuid[]
) is 'Atomically publishes verified private room sources before asynchronous derivatives are ready.';

-- A logical media message is only a container for its attachment rows. Count
-- it on the Media tab, not a second time on Chat.
create or replace function public.shared_memory_room_summaries_v4(
  p_limit integer default 13,
  p_before_timeline_date date default null,
  p_before_room_id uuid default null
)
returns table(
  id uuid,
  title text,
  occasion_type text,
  occasion_confidence numeric,
  occasion_confirmed_by_user boolean,
  theme_key text,
  restaurant_name text,
  area text,
  visit_date date,
  source_post_id uuid,
  created_by text,
  participant_count bigint,
  photo_count bigint,
  message_count bigint,
  dish_count bigint,
  unread_count bigint,
  unread_chat_count bigint,
  unread_media_count bigint,
  unread_dish_count bigint,
  latest_message text,
  latest_activity_at timestamptz,
  place_names text[],
  created_at timestamptz,
  timeline_date date
)
language sql
stable
security definer
set search_path = ''
as $$
with viewer as (
  select public.current_profile_name() as username
), rooms as (
  select
    room.*,
    member.created_at as member_since,
    coalesce(room.visit_date, (room.created_at at time zone 'UTC')::date) as timeline_date
  from public.shared_memory_members member
  join public.shared_memory_rooms room on room.id = member.room_id
  cross join viewer
  where viewer.username is not null
    and member.user_name = viewer.username
    and not public.shared_memory_room_has_blocked_relationship(room.id, viewer.username)
    and (
      p_before_timeline_date is null
      or coalesce(room.visit_date, (room.created_at at time zone 'UTC')::date) < p_before_timeline_date
      or (
        p_before_room_id is not null
        and coalesce(room.visit_date, (room.created_at at time zone 'UTC')::date) = p_before_timeline_date
        and room.id < p_before_room_id
      )
    )
  order by timeline_date desc, room.id desc
  limit least(greatest(coalesce(p_limit, 13), 1), 51)
), counts as (
  select
    room.id,
    (select count(*) from public.shared_memory_messages message
      where message.room_id = room.id
        and message.activity_kind = 'chat'
        and message.author_name <> (select username from viewer)
        and message.created_at > greatest(room.member_since, coalesce((
          select read.last_read_at from public.shared_memory_reads read
          where read.room_id = room.id and read.user_name = (select username from viewer)
        ), '-infinity'::timestamptz))) as unread_chat_count,
    (select count(*) from public.shared_memory_photos photo
      where photo.room_id = room.id
        and coalesce(photo.moderation_status, 'approved') = 'approved'
        and photo.uploader_name <> (select username from viewer)
        and photo.created_at > greatest(room.member_since, coalesce((
          select read.last_media_read_at from public.shared_memory_reads read
          where read.room_id = room.id and read.user_name = (select username from viewer)
        ), '-infinity'::timestamptz))) as unread_media_count,
    (select count(*) from public.shared_memory_dishes dish
      where dish.room_id = room.id
        and dish.added_by <> (select username from viewer)
        and dish.created_at > greatest(room.member_since, coalesce((
          select read.last_dishes_read_at from public.shared_memory_reads read
          where read.room_id = room.id and read.user_name = (select username from viewer)
        ), '-infinity'::timestamptz))) as unread_dish_count
  from rooms room
)
select
  room.id,
  room.title,
  room.occasion_type,
  room.occasion_confidence,
  room.occasion_confirmed_by_user,
  room.theme_key,
  room.restaurant_name,
  room.area,
  room.visit_date,
  room.source_post_id,
  room.created_by,
  (select count(*) from public.shared_memory_members member where member.room_id = room.id),
  (select count(*) from public.shared_memory_photos photo
    where photo.room_id = room.id and coalesce(photo.moderation_status, 'approved') = 'approved'),
  (select count(*) from public.shared_memory_messages message where message.room_id = room.id),
  (select count(*) from public.shared_memory_dishes dish where dish.room_id = room.id),
  counts.unread_chat_count + counts.unread_media_count + counts.unread_dish_count,
  counts.unread_chat_count,
  counts.unread_media_count,
  counts.unread_dish_count,
  (select left(message.body, 160) from public.shared_memory_messages message
    where message.room_id = room.id order by message.created_at desc, message.id desc limit 1),
  greatest(
    room.updated_at,
    coalesce((select max(message.created_at) from public.shared_memory_messages message where message.room_id = room.id), room.created_at),
    coalesce((select max(photo.created_at) from public.shared_memory_photos photo where photo.room_id = room.id and coalesce(photo.moderation_status, 'approved') = 'approved'), room.created_at),
    coalesce((select max(dish.created_at) from public.shared_memory_dishes dish where dish.room_id = room.id), room.created_at)
  ),
  array_remove(array_prepend(room.restaurant_name, array(
    select stop.name from public.shared_memory_stops stop
    where stop.room_id = room.id order by stop.position, stop.id
  )), null),
  room.created_at,
  room.timeline_date
from rooms room
join counts on counts.id = room.id
order by room.timeline_date desc, room.id desc;
$$;

revoke all on function public.shared_memory_room_summaries_v4(integer, date, uuid) from public, anon;
grant execute on function public.shared_memory_room_summaries_v4(integer, date, uuid)
  to authenticated, service_role;

comment on function public.shared_memory_room_summaries_v4(integer, date, uuid) is
  'Member-scoped Table Memory timeline with media containers excluded from Chat unread.';
