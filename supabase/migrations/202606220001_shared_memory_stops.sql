-- Shared memory "stops": an occasion (room) can span multiple stops on an
-- itinerary (dinner -> bowling -> movie). Dishes and photos can optionally hang
-- off a specific stop so the Table tab can group content per stop.
-- Run this against the same Supabase project used by the mobile app.

create table if not exists public.shared_memory_stops (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  stop_type text not null default 'other',
  name text not null,
  note text,
  position integer not null default 0,
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint shared_memory_stops_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint shared_memory_stops_type_check check (
    stop_type in ('restaurant', 'cafe', 'bar', 'bowling', 'movie', 'activity', 'other')
  )
);

create index if not exists shared_memory_stops_room_position_idx
  on public.shared_memory_stops(room_id, position, created_at);

-- Existing content can now be attributed to a stop. Null means "room-level"
-- (legacy rooms keep their dishes/photos exactly as they were).
alter table public.shared_memory_dishes
  add column if not exists stop_id uuid references public.shared_memory_stops(id) on delete set null;

alter table public.shared_memory_photos
  add column if not exists stop_id uuid references public.shared_memory_stops(id) on delete set null;

create index if not exists shared_memory_dishes_stop_idx on public.shared_memory_dishes(stop_id);
create index if not exists shared_memory_photos_stop_idx on public.shared_memory_photos(stop_id);

alter table public.shared_memory_stops enable row level security;

-- Read: any room member (mirrors dishes/photos/messages).
drop policy if exists "Stops readable by participants" on public.shared_memory_stops;
create policy "Stops readable by participants"
  on public.shared_memory_stops for select to authenticated
  using (public.can_read_shared_memory(room_id));

-- Insert: room members, attributed to themselves.
drop policy if exists "Room members can add stops" on public.shared_memory_stops;
create policy "Room members can add stops"
  on public.shared_memory_stops for insert to authenticated
  with check (
    created_by = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
  );

-- Update (rename / re-type / reorder): any room member.
drop policy if exists "Room members can update stops" on public.shared_memory_stops;
create policy "Room members can update stops"
  on public.shared_memory_stops for update to authenticated
  using (public.can_read_shared_memory(room_id))
  with check (public.can_read_shared_memory(room_id));

-- Delete: any room member.
drop policy if exists "Room members can remove stops" on public.shared_memory_stops;
create policy "Room members can remove stops"
  on public.shared_memory_stops for delete to authenticated
  using (public.can_read_shared_memory(room_id));
