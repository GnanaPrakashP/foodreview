-- Pending invites for Table Memory rooms.
-- Circle members can be added directly; non-circle users receive an invite.

create table if not exists public.shared_memory_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  sender_name text not null,
  receiver_name text not null,  
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(room_id, receiver_name),
  constraint shared_memory_invites_status_check check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  constraint shared_memory_invites_not_self_check check (sender_name <> receiver_name)
);

create index if not exists shared_memory_invites_room_idx
  on public.shared_memory_invites(room_id);

create index if not exists shared_memory_invites_receiver_idx
  on public.shared_memory_invites(receiver_name, status, created_at desc);

create index if not exists shared_memory_invites_sender_idx
  on public.shared_memory_invites(sender_name, created_at desc);

alter table public.shared_memory_invites enable row level security;

drop policy if exists "Shared memory invites readable by involved users" on public.shared_memory_invites;
create policy "Shared memory invites readable by involved users"
  on public.shared_memory_invites for select to authenticated
  using (
    sender_name = public.current_profile_name()
    or receiver_name = public.current_profile_name()
    or public.can_read_shared_memory(room_id)
  );

drop policy if exists "Room members can create shared memory invites" on public.shared_memory_invites;
create policy "Room members can create shared memory invites"
  on public.shared_memory_invites for insert to authenticated
  with check (
    sender_name = public.current_profile_name()
    and receiver_name <> public.current_profile_name()
    and public.can_read_shared_memory(room_id)
  );

drop policy if exists "Invite receivers can respond" on public.shared_memory_invites;
create policy "Invite receivers can respond"
  on public.shared_memory_invites for update to authenticated
  using (receiver_name = public.current_profile_name())
  with check (receiver_name = public.current_profile_name());
