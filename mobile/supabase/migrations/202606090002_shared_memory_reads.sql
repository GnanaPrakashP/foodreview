-- Track per-user read state for Table Memory rooms.

create table if not exists public.shared_memory_reads (
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  user_name text not null,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_name)
);

create index if not exists shared_memory_reads_user_idx
  on public.shared_memory_reads(user_name);

alter table public.shared_memory_reads enable row level security;

drop policy if exists "Users can read own shared memory read state" on public.shared_memory_reads;
create policy "Users can read own shared memory read state"
  on public.shared_memory_reads for select to authenticated
  using (
    user_name = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
  );

drop policy if exists "Users can create own shared memory read state" on public.shared_memory_reads;
create policy "Users can create own shared memory read state"
  on public.shared_memory_reads for insert to authenticated
  with check (
    user_name = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
  );

drop policy if exists "Users can update own shared memory read state" on public.shared_memory_reads;
create policy "Users can update own shared memory read state"
  on public.shared_memory_reads for update to authenticated
  using (
    user_name = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
  )
  with check (
    user_name = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
  );
