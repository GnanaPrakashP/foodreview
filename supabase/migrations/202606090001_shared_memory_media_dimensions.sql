-- Store original media dimensions so chat previews can size without runtime image probing.

alter table public.shared_memory_photos
  add column if not exists image_width integer,
  add column if not exists image_height integer;

alter table public.shared_memory_photos
  drop constraint if exists shared_memory_photos_positive_dimensions;

alter table public.shared_memory_photos
  add constraint shared_memory_photos_positive_dimensions
  check (
    (image_width is null and image_height is null)
    or
    (image_width > 0 and image_height > 0)
  );
