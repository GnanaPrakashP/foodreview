-- Idempotent Table Memory entity mutations and monotonic per-user dish ratings.

alter table public.shared_memory_dish_ratings
  add column if not exists client_mutation_id uuid,
  add column if not exists client_sequence bigint not null default 0;

create index if not exists shared_memory_dish_ratings_actor_sequence_idx
  on public.shared_memory_dish_ratings(rated_by, client_sequence desc);

create or replace function public.set_shared_memory_dish_rating_v2(
  p_room_id uuid,
  p_dish_id uuid,
  p_actor_name text,
  p_rating integer,
  p_client_mutation_id uuid,
  p_client_sequence bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rating public.shared_memory_dish_ratings%rowtype;
begin
  if p_actor_name is null or btrim(p_actor_name) = '' then
    raise exception 'memory_rating_actor_required' using errcode = '22023';
  end if;
  if p_rating < 1 or p_rating > 5 or p_client_sequence < 1 then
    raise exception 'memory_rating_input_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.shared_memory_members member
    where member.room_id = p_room_id
      and member.user_name = p_actor_name
  ) then
    raise exception 'memory_room_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.shared_memory_dishes dish
    where dish.id = p_dish_id
      and dish.room_id = p_room_id
  ) then
    raise exception 'memory_dish_not_found' using errcode = 'P0002';
  end if;

  insert into public.shared_memory_dish_ratings (
    room_id,
    dish_id,
    rated_by,
    rating,
    client_mutation_id,
    client_sequence,
    updated_at
  )
  values (
    p_room_id,
    p_dish_id,
    p_actor_name,
    p_rating,
    p_client_mutation_id,
    p_client_sequence,
    now()
  )
  on conflict (dish_id, rated_by) do update
  set
    rating = excluded.rating,
    room_id = excluded.room_id,
    client_mutation_id = excluded.client_mutation_id,
    client_sequence = excluded.client_sequence,
    updated_at = now()
  where public.shared_memory_dish_ratings.client_sequence <= excluded.client_sequence
  returning * into v_rating;

  if v_rating.id is null then
    select * into v_rating
    from public.shared_memory_dish_ratings rating
    where rating.dish_id = p_dish_id
      and rating.rated_by = p_actor_name;
  end if;

  return jsonb_build_object(
    'id', v_rating.id,
    'room_id', v_rating.room_id,
    'dish_id', v_rating.dish_id,
    'rated_by', v_rating.rated_by,
    'rating', v_rating.rating,
    'client_mutation_id', v_rating.client_mutation_id,
    'client_sequence', v_rating.client_sequence,
    'created_at', v_rating.created_at,
    'updated_at', v_rating.updated_at
  );
end;
$$;

revoke all on function public.set_shared_memory_dish_rating_v2(uuid, uuid, text, integer, uuid, bigint) from public, anon, authenticated;
grant execute on function public.set_shared_memory_dish_rating_v2(uuid, uuid, text, integer, uuid, bigint) to service_role;
