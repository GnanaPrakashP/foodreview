-- Persist inferred occasion metadata separately from the user-visible room title.
-- Existing rooms default to an unknown/default theme and keep their current title.

alter table public.shared_memory_rooms
  add column if not exists occasion_type text not null default 'unknown',
  add column if not exists occasion_confidence numeric not null default 0,
  add column if not exists occasion_confirmed_by_user boolean not null default false,
  add column if not exists theme_key text not null default 'default-memory-v1';

alter table public.shared_memory_rooms
  drop constraint if exists shared_memory_rooms_occasion_type_check;

alter table public.shared_memory_rooms
  add constraint shared_memory_rooms_occasion_type_check
  check (occasion_type in (
    'date_night',
    'friends_hangout',
    'birthday',
    'family_time',
    'work_meal',
    'celebration',
    'solo',
    'casual',
    'unknown'
  ));

alter table public.shared_memory_rooms
  drop constraint if exists shared_memory_rooms_occasion_confidence_check;

alter table public.shared_memory_rooms
  add constraint shared_memory_rooms_occasion_confidence_check
  check (occasion_confidence >= 0 and occasion_confidence <= 1);

update public.shared_memory_rooms
set
  occasion_type = coalesce(nullif(btrim(occasion_type), ''), 'unknown'),
  occasion_confidence = least(greatest(coalesce(occasion_confidence, 0), 0), 1),
  occasion_confirmed_by_user = coalesce(occasion_confirmed_by_user, false),
  theme_key = coalesce(nullif(btrim(theme_key), ''), 'default-memory-v1')
where occasion_type is null
  or btrim(occasion_type) = ''
  or occasion_confidence is null
  or occasion_confirmed_by_user is null
  or theme_key is null
  or btrim(theme_key) = '';

drop function if exists public.create_shared_memory_room(text, text, text, date, uuid, text[], text);

create or replace function public.create_shared_memory_room(
  p_restaurant_name text,
  p_restaurant_id text default null,
  p_area text default null,
  p_visit_date date default null,
  p_source_post_id uuid default null,
  p_participant_usernames text[] default '{}'::text[],
  p_title text default null,
  p_occasion_type text default 'unknown',
  p_occasion_confidence numeric default 0,
  p_occasion_confirmed_by_user boolean default false,
  p_theme_key text default 'default-memory-v1'
)
returns table(id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator text;
  v_occasion_type text := coalesce(nullif(btrim(p_occasion_type), ''), 'unknown');
  v_room_id uuid;
  v_theme_key text := coalesce(nullif(btrim(p_theme_key), ''), 'default-memory-v1');
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if v_occasion_type not in (
    'date_night',
    'friends_hangout',
    'birthday',
    'family_time',
    'work_meal',
    'celebration',
    'solo',
    'casual',
    'unknown'
  ) then
    raise exception 'invalid_occasion_type' using errcode = 'P0001';
  end if;

  select p.username
    into v_creator
    from public.profiles p
    where p.id = auth.uid()
    limit 1;

  if v_creator is null then
    raise exception 'profile_required' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(p_restaurant_name, '')), '') is null then
    raise exception 'restaurant_name_required' using errcode = 'P0001';
  end if;

  insert into public.shared_memory_rooms (
    title,
    occasion_type,
    occasion_confidence,
    occasion_confirmed_by_user,
    theme_key,
    restaurant_name,
    restaurant_id,
    area,
    visit_date,
    source_post_id,
    created_by,
    status
  )
  values (
    coalesce(nullif(btrim(coalesce(p_title, '')), ''), btrim(p_restaurant_name)),
    v_occasion_type,
    least(greatest(coalesce(p_occasion_confidence, 0), 0), 1),
    coalesce(p_occasion_confirmed_by_user, false),
    v_theme_key,
    btrim(p_restaurant_name),
    nullif(btrim(coalesce(p_restaurant_id, '')), ''),
    nullif(btrim(coalesce(p_area, '')), ''),
    p_visit_date,
    p_source_post_id,
    v_creator,
    'draft'
  )
  returning shared_memory_rooms.id into v_room_id;

  insert into public.shared_memory_members (room_id, user_name, role)
  values (v_room_id, v_creator, 'owner')
  on conflict (room_id, user_name) do update set role = 'owner';

  with requested as (
    select distinct lower(regexp_replace(btrim(value), '^@', '')) as username
    from unnest(coalesce(p_participant_usernames, '{}'::text[])) as value
  ),
  candidates as (
    select p.username
    from requested
    join public.profiles p on p.username = requested.username
    where requested.username <> ''
      and p.username <> v_creator
  ),
  safe_candidates as (
    select candidate.username
    from candidates candidate
    where not exists (
      select 1
      from candidates other_candidate
      where other_candidate.username <> candidate.username
        and public.shared_memory_user_pair_blocked(candidate.username, other_candidate.username)
    )
      and not public.shared_memory_user_pair_blocked(v_creator, candidate.username)
  )
  insert into public.shared_memory_members (room_id, user_name, role)
  select v_room_id, safe_candidates.username, 'participant'
  from safe_candidates
  on conflict (room_id, user_name) do nothing;

  return query select v_room_id;
