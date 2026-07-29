-- Visibility-driven Table Memory read positions. A device may acknowledge only
-- a bounded timestamp it actually rendered; concurrent devices can never move
-- the durable position backwards.

create or replace function public.mark_shared_memory_read_v1(
  p_room_id uuid,
  p_read_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_name text := public.current_profile_name();
  v_read_at timestamptz := least(coalesce(p_read_at, now()), now());
  v_result timestamptz;
begin
  if v_user_name is null or not public.can_read_shared_memory(p_room_id) then
    raise exception 'Memory room not found' using errcode = 'P0001';
  end if;

  insert into public.shared_memory_reads (
    room_id,
    user_name,
    last_read_at,
    updated_at
  )
  values (
    p_room_id,
    v_user_name,
    v_read_at,
    now()
  )
  on conflict (room_id, user_name) do update
  set
    last_read_at = greatest(
      public.shared_memory_reads.last_read_at,
      excluded.last_read_at
    ),
    updated_at = case
      when excluded.last_read_at > public.shared_memory_reads.last_read_at
        then now()
      else public.shared_memory_reads.updated_at
    end
  returning last_read_at into v_result;

  return v_result;
end;
$$;

revoke all on function public.mark_shared_memory_read_v1(uuid, timestamptz)
  from public, anon;
grant execute on function public.mark_shared_memory_read_v1(uuid, timestamptz)
  to authenticated, service_role;

comment on function public.mark_shared_memory_read_v1(uuid, timestamptz) is
  'Membership-aware monotonic read acknowledgement for actually visible Memory Room chat rows.';
