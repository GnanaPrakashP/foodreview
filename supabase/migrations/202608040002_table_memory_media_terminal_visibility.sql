-- Keep processing and terminal Table Memory media visible through the bounded
-- Chat/Media read contracts. Approved media remains visible to every member;
-- pending/rejected media is additionally visible to its uploader so a durable
-- processing card never disappears after optimistic reconciliation.

create or replace function public.shared_memory_chat_page(
  p_room_id uuid,
  p_before_created_at timestamptz default null,
  p_before_message_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_name text := public.current_profile_name();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_payload jsonb := '{}'::jsonb;
begin
  if v_user_name is null or not public.can_read_shared_memory(p_room_id) then
    raise exception 'Memory room not found' using errcode = 'P0001';
  end if;

  with paged_desc as (
    select
      message.id,
      message.room_id,
      message.author_name,
      message.body,
      message.reply_to_message_id,
      message.activity_kind,
      message.created_at,
      message.edited_at
    from public.shared_memory_messages message
    where message.room_id = p_room_id
      and (
        p_before_created_at is null
        or message.created_at < p_before_created_at
        or (
          p_before_message_id is not null
          and message.created_at = p_before_created_at
          and message.id < p_before_message_id
        )
      )
    order by message.created_at desc, message.id desc
    limit (v_limit + 1)
  ), selected_desc as (
    select * from paged_desc order by created_at desc, id desc limit v_limit
  ), selected_messages as (
    select * from selected_desc order by created_at asc, id asc
  ), page_state as (
    select
      (select count(*) > v_limit from paged_desc) as has_more,
      (select created_at from selected_messages order by created_at asc, id asc limit 1) as next_created_at,
      (select id from selected_messages order by created_at asc, id asc limit 1) as next_message_id
  ), reply_messages as (
    select
      reply.id,
      reply.room_id,
      reply.author_name,
      reply.body,
      reply.reply_to_message_id,
      reply.activity_kind,
      reply.created_at,
      reply.edited_at
    from public.shared_memory_messages reply
    where reply.room_id = p_room_id
      and reply.id in (
        select selected_messages.reply_to_message_id
        from selected_messages
        where selected_messages.reply_to_message_id is not null
      )
      and not exists (
        select 1 from selected_messages where selected_messages.id = reply.id
      )
  ), page_photos as (
    select
      photo.id,
      photo.room_id,
      photo.stop_id,
      photo.message_id,
      photo.uploader_name,
      photo.uploader_id,
      photo.media_asset_id,
      photo.media_type,
      photo.image_width,
      photo.image_height,
      photo.position,
      photo.upload_intent_id,
      photo.moderation_status,
      photo.moderation_reason,
      photo.processing_status,
      photo.processing_failure_code,
      photo.file_size_bytes,
      photo.mime_type,
      photo.duration_ms,
      photo.created_at
    from public.shared_memory_photos photo
    where photo.room_id = p_room_id
      and photo.message_id in (select id from selected_messages)
      and (
        coalesce(photo.moderation_status, 'approved') = 'approved'
        or (
          coalesce(photo.moderation_status, 'approved') in ('pending', 'rejected')
          and photo.uploader_name = v_user_name
        )
      )
  ), profile_names as (
    select author_name as username from selected_messages
    union select author_name from reply_messages
    union select uploader_name from page_photos
  ), page_profiles as (
    select profile.username, profile.first_name, profile.last_name
    from public.profiles profile
    join profile_names on profile_names.username = profile.username
  )
  select jsonb_build_object(
    'messages', coalesce((
      select jsonb_agg(to_jsonb(selected_messages) order by created_at asc, id asc)
      from selected_messages
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(to_jsonb(page_photos) order by position asc nulls last, created_at asc, id asc)
      from page_photos
    ), '[]'::jsonb),
    'replyMessages', coalesce((
      select jsonb_agg(to_jsonb(reply_messages) order by created_at asc, id asc)
      from reply_messages
    ), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(page_profiles) order by username asc)
      from page_profiles
    ), '[]'::jsonb),
    'nextCursor', case
      when page_state.has_more and page_state.next_created_at is not null and page_state.next_message_id is not null
        then page_state.next_created_at::text || '|' || page_state.next_message_id::text
      else null
    end
  ) into v_payload
  from page_state;

  return coalesce(v_payload, jsonb_build_object(
    'messages', '[]'::jsonb,
    'photos', '[]'::jsonb,
    'replyMessages', '[]'::jsonb,
    'profiles', '[]'::jsonb,
    'nextCursor', null
  ));
end;
$$;

revoke all on function public.shared_memory_chat_page(uuid, timestamptz, uuid, integer)
  from public, anon;
grant execute on function public.shared_memory_chat_page(uuid, timestamptz, uuid, integer)
  to authenticated, service_role;

comment on function public.shared_memory_chat_page(uuid, timestamptz, uuid, integer) is
  'Bounded membership-aware chat page including processing metadata and uploader-visible terminal media.';

create or replace function public.shared_memory_media_page_v1(
  p_room_id uuid,
  p_before_created_at timestamptz default null,
  p_before_photo_id uuid default null,
  p_limit integer default 30
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with viewer as (
  select public.current_profile_name() as username
), allowed as (
  select 1
  from viewer
  where viewer.username is not null and public.can_read_shared_memory(p_room_id)
), params as (
  select least(greatest(coalesce(p_limit, 30), 1), 50) row_limit
), candidates as (
  select photo.*
  from public.shared_memory_photos photo cross join viewer
  where exists (select 1 from allowed)
    and photo.room_id = p_room_id
    and (
      coalesce(photo.moderation_status, 'approved') = 'approved'
      or (
        coalesce(photo.moderation_status, 'approved') in ('pending', 'rejected')
        and photo.uploader_name = viewer.username
      )
    )
    and (
      p_before_created_at is null
      or photo.created_at < p_before_created_at
      or (
        p_before_photo_id is not null
        and photo.created_at = p_before_created_at
        and photo.id < p_before_photo_id
      )
    )
  order by photo.created_at desc, photo.id desc
  limit ((select row_limit from params) + 1)
), selected as (
  select * from candidates order by created_at desc, id desc limit (select row_limit from params)
), profiles as (
  select profile.username, profile.first_name, profile.last_name
  from public.profiles profile
  where profile.username in (select uploader_name from selected)
)
select jsonb_build_object(
  'photos', coalesce((
    select jsonb_agg(
      to_jsonb(selected) - 'storage_path' - 'public_url'
      order by created_at desc, id desc
    ) from selected
  ), '[]'::jsonb),
  'profiles', coalesce((
    select jsonb_agg(to_jsonb(profiles) order by username) from profiles
  ), '[]'::jsonb),
  'nextCursor', case when (select count(*) from candidates) > (select row_limit from params) then (
    select created_at::text || '|' || id::text
    from selected order by created_at asc, id asc limit 1
  ) else null end
);
$$;

revoke all on function public.shared_memory_media_page_v1(uuid, timestamptz, uuid, integer)
  from public, anon;
grant execute on function public.shared_memory_media_page_v1(uuid, timestamptz, uuid, integer)
  to authenticated, service_role;

comment on function public.shared_memory_media_page_v1(uuid, timestamptz, uuid, integer) is
  'Bounded membership-aware media page including uploader-visible processing and terminal rows.';
