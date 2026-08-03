-- Ownership-safe dish actions, dish-card replies, and removable monotonic ratings.

-- A Table Memory reply may target either a message or a dish card. The legacy
-- column name is retained to avoid widening every read RPC and local replica.
alter table public.shared_memory_messages
  drop constraint if exists shared_memory_messages_reply_to_message_id_fkey;

comment on column public.shared_memory_messages.reply_to_message_id is
  'Same-room message or dish reply target UUID, validated by validate_shared_memory_message_write().';

create or replace function public.validate_shared_memory_message_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reply_room_id uuid;
begin
  if new.body is null or char_length(new.body) > 1000 then
    raise exception 'shared_memory_message_body_too_long' using errcode = '23514';
  end if;

  if nullif(btrim(new.author_name), '') is null then
    raise exception 'shared_memory_message_author_required' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.shared_memory_members member
    where member.room_id = new.room_id
      and member.user_name = new.author_name
  ) then
    raise exception 'shared_memory_message_author_not_room_member' using errcode = '42501';
  end if;

  if public.shared_memory_room_has_blocked_relationship(new.room_id, new.author_name) then
    raise exception 'shared_memory_blocked_relationship' using errcode = '42501';
  end if;

  if new.reply_to_message_id is not null then
    if new.reply_to_message_id = new.id then
      raise exception 'shared_memory_message_self_reply' using errcode = '23514';
    end if;

    select target.room_id
      into v_reply_room_id
      from (
        select message.room_id
        from public.shared_memory_messages message
        where message.id = new.reply_to_message_id
        union all
        select dish.room_id
        from public.shared_memory_dishes dish
        where dish.id = new.reply_to_message_id
      ) target
      limit 1;

    if v_reply_room_id is null then
      raise exception 'shared_memory_reply_target_not_found' using errcode = '23503';
    end if;

    if v_reply_room_id <> new.room_id then
      raise exception 'shared_memory_reply_target_room_mismatch' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_shared_memory_message_write() from public, anon;
grant execute on function public.validate_shared_memory_message_write() to authenticated, service_role;

create or replace function public.clear_shared_memory_reply_target_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.shared_memory_messages message
  set reply_to_message_id = null
  where message.reply_to_message_id = old.id;
  return old;
end;
$$;

revoke all on function public.clear_shared_memory_reply_target_v1() from public, anon, authenticated;
grant execute on function public.clear_shared_memory_reply_target_v1() to service_role;

drop trigger if exists clear_shared_memory_message_reply_target on public.shared_memory_messages;
create trigger clear_shared_memory_message_reply_target
after delete on public.shared_memory_messages
for each row execute function public.clear_shared_memory_reply_target_v1();

drop trigger if exists clear_shared_memory_dish_reply_target on public.shared_memory_dishes;
create trigger clear_shared_memory_dish_reply_target
after delete on public.shared_memory_dishes
for each row execute function public.clear_shared_memory_reply_target_v1();

-- Keep a null rating row as a monotonic tombstone. This prevents an older
-- delayed request from resurrecting a rating after the user clears it.
alter table public.shared_memory_dish_ratings
  alter column rating drop not null,
  drop constraint if exists shared_memory_dish_ratings_rating_check;

alter table public.shared_memory_dish_ratings
  add constraint shared_memory_dish_ratings_rating_check
  check (rating is null or (rating >= 1 and rating <= 5));

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
  if (p_rating is not null and (p_rating < 1 or p_rating > 5)) or p_client_sequence < 1 then
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
