-- Avoid PL/pgSQL output-parameter ambiguity when accepting a room invite.
-- `room_id` is both a RETURNS TABLE output name and a member-table column, so
-- the column-list ON CONFLICT target can fail at runtime. The named constraint
-- keeps the same idempotent membership behavior without ambiguous identifiers.
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
      on conflict on constraint shared_memory_members_room_id_user_name_key do nothing;
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
    on conflict on constraint shared_memory_members_room_id_user_name_key do nothing;
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
