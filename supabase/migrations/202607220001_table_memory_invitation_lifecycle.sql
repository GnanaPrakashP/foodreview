-- Make Table Memory participation consent-aware.
--
-- A selected user who is already in the inviter's Circle is added directly.
-- Everyone else receives a pending invitation and cannot read the room until
-- they accept it. Invitation responses are handled by an authenticated RPC so
-- clients never update invite status or membership rows directly.

create or replace function public.create_shared_memory_room_with_invites(
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

  select profile.username
    into v_creator
    from public.profiles profile
    where profile.id = auth.uid()
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
    select distinct lower(regexp_replace(btrim(value), '^@+', '')) as username
    from unnest(coalesce(p_participant_usernames, '{}'::text[])) as value
  ),
  candidates as (
    select profile.username
    from requested
    join public.profiles profile on profile.username = requested.username
    where requested.username <> ''
      and profile.username <> v_creator
  ),
  safe_candidates as (
    select candidate.username
    from candidates candidate
    where not public.shared_memory_user_pair_blocked(v_creator, candidate.username)
      and not exists (
        select 1
        from candidates other_candidate
        where other_candidate.username <> candidate.username
          and public.shared_memory_user_pair_blocked(candidate.username, other_candidate.username)
      )
  ),
  circle_candidates as (
    select safe_candidate.username
    from safe_candidates safe_candidate
    join public.circle_memberships membership
      on membership.user_name = v_creator
     and membership.member_name = safe_candidate.username
  )
  insert into public.shared_memory_members (room_id, user_name, role)
  select v_room_id, circle_candidate.username, 'participant'
  from circle_candidates circle_candidate
  on conflict (room_id, user_name) do nothing;

  with requested as (
    select distinct lower(regexp_replace(btrim(value), '^@+', '')) as username
    from unnest(coalesce(p_participant_usernames, '{}'::text[])) as value
  ),
  candidates as (
    select profile.username
    from requested
    join public.profiles profile on profile.username = requested.username
    where requested.username <> ''
      and profile.username <> v_creator
  ),
  safe_candidates as (
    select candidate.username
    from candidates candidate
    where not public.shared_memory_user_pair_blocked(v_creator, candidate.username)
      and not exists (
        select 1
        from candidates other_candidate
        where other_candidate.username <> candidate.username
          and public.shared_memory_user_pair_blocked(candidate.username, other_candidate.username)
      )
  ),
  invite_candidates as (
    select safe_candidate.username
    from safe_candidates safe_candidate
    where not exists (
      select 1
      from public.circle_memberships membership
      where membership.user_name = v_creator
        and membership.member_name = safe_candidate.username
    )
  )
  insert into public.shared_memory_invites (
    room_id,
    sender_name,
    receiver_name,
    status,
    updated_at
  )
  select v_room_id, v_creator, invite_candidate.username, 'pending', now()
  from invite_candidates invite_candidate
  on conflict (room_id, receiver_name) do update
    set sender_name = excluded.sender_name,
        status = 'pending',
        updated_at = now();

  return query select v_room_id;
end;
$$;

revoke all on function public.create_shared_memory_room_with_invites(text, text, text, date, uuid, text[], text, text, numeric, boolean, text) from public;
revoke all on function public.create_shared_memory_room_with_invites(text, text, text, date, uuid, text[], text, text, numeric, boolean, text) from anon;
grant execute on function public.create_shared_memory_room_with_invites(text, text, text, date, uuid, text[], text, text, numeric, boolean, text) to authenticated;

-- Keep older mobile builds safe: the legacy RPC remains callable, but now
-- delegates to the same consent-aware implementation.
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
language sql
security invoker
set search_path = public
as $$
  select created.id
  from public.create_shared_memory_room_with_invites(
    p_restaurant_name,
    p_restaurant_id,
    p_area,
    p_visit_date,
    p_source_post_id,
    p_participant_usernames,
    p_title,
    p_occasion_type,
    p_occasion_confidence,
    p_occasion_confirmed_by_user,
    p_theme_key
  ) created;
$$;

revoke all on function public.create_shared_memory_room(text, text, text, date, uuid, text[], text, text, numeric, boolean, text) from public;
revoke all on function public.create_shared_memory_room(text, text, text, date, uuid, text[], text, text, numeric, boolean, text) from anon;
grant execute on function public.create_shared_memory_room(text, text, text, date, uuid, text[], text, text, numeric, boolean, text) to authenticated;

create or replace function public.respond_to_shared_memory_invite(
  p_invite_id uuid,
  p_action text
)
returns table(room_id uuid, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_invite public.shared_memory_invites%rowtype;
  v_receiver text := public.current_profile_name();
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if v_receiver is null then
    raise exception 'profile_required' using errcode = 'P0001';
  end if;

  if v_action not in ('join', 'decline') then
    raise exception 'invalid_memory_invite_action' using errcode = '22023';
  end if;

  select invite.*
    into v_invite
    from public.shared_memory_invites invite
    where invite.id = p_invite_id
      and invite.receiver_name = v_receiver
    for update;

  if not found then
    raise exception 'memory_invite_not_found' using errcode = 'P0002';
  end if;

  v_status := case when v_action = 'join' then 'accepted' else 'declined' end;

  if v_invite.status = v_status then
    if v_action = 'join' then
      if public.shared_memory_room_has_blocked_relationship(v_invite.room_id, v_receiver) then
        raise exception 'memory_invite_blocked_relationship' using errcode = '42501';
      end if;
      insert into public.shared_memory_members (room_id, user_name, role)
      values (v_invite.room_id, v_receiver, 'participant')
      on conflict (room_id, user_name) do nothing;
    end if;
    return query select v_invite.room_id, v_status;
    return;
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'memory_invite_no_longer_pending' using errcode = 'P0001';
  end if;

  if v_action = 'join' then
    if public.shared_memory_room_has_blocked_relationship(v_invite.room_id, v_receiver) then
      raise exception 'memory_invite_blocked_relationship' using errcode = '42501';
    end if;

    insert into public.shared_memory_members (room_id, user_name, role)
    values (v_invite.room_id, v_receiver, 'participant')
    on conflict (room_id, user_name) do nothing;
  end if;

  update public.shared_memory_invites invite
  set status = v_status,
      updated_at = now()
  where invite.id = v_invite.id
    and invite.receiver_name = v_receiver
    and invite.status = 'pending';

  if not found then
    raise exception 'memory_invite_no_longer_pending' using errcode = 'P0001';
  end if;

  return query select v_invite.room_id, v_status;
end;
$$;

revoke all on function public.respond_to_shared_memory_invite(uuid, text) from public;
revoke all on function public.respond_to_shared_memory_invite(uuid, text) from anon;
grant execute on function public.respond_to_shared_memory_invite(uuid, text) to authenticated;

-- Invitation writes are server/RPC-owned. Authenticated clients only need to
-- read invitation rows involving them; the response RPC performs status and
-- membership changes atomically.
revoke insert, update, delete on table public.shared_memory_invites from authenticated;
grant select on table public.shared_memory_invites to authenticated;
