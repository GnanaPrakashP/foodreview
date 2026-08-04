-- Carry media processing state through the incremental room sync.
--
-- `processing_status`, `processing_failure_code` and `media_asset_id` describe
-- media that is published before it is processed (202608040001). 202608040002
-- taught the bounded Chat and Media reads to return them, but the change-page
-- projection here was last written in 202608020002 and still predates the
-- columns, so a delta reported a still-transcoding attachment with no status.
--
-- The client cannot see that as "unknown": an asset-backed row with no status
-- was read as ready, and a video has no deliverable URL until its canonical
-- derivative exists (an image falls back to its signed original source, which
-- is why only video was affected). A room video therefore lost both its
-- Processing state and its frame for the rest of the transcode, then returned
-- when a later read could sign the canonical file.
--
-- Terminal-media visibility is aligned with the bounded reads at the same time:
-- an uploader keeps seeing their own pending/rejected rows, peers do not. This
-- only ever widens what the uploader receives about their OWN media.
--
-- Storage locations stay out of the payload. `signMemoryPhotoPayload` reads
-- `storage_path` itself under the admin client and strips stored locations from
-- every row it returns, so exposing them here would add nothing but reach.
--
-- The function body is otherwise reproduced verbatim from 202608020002.

create or replace function public.shared_memory_room_sync_v1(
  p_room_id uuid,
  p_after_cursor bigint default 0,
  p_limit integer default 200
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
  select room.*
  from public.shared_memory_rooms room
  cross join viewer
  where room.id = p_room_id
    and viewer.username is not null
    and public.can_read_shared_memory(room.id)
), bounded as (
  select
    greatest(coalesce(p_after_cursor, 0), 0)::bigint as after_cursor,
    least(greatest(coalesce(p_limit, 200), 1), 500) as page_limit
), change_page as (
  select change.id, change.entity_type, change.entity_id, change.operation
  from public.shared_memory_chat_changes change
  cross join bounded
  where change.room_id = p_room_id
    and change.id > bounded.after_cursor
  order by change.id
  limit ((select page_limit from bounded) + 1)
), selected_changes as (
  select *
  from change_page
  order by id
  limit (select page_limit from bounded)
), changed_messages as (
  select
    message.id, message.room_id, message.author_name, message.body,
    message.reply_to_message_id, message.created_at, message.edited_at
  from public.shared_memory_messages message
  where message.room_id = p_room_id
    and message.id in (
      select entity_id
      from selected_changes
      where entity_type = 'message' and operation = 'upsert'
    )
), reply_messages as (
  select
    reply.id, reply.room_id, reply.author_name, reply.body,
    reply.reply_to_message_id, reply.created_at, reply.edited_at
  from public.shared_memory_messages reply
  where reply.room_id = p_room_id
    and reply.id in (
      select reply_to_message_id
      from changed_messages
      where reply_to_message_id is not null
    )
    and not exists (select 1 from changed_messages where changed_messages.id = reply.id)
), changed_photos as (
  select
    photo.id, photo.room_id, photo.stop_id, photo.message_id,
    photo.uploader_name, photo.uploader_id, photo.media_asset_id,
    photo.media_type, photo.image_width, photo.image_height, photo.position,
    photo.upload_intent_id, photo.moderation_status,
    photo.moderation_reason, photo.processing_status,
    photo.processing_failure_code, photo.file_size_bytes, photo.mime_type,
    photo.duration_ms, photo.created_at
  from public.shared_memory_photos photo
  cross join viewer
  where photo.room_id = p_room_id
    and photo.id in (
      select entity_id
      from selected_changes
      where entity_type = 'photo' and operation = 'upsert'
    )
    and (
      coalesce(photo.moderation_status, 'approved') = 'approved'
      or (
        coalesce(photo.moderation_status, 'approved') in ('pending', 'rejected')
        and photo.uploader_name = viewer.username
      )
    )
), names as (
  select member.user_name as username from public.shared_memory_members member where member.room_id = p_room_id
  union select stop.created_by from public.shared_memory_stops stop where stop.room_id = p_room_id
  union select dish.added_by from public.shared_memory_dishes dish where dish.room_id = p_room_id
  union select rating.rated_by from public.shared_memory_dish_ratings rating where rating.room_id = p_room_id
  union select author_name from changed_messages
  union select author_name from reply_messages
  union select uploader_name from changed_photos
), profiles as (
  select profile.username, profile.first_name, profile.last_name
  from public.profiles profile
  join names on names.username = profile.username
)
select case when not exists (select 1 from allowed) then null else jsonb_build_object(
  'room', (select to_jsonb(allowed) from allowed),
  'members', coalesce((select jsonb_agg(to_jsonb(member) order by member.created_at, member.id) from public.shared_memory_members member where member.room_id = p_room_id), '[]'::jsonb),
  'stops', coalesce((select jsonb_agg(to_jsonb(stop) order by stop.position, stop.created_at, stop.id) from public.shared_memory_stops stop where stop.room_id = p_room_id), '[]'::jsonb),
  'dishes', coalesce((select jsonb_agg(to_jsonb(dish) order by dish.created_at, dish.id) from public.shared_memory_dishes dish where dish.room_id = p_room_id), '[]'::jsonb),
  'dishRatings', coalesce((select jsonb_agg(to_jsonb(dish_rating) order by dish_rating.created_at, dish_rating.id) from public.shared_memory_dish_ratings dish_rating where dish_rating.room_id = p_room_id), '[]'::jsonb),
  'read', (select to_jsonb(read) from public.shared_memory_reads read where read.room_id = p_room_id and read.user_name = (select username from viewer)),
  'profiles', coalesce((select jsonb_agg(to_jsonb(profiles) order by username) from profiles), '[]'::jsonb),
  'changes', jsonb_build_object(
    'messages', coalesce((select jsonb_agg(to_jsonb(changed_messages) order by created_at, id) from changed_messages), '[]'::jsonb),
    'photos', coalesce((select jsonb_agg(to_jsonb(changed_photos) order by position nulls last, created_at, id) from changed_photos), '[]'::jsonb),
    'replyMessages', coalesce((select jsonb_agg(to_jsonb(reply_messages) order by created_at, id) from reply_messages), '[]'::jsonb),
    'deletedMessageIds', coalesce((
      select jsonb_agg(entity_id order by id)
      from selected_changes
      where entity_type = 'message' and operation = 'delete'
    ), '[]'::jsonb),
    'deletedPhotoIds', coalesce((
      select jsonb_agg(entity_id order by id)
      from selected_changes
      where entity_type = 'photo' and operation = 'delete'
    ), '[]'::jsonb)
  ),
  'syncCursor', coalesce(
    (select max(id)::text from selected_changes),
    (select after_cursor::text from bounded)
  ),
  'hasMore', (select count(*) > (select page_limit from bounded) from change_page)
) end;
$$;

revoke all on function public.shared_memory_room_sync_v1(uuid, bigint, integer)
  from public, anon;
grant execute on function public.shared_memory_room_sync_v1(uuid, bigint, integer)
  to authenticated, service_role;

comment on function public.shared_memory_room_sync_v1(uuid, bigint, integer) is
  'Membership-aware bounded room overview plus chat delta, including media processing state and uploader-visible terminal media. Private Storage paths are intentionally omitted.';
