-- Profile Memories is a visit timeline, not an activity inbox. Keep its cursor
-- order identical to the mobile presentation order so loading another page can
-- never move an older room ahead of a newer meal.

create index if not exists shared_memory_rooms_timeline_cursor_idx
  on public.shared_memory_rooms (
    (coalesce(visit_date, (created_at at time zone 'UTC')::date)) desc,
    id desc
  );

create or replace function public.shared_memory_room_summaries_v3(
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
    where photo.room_id = room.id
      and coalesce(photo.moderation_status, 'approved') = 'approved'),
  (select count(*) from public.shared_memory_messages message where message.room_id = room.id),
  (select count(*) from public.shared_memory_dishes dish where dish.room_id = room.id),
  (select count(*) from public.shared_memory_messages message
    where message.room_id = room.id
      and message.author_name <> (select username from viewer)
      and message.created_at > coalesce((
        select read.last_read_at
        from public.shared_memory_reads read
        where read.room_id = room.id
          and read.user_name = (select username from viewer)
      ), '-infinity'::timestamptz)),
  (select left(message.body, 160)
    from public.shared_memory_messages message
    where message.room_id = room.id
    order by message.created_at desc, message.id desc
    limit 1),
  room.updated_at,
  array_remove(array_prepend(room.restaurant_name, array(
    select stop.name
    from public.shared_memory_stops stop
    where stop.room_id = room.id
    order by stop.position, stop.id
  )), null),
  room.created_at,
  room.timeline_date
from rooms room
order by room.timeline_date desc, room.id desc;
$$;

revoke all on function public.shared_memory_room_summaries_v3(integer, date, uuid) from public, anon;
grant execute on function public.shared_memory_room_summaries_v3(integer, date, uuid) to authenticated, service_role;

comment on function public.shared_memory_room_summaries_v3(integer, date, uuid) is
  'Member-scoped Profile Memory timeline page ordered by stable visit date and room id; callers request one cursor sentinel row.';
