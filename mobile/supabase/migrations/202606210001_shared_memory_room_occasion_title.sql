-- Add optional occasion/title support to Table Memory creation.
-- Uses the existing shared_memory_rooms.title column; no new RLS surface is added.

drop function if exists public.create_shared_memory_room(text, text, text, date, uuid, text[]);

create or replace function public.create_shared_memory_room(
  p_restaurant_name text,
  p_restaurant_id text default null,
  p_area text default null,
  p_visit_date date default null,
  p_source_post_id uuid default null,
  p_participant_usernames text[] default '{}'::text[],
  p_title text default null
)
returns table(id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator text;
  v_room_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
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
    restaurant_name,
    restaurant_id,
    area,
    visit_date,
    source_post_id,
    created_by,
    status
  )
  values (
    coalesce(left(nullif(btrim(coalesce(p_title, '')), ''), 80), btrim(p_restaurant_name)),
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

grant execute on function public.create_shared_memory_room(text, text, text, date, uuid, text[], text) to authenticated;
