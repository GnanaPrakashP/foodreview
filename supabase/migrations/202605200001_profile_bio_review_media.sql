alter table public.profiles
  add column if not exists bio text;

alter table public.review_photos
  add column if not exists media_type text not null default 'image';

update public.review_photos
set media_type = 'image'
where media_type is null
   or media_type not in ('image', 'video');

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.review_photos'::regclass
      and conname = 'review_photos_media_type_check'
  ) then
    alter table public.review_photos
      add constraint review_photos_media_type_check
      check (media_type in ('image', 'video'));
  end if;
end $$;

update storage.buckets
set
  file_size_limit = 52428800,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
where id = 'review-photos';
