-- review_photos: normalized per-photo rows attached to a review
create table public.review_photos (
  id           uuid        primary key default gen_random_uuid(),
  review_id    uuid        not null references public.reviews(id) on delete cascade,
  storage_path text        not null,
  public_url   text        not null,
  width        int,
  height       int,
  size_bytes   int,
  position     smallint    not null default 0,
  created_at   timestamptz not null default now()
);

create index review_photos_review_id_idx on public.review_photos(review_id);

alter table public.review_photos enable row level security;

-- readable if the parent review is readable
create policy "Review photos readable with review"
  on public.review_photos for select to anon, authenticated
  using (public.can_read_review_id(review_id));

-- quarantine prefix: allow authenticated uploads (server downloads via service role)
drop policy if exists "Authenticated users can upload to quarantine" on storage.objects;
create policy "Authenticated users can upload to quarantine"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'review-photos'
    and (storage.foldername(name))[1] = 'quarantine'
  );

-- service role handles deletes (cleanup of quarantine files)
drop policy if exists "Service role can delete review photos" on storage.objects;
create policy "Service role can delete review photos"
  on storage.objects for delete to service_role
  using (bucket_id = 'review-photos');
