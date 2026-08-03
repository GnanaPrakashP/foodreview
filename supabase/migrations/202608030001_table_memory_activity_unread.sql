-- Server-authoritative, monotonic per-surface unread state for Table Memory.

alter table public.shared_memory_reads
  add column if not exists last_media_read_at timestamptz,
  add column if not exists last_dishes_read_at timestamptz;

-- Do not turn pre-migration history into a surprise unread flood.
update public.shared_memory_reads
set
  last_media_read_at = coalesce(last_media_read_at, now()),
  last_dishes_read_at = coalesce(last_dishes_read_at, now())
where last_media_read_at is null or last_dishes_read_at is null;

create index if not exists shared_memory_photos_room_unread_idx
  on public.shared_memory_photos(room_id, created_at, id)
  where coalesce(moderation_status, 'approved') = 'approved';

create index if not exists shared_memory_dishes_room_unread_idx
  on public.shared_memory_dishes(room_id, created_at, id);

create or replace function public.mark_shared_memory_activity_read_v1(
  p_room_id uuid,
  p_surface text,
  p_read_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_name text := public.current_profile_name();
  v_surface text := lower(btrim(coalesce(p_surface, '')));
  v_read_at timestamptz := least(coalesce(p_read_at, now()), now());
  v_result timestamptz;
begin
  if v_surface not in ('chat', 'media', 'dishes') then
    raise exception 'memory_read_surface_invalid' using errcode = '22023';
  end if;
  if v_user_name is null or not public.can_read_shared_memory(p_room_id) then
    raise exception 'Memory room not found' using errcode = 'P0001';
  end if;

  insert into public.shared_memory_reads (
    room_id, user_name, last_read_at, last_media_read_at,
    last_dishes_read_at, updated_at
  ) values (
    p_room_id,
    v_user_name,
    case when v_surface = 'chat' then v_read_at else '-infinity'::timestamptz end,
    case when v_surface = 'media' then v_read_at else null end,
    case when v_surface = 'dishes' then v_read_at else null end,
    now()
  )
  on conflict (room_id, user_name) do update set
    last_read_at = case when v_surface = 'chat'
      then greatest(public.shared_memory_reads.last_read_at, v_read_at)
      else public.shared_memory_reads.last_read_at end,
    last_media_read_at = case when v_surface = 'media'
      then greatest(coalesce(public.shared_memory_reads.last_media_read_at, '-infinity'::timestamptz), v_read_at)
      else public.shared_memory_reads.last_media_read_at end,
    last_dishes_read_at = case when v_surface = 'dishes'
      then greatest(coalesce(public.shared_memory_reads.last_dishes_read_at, '-infinity'::timestamptz), v_read_at)
      else public.shared_memory_reads.last_dishes_read_at end,
    updated_at = case
      when (v_surface = 'chat' and v_read_at > public.shared_memory_reads.last_read_at)
        or (v_surface = 'media' and v_read_at > coalesce(public.shared_memory_reads.last_media_read_at, '-infinity'::timestamptz))
        or (v_surface = 'dishes' and v_read_at > coalesce(public.shared_memory_reads.last_dishes_read_at, '-infinity'::timestamptz))
      then now() else public.shared_memory_reads.updated_at end
  returning case v_surface
    when 'chat' then last_read_at
    when 'media' then last_media_read_at
    else last_dishes_read_at
  end into v_result;

  return v_result;
end;
$$;

revoke all on function public.mark_shared_memory_activity_read_v1(uuid, text, timestamptz)
  from public, anon;
grant execute on function public.mark_shared_memory_activity_read_v1(uuid, text, timestamptz)
  to authenticated, service_role;

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

comment on function public.mark_shared_memory_activity_read_v1(uuid, text, timestamptz) is
  'Member-scoped monotonic Chat, Media, or Dishes read acknowledgement.';
comment on function public.shared_memory_room_summaries_v4(integer, date, uuid) is
  'Member-scoped Table Memory timeline with server-authoritative per-tab unread counts.';
