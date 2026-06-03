# Shared Memory SQL Suggestions

The current schema docs do not define shared-memory tables. The existing web components list these as backend TODOs:

- `shared_memory_rooms`
- `shared_memory_members`
- `shared_memory_messages`
- `shared_memory_dishes`
- `shared_memory_photos`

Do not apply this automatically. Review and adapt in Supabase before running.

```sql
create table if not exists public.shared_memory_rooms (
  id uuid primary key default gen_random_uuid(),
  title text,
  restaurant_name text not null,
  restaurant_id text,
  area text,
  visit_date date,
  source_post_id uuid references public.reviews(id) on delete set null,
  created_by text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_memory_rooms_status_check check (status in ('draft', 'published', 'archived'))
);

create table if not exists public.shared_memory_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  user_name text not null,
  role text not null default 'participant',
  created_at timestamptz not null default now(),
  unique(room_id, user_name),
  constraint shared_memory_members_role_check check (role in ('owner', 'participant'))
);

create table if not exists public.shared_memory_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  author_name text not null,
  body text not null check (char_length(body) <= 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.shared_memory_photos (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  uploader_name text not null,
  public_url text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.shared_memory_dishes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  added_by text not null,
  dish_name text not null,
  rating numeric,
  note text,
  created_at timestamptz not null default now(),
  constraint shared_memory_dishes_rating_check check (rating is null or (rating >= 1 and rating <= 5))
);

create index if not exists shared_memory_members_user_idx on public.shared_memory_members(user_name);
create index if not exists shared_memory_members_room_idx on public.shared_memory_members(room_id);
create index if not exists shared_memory_messages_room_created_idx on public.shared_memory_messages(room_id, created_at);
create index if not exists shared_memory_photos_room_created_idx on public.shared_memory_photos(room_id, created_at desc);
create index if not exists shared_memory_dishes_room_idx on public.shared_memory_dishes(room_id);

alter table public.shared_memory_rooms enable row level security;
alter table public.shared_memory_members enable row level security;
alter table public.shared_memory_messages enable row level security;
alter table public.shared_memory_photos enable row level security;
alter table public.shared_memory_dishes enable row level security;

create or replace function public.can_read_shared_memory(room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shared_memory_members smm
    where smm.room_id = can_read_shared_memory.room_id
      and smm.user_name = public.current_profile_name()
  )
$$;

grant execute on function public.can_read_shared_memory(uuid) to authenticated;

drop policy if exists "Shared memory rooms readable by members" on public.shared_memory_rooms;
create policy "Shared memory rooms readable by members"
  on public.shared_memory_rooms for select to authenticated
  using (public.can_read_shared_memory(id));

drop policy if exists "Users can create own shared memory rooms" on public.shared_memory_rooms;
create policy "Users can create own shared memory rooms"
  on public.shared_memory_rooms for insert to authenticated
  with check (created_by = public.current_profile_name());

drop policy if exists "Room members readable by room members" on public.shared_memory_members;
create policy "Room members readable by room members"
  on public.shared_memory_members for select to authenticated
  using (public.can_read_shared_memory(room_id));

drop policy if exists "Room creator can add members" on public.shared_memory_members;
create policy "Room creator can add members"
  on public.shared_memory_members for insert to authenticated
  with check (
    exists (
      select 1
      from public.shared_memory_rooms smr
      where smr.id = room_id
        and smr.created_by = public.current_profile_name()
    )
    or user_name = public.current_profile_name()
  );

drop policy if exists "Messages readable by room members" on public.shared_memory_messages;
create policy "Messages readable by room members"
  on public.shared_memory_messages for select to authenticated
  using (public.can_read_shared_memory(room_id));

drop policy if exists "Room members can add messages" on public.shared_memory_messages;
create policy "Room members can add messages"
  on public.shared_memory_messages for insert to authenticated
  with check (
    author_name = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
  );

drop policy if exists "Photos readable by room members" on public.shared_memory_photos;
create policy "Photos readable by room members"
  on public.shared_memory_photos for select to authenticated
  using (public.can_read_shared_memory(room_id));

drop policy if exists "Room members can add photos" on public.shared_memory_photos;
create policy "Room members can add photos"
  on public.shared_memory_photos for insert to authenticated
  with check (
    uploader_name = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
  );

drop policy if exists "Dishes readable by room members" on public.shared_memory_dishes;
create policy "Dishes readable by room members"
  on public.shared_memory_dishes for select to authenticated
  using (public.can_read_shared_memory(room_id));

drop policy if exists "Room members can add dishes" on public.shared_memory_dishes;
create policy "Room members can add dishes"
  on public.shared_memory_dishes for insert to authenticated
  with check (
    added_by = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
  );
```
