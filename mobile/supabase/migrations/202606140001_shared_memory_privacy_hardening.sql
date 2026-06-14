-- Privacy hardening for Table Memory rooms.
-- Run after the existing shared_memory_* mobile migrations.

insert into public.shared_memory_members (room_id, user_name, role)
select room.id, room.created_by, 'owner'
from public.shared_memory_rooms room
where nullif(btrim(room.created_by), '') is not null
on conflict (room_id, user_name) do update
  set role = case
    when public.shared_memory_members.role = 'owner' then 'owner'
    else excluded.role
  end;

create or replace function public.can_read_shared_memory(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shared_memory_members smm
    where smm.room_id = target_room_id
      and smm.user_name = public.current_profile_name()
  )
$$;

grant execute on function public.can_read_shared_memory(uuid) to authenticated;

drop policy if exists "Room members can leave rooms" on public.shared_memory_members;
create policy "Room members can leave rooms"
  on public.shared_memory_members for delete to authenticated
  using (
    user_name = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
  );

drop policy if exists "Users can delete own shared memory read state" on public.shared_memory_reads;
create policy "Users can delete own shared memory read state"
  on public.shared_memory_reads for delete to authenticated
  using (
    user_name = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'memory-media',
  'memory-media',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.memory_media_room_id(object_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_parts text[];
begin
  v_parts := storage.foldername(object_name);
  if coalesce(v_parts[1], '') <> 'memories' then
    return null;
  end if;

  return nullif(v_parts[2], '')::uuid;
exception
  when others then
    return null;
end;
$$;

grant execute on function public.memory_media_room_id(text) to authenticated;

drop policy if exists "Memory members can view memory media" on storage.objects;
create policy "Memory members can view memory media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'memory-media'
    and public.can_read_shared_memory(public.memory_media_room_id(name))
  );

drop policy if exists "Memory members can upload own memory media" on storage.objects;
create policy "Memory members can upload own memory media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'memory-media'
    and coalesce((storage.foldername(name))[1], '') = 'memories'
    and (storage.foldername(name))[3] = public.current_profile_name()
    and public.can_read_shared_memory(public.memory_media_room_id(name))
  );

drop policy if exists "Memory members can delete own memory media" on storage.objects;
create policy "Memory members can delete own memory media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'memory-media'
    and coalesce((storage.foldername(name))[1], '') = 'memories'
    and (storage.foldername(name))[3] = public.current_profile_name()
    and public.can_read_shared_memory(public.memory_media_room_id(name))
  );