end;
$$;

grant execute on function public.create_shared_memory_room(text, text, text, date, uuid, text[], text, text, numeric, boolean, text) to authenticated;

create or replace function public.update_shared_memory_room_occasion(
  p_room_id uuid,
  p_occasion_type text,
  p_occasion_confidence numeric,
  p_occasion_confirmed_by_user boolean,
  p_theme_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occasion_type text := coalesce(nullif(btrim(p_occasion_type), ''), 'unknown');
  v_theme_key text := coalesce(nullif(btrim(p_theme_key), ''), 'default-memory-v1');
  v_user_name text := public.current_profile_name();
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if v_user_name is null then
    raise exception 'profile_required' using errcode = 'P0001';
  end if;

  if v_occasion_type not in (
    'date_night',
    'friends_hangout',
    'birthday',
    'family_time',
    'work_meal',
    'celebration',
    'solo',
    'casual',
    'unknown'
  ) then
    raise exception 'invalid_occasion_type' using errcode = 'P0001';
  end if;

  if not public.can_read_shared_memory(p_room_id)
    or public.shared_memory_room_has_blocked_relationship(p_room_id, v_user_name) then
    raise exception 'shared_memory_room_forbidden' using errcode = '42501';
  end if;

  update public.shared_memory_rooms
  set
    occasion_type = v_occasion_type,
    occasion_confidence = least(greatest(coalesce(p_occasion_confidence, 0), 0), 1),
    occasion_confirmed_by_user = coalesce(p_occasion_confirmed_by_user, false),
    theme_key = v_theme_key,
    updated_at = now()
  where id = p_room_id;

  if not found then
    raise exception 'shared_memory_room_not_found' using errcode = 'P0001';
  end if;
end;
$$;

grant execute on function public.update_shared_memory_room_occasion(uuid, text, numeric, boolean, text) to authenticated;

drop function if exists public.shared_memory_room_summaries(text, integer, timestamptz, uuid);

create or replace function public.shared_memory_room_summaries(
  p_user_name text default null,
  p_limit integer default 100,
  p_before_activity_at timestamptz default null,
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
  with room_activity as (
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
      latest_message.body as latest_message,
      greatest(room.created_at, coalesce(latest_message.created_at, room.created_at)) as latest_activity_at,
      room.created_at
    from public.shared_memory_members visible_member
    join public.shared_memory_rooms room
      on room.id = visible_member.room_id
    left join lateral (
      select message.body, message.created_at
      from public.shared_memory_messages message
      where message.room_id = room.id
      order by message.created_at desc, message.id desc
      limit 1
    ) latest_message on true
    where visible_member.user_name = v_user_name
      and not public.shared_memory_room_has_blocked_relationship(room.id, v_user_name)
  ),
  paged_rooms as (
    select *
    from room_activity
    where p_before_activity_at is null
      or room_activity.latest_activity_at < p_before_activity_at
      or (
        room_activity.latest_activity_at = p_before_activity_at
        and p_before_room_id is not null
        and room_activity.id < p_before_room_id
      )
    order by room_activity.latest_activity_at desc, room_activity.id desc
    limit v_limit
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
    coalesce(member_counts.participant_count, 0)::bigint as participant_count,
    coalesce(photo_counts.photo_count, 0)::bigint as photo_count,
    coalesce(message_counts.message_count, 0)::bigint as message_count,
    coalesce(unread_counts.unread_count, 0)::bigint as unread_count,
    room.latest_message,
    room.latest_activity_at,
    room.created_at
  from paged_rooms room
  left join lateral (
    select count(*) as participant_count
    from public.shared_memory_members member
    where member.room_id = room.id
  ) member_counts on true
  left join lateral (
    select count(*) as photo_count
    from public.shared_memory_photos photo
    where photo.room_id = room.id
      and coalesce(photo.moderation_status, 'approved') = 'approved'
  ) photo_counts on true
  left join lateral (
    select count(*) as message_count
    from public.shared_memory_messages message
    where message.room_id = room.id
  ) message_counts on true
  left join lateral (
    select count(*) as unread_count
    from public.shared_memory_messages message
    left join public.shared_memory_reads read
      on read.room_id = room.id
      and read.user_name = v_user_name
    where message.room_id = room.id
      and message.author_name <> v_user_name
      and message.created_at > coalesce(read.last_read_at, '-infinity'::timestamptz)
  ) unread_counts on true
  order by room.latest_activity_at desc, room.id desc;
end;
$$;

grant execute on function public.shared_memory_room_summaries(text, integer, timestamptz, uuid) to authenticated, service_role;

