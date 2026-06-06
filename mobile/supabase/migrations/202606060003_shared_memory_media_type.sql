-- Add media typing for shared memory room uploads.
-- Run after 202606060001_shared_memory_rooms.sql.

alter table public.shared_memory_photos
  add column if not exists media_type text not null default 'image';

alter table public.shared_memory_photos
  drop constraint if exists shared_memory_photos_media_type_check;

alter table public.shared_memory_photos
  add constraint shared_memory_photos_media_type_check
  check (media_type in ('image', 'video'));
