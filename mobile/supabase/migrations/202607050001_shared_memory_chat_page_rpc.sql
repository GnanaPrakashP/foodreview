-- Phase 2 mobile performance: fetch one bounded chat page in one RPC.
--
-- This keeps membership and media-visibility checks in Postgres, then returns
-- the page messages, their attachments, out-of-page reply snippets, display
-- names, and next cursor as one JSON payload.

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
  v_has_more boolean := false;
  v_next_created_at timestamptz := null;
  v_next_message_id uuid := null;
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
  ),
  selected_desc as (
    select *
    from paged_desc
    order by created_at desc, id desc
    limit v_limit
  ),
  selected_messages as (
    select *
    from selected_desc
    order by created_at asc, id asc
  ),
  page_state as (
    select
      (select count(*) > v_limit from paged_desc) as has_more,
      (select selected_messages.created_at from selected_messages order by created_at asc, id asc limit 1) as next_created_at,
      (select selected_messages.id from selected_messages order by created_at asc, id asc limit 1) as next_message_id
  ),
  reply_messages as (
    select
      reply.id,
      reply.room_id,
      reply.author_name,
      reply.body,
      reply.reply_to_message_id,
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
        select 1
        from selected_messages
        where selected_messages.id = reply.id
      )
  ),
  page_photos as (
    select
      photo.id,
      photo.room_id,
      photo.stop_id,
      photo.message_id,
      photo.uploader_name,
      photo.uploader_id,
      photo.public_url,
      photo.storage_path,
      photo.media_type,
      photo.image_width,
      photo.image_height,
      photo.position,
      photo.upload_intent_id,
      photo.moderation_status,
      photo.moderation_reason,
      photo.file_size_bytes,
      photo.mime_type,
      photo.duration_ms,
      photo.created_at
    from public.shared_memory_photos photo
    where photo.room_id = p_room_id
      and photo.message_id in (select selected_messages.id from selected_messages)
      and (
        coalesce(photo.moderation_status, 'approved') = 'approved'
        or (
          coalesce(photo.moderation_status, 'approved') = 'pending'
          and photo.uploader_name = v_user_name
        )
      )
  ),
  profile_names as (
    select selected_messages.author_name as username from selected_messages
    union
    select reply_messages.author_name from reply_messages
    union
    select page_photos.uploader_name from page_photos
  ),
  page_profiles as (
    select profile.username, profile.first_name, profile.last_name
    from public.profiles profile
    join profile_names on profile_names.username = profile.username
  )
  select
    page_state.has_more,
    page_state.next_created_at,
    page_state.next_message_id,
    jsonb_build_object(
      'messages',
      coalesce((
        select jsonb_agg(to_jsonb(selected_messages) order by selected_messages.created_at asc, selected_messages.id asc)
        from selected_messages
      ), '[]'::jsonb),
      'photos',
      coalesce((
        select jsonb_agg(to_jsonb(page_photos) order by page_photos.position asc nulls last, page_photos.created_at asc, page_photos.id asc)
        from page_photos
      ), '[]'::jsonb),
      'replyMessages',
      coalesce((
        select jsonb_agg(to_jsonb(reply_messages) order by reply_messages.created_at asc, reply_messages.id asc)
        from reply_messages
      ), '[]'::jsonb),
      'profiles',
      coalesce((
        select jsonb_agg(to_jsonb(page_profiles) order by page_profiles.username asc)
        from page_profiles
      ), '[]'::jsonb),
      'nextCursor',
      case
        when page_state.has_more and page_state.next_created_at is not null and page_state.next_message_id is not null
          then page_state.next_created_at::text || '|' || page_state.next_message_id::text
        else null
      end
    )
    into v_has_more, v_next_created_at, v_next_message_id, v_payload
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

revoke all on function public.shared_memory_chat_page(uuid, timestamptz, uuid, integer) from public;
revoke all on function public.shared_memory_chat_page(uuid, timestamptz, uuid, integer) from anon;
grant execute on function public.shared_memory_chat_page(uuid, timestamptz, uuid, integer) to authenticated, service_role;

comment on function public.shared_memory_chat_page(uuid, timestamptz, uuid, integer) is
  'Bounded Table Memory chat page payload for mobile: messages, attachments, reply snippets, display names, and next cursor in one RPC.';
