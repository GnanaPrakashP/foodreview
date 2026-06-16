-- Per-user ratings for Table Memory dishes.

create table if not exists public.shared_memory_dish_ratings (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  dish_id uuid not null references public.shared_memory_dishes(id) on delete cascade,
  rated_by text not null,
  rating numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(dish_id, rated_by),
  constraint shared_memory_dish_ratings_rating_check check (rating >= 1 and rating <= 5)
);

create index if not exists shared_memory_dish_ratings_room_idx
  on public.shared_memory_dish_ratings(room_id);

create index if not exists shared_memory_dish_ratings_dish_idx
  on public.shared_memory_dish_ratings(dish_id);

insert into public.shared_memory_dish_ratings (room_id, dish_id, rated_by, rating, created_at, updated_at)
select dish.room_id, dish.id, dish.added_by, dish.rating, dish.created_at, dish.created_at
from public.shared_memory_dishes dish
where dish.rating is not null
on conflict (dish_id, rated_by) do nothing;

alter table public.shared_memory_dish_ratings enable row level security;
alter table public.shared_memory_dish_ratings replica identity full;

drop policy if exists "Dish ratings readable by participants" on public.shared_memory_dish_ratings;
create policy "Dish ratings readable by participants"
  on public.shared_memory_dish_ratings for select to authenticated
  using (public.can_read_shared_memory(room_id));

drop policy if exists "Room members can add own dish ratings" on public.shared_memory_dish_ratings;
create policy "Room members can add own dish ratings"
  on public.shared_memory_dish_ratings for insert to authenticated
  with check (
    rated_by = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
    and exists (
      select 1
      from public.shared_memory_dishes dish
      where dish.id = shared_memory_dish_ratings.dish_id
        and dish.room_id = shared_memory_dish_ratings.room_id
    )
  );

drop policy if exists "Room members can update own dish ratings" on public.shared_memory_dish_ratings;
create policy "Room members can update own dish ratings"
  on public.shared_memory_dish_ratings for update to authenticated
  using (
    rated_by = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
  )
  with check (
    rated_by = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
    and exists (
      select 1
      from public.shared_memory_dishes dish
      where dish.id = shared_memory_dish_ratings.dish_id
        and dish.room_id = shared_memory_dish_ratings.room_id
    )
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_memory_dish_ratings'
  ) then
    alter publication supabase_realtime add table public.shared_memory_dish_ratings;
  end if;
end $$;
