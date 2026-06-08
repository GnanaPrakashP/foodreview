-- Allow participants to edit/delete their own Table Memory messages and delete their own media.

alter table public.shared_memory_messages
  add column if not exists edited_at timestamptz;

drop policy if exists "Room members can edit own messages" on public.shared_memory_messages;
create policy "Room members can edit own messages"
  on public.shared_memory_messages for update to authenticated
  using (
    author_name = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
  )
  with check (
    author_name = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
  );

drop policy if exists "Room members can delete own messages" on public.shared_memory_messages;
create policy "Room members can delete own messages"
  on public.shared_memory_messages for delete to authenticated
  using (
    author_name = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
  );

drop policy if exists "Room members can delete own photos" on public.shared_memory_photos;
create policy "Room members can delete own photos"
  on public.shared_memory_photos for delete to authenticated
  using (
    uploader_name = public.current_profile_name()
    and public.can_read_shared_memory(room_id)
  );
