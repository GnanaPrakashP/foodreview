-- Link shared memory media uploads to chat messages so one message can contain multiple media.
-- Run after 202606060003_shared_memory_media_type.sql.

alter table public.shared_memory_photos
  add column if not exists message_id uuid references public.shared_memory_messages(id) on delete cascade;

alter table public.shared_memory_photos
  add column if not exists position integer not null default 0;

create index if not exists shared_memory_photos_message_position_idx
  on public.shared_memory_photos(message_id, position);
