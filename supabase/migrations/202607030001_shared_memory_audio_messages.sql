-- Enable audio voice notes for Table Memory media uploads.
--
-- Keeps the existing private memory-media bucket, upload-intent flow, RLS, and
-- service-role-only finalization; this only widens media type and MIME allowlists.

alter table public.shared_memory_photos
  drop constraint if exists shared_memory_photos_media_type_check;

alter table public.shared_memory_photos
  add constraint shared_memory_photos_media_type_check
  check (media_type in ('audio', 'image', 'video'));

alter table public.shared_memory_upload_intents
  drop constraint if exists shared_memory_upload_intents_media_type_check;

alter table public.shared_memory_upload_intents
  add constraint shared_memory_upload_intents_media_type_check
  check (media_type in ('audio', 'image', 'video'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'memory-media',
  'memory-media',
  false,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/mp4', 'audio/x-m4a']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
