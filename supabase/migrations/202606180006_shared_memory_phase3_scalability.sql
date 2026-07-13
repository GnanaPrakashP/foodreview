-- Phase 3: Table Memory database and scalability fixes.
--
-- Adds bounded, DB-computed room summaries and supporting indexes so the
-- mobile room list does not fetch every message/photo row for every room.

create index if not exists shared_memory_messages_room_created_id_desc_idx
  on public.shared_memory_messages(room_id, created_at desc, id desc);

create index if not exists shared_memory_messages_room_reply_idx
  on public.shared_memory_messages(room_id, reply_to_message_id)
  where reply_to_message_id is not null;

create index if not exists shared_memory_photos_room_message_position_idx
  on public.shared_memory_photos(room_id, message_id, position, created_at)
  where message_id is not null;

create index if not exists shared_memory_photos_room_visible_created_idx
  on public.shared_memory_photos(room_id, moderation_status, created_at desc, id desc);

create index if not exists shared_memory_members_user_room_idx
  on public.shared_memory_members(user_name, room_id);

create index if not exists shared_memory_rooms_created_id_desc_idx
  on public.shared_memory_rooms(created_at desc, id desc);

do $$
begin
  if to_regclass('public.shared_memory_reads') is not null then
    create index if not exists shared_memory_reads_user_room_idx
      on public.shared_memory_reads(user_name, room_id);
  end if;
end $$;

create or replace function public.shared_memory_room_summaries(
  p_user_name text default null,
  p_limit integer default 100,
  p_before_activity_at timestamptz default null,
  p_before_room_id uuid default null
)
returns table(
  id uuid,
  title text,
  restaurant_name text,
  area text,
  visit_date date,
  source_post_id uuid,
  created_by text,
  participant_count bigint,
  photo_count bigint,
  message_count bigint,
  unread_count bigint,
  latest_message text,
  latest_activity_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_current_user_name text := public.current_profile_name();
  v_user_name text := nullif(btrim(coalesce(p_user_name, public.current_profile_name(), '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
begin
  if auth.role() <> 'service_role' and (v_current_user_name is null or v_user_name is distinct from v_current_user_name) then
    raise exception 'shared_memory_summary_forbidden' using errcode = '42501';
  end if;

  if v_user_name is null then
    return;
  end if;

  return query
  with visible_rooms as (
    select room.*
    from public.shared_memory_rooms room
    join public.shared_memory_members member
      on member.room_id = room.id
     and member.user_name = v_user_name
  ),
  summarized as (
    select
      room.id,
      room.title,
      room.restaurant_name,
      room.area,
      room.visit_date,
      room.source_post_id,
      room.created_by,
      coalesce(member_counts.participant_count, 0)::bigint as participant_count,
      coalesce(photo_counts.photo_count, 0)::bigint as photo_count,
      coalesce(message_counts.message_count, 0)::bigint as message_count,
      coalesce(unread_counts.unread_count, 0)::bigint as unread_count,
      latest_message.body as latest_message,
      greatest(room.created_at, coalesce(latest_message.created_at, room.created_at)) as latest_activity_at,
      room.created_at
    from visible_rooms room
    left join lateral (
      select count(*)::bigint as participant_count
      from public.shared_memory_members member
      where member.room_id = room.id
    ) member_counts on true
    left join lateral (
      select count(*)::bigint as message_count
      from public.shared_memory_messages message
      where message.room_id = room.id
    ) message_counts on true
    left join lateral (
      select count(*)::bigint as unread_count
      from public.shared_memory_messages message
      left join public.shared_memory_reads read
        on read.room_id = room.id
       and read.user_name = v_user_name
      where message.room_id = room.id
        and message.author_name <> v_user_name
        and message.created_at > coalesce(read.last_read_at, '-infinity'::timestamptz)
    ) unread_counts on to_regclass('public.shared_memory_reads') is not null
    left join lateral (
      select count(*)::bigint as photo_count
      from public.shared_memory_photos photo
      where photo.room_id = room.id
        and (
          coalesce(photo.moderation_status, 'approved') = 'approved'
          or (
            coalesce(photo.moderation_status, 'approved') = 'pending'
            and photo.uploader_name = v_user_name
          )
        )
    ) photo_counts on true
    left join lateral (
      select message.body, message.created_at
      from public.shared_memory_messages message
      where message.room_id = room.id
      order by message.created_at desc, message.id desc
      limit 1
    ) latest_message on true
  )
  select
    summarized.id,
    summarized.title,
    summarized.restaurant_name,
    summarized.area,
    summarized.visit_date,
    summarized.source_post_id,
    summarized.created_by,
    summarized.participant_count,
    summarized.photo_count,
    summarized.message_count,
    summarized.unread_count,
    summarized.latest_message,
    summarized.latest_activity_at,
    summarized.created_at
  from summarized
  where p_before_activity_at is null
    or summarized.latest_activity_at < p_before_activity_at
    or (
      summarized.latest_activity_at = p_before_activity_at
      and p_before_room_id is not null
      and summarized.id < p_before_room_id
    )
  order by summarized.latest_activity_at desc, summarized.id desc
  limit v_limit;
end;
$$;

revoke all on function public.shared_memory_room_summaries(text, integer, timestamptz, uuid) from public;
revoke all on function public.shared_memory_room_summaries(text, integer, timestamptz, uuid) from anon;
grant execute on function public.shared_memory_room_summaries(text, integer, timestamptz, uuid) to authenticated, service_role;

comment on function public.shared_memory_room_summaries(text, integer, timestamptz, uuid) is
  'Bounded Table Memory room summary query. Authenticated callers may only request their own current_profile_name summaries; service_role may pass p_user_name for administrative verification.';
