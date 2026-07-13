-- Canonical dish card images.
-- Keep this file in sync between mobile/supabase/migrations and supabase/migrations.

create table if not exists public.canonical_dish_images (
  id uuid primary key default gen_random_uuid(),
  canonical_dish_id uuid not null references public.canonical_dishes(id) on delete cascade,
  image_url text not null,
  source text not null,
  source_url text,
  provider_image_id text,
  license text,
  attribution_text text,
  attribution_url text,
  image_width integer,
  image_height integer,
  confidence numeric,
  status text not null default 'pending',
  is_primary boolean not null default true,
  notes text,
  reviewed_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canonical_dish_images_image_url_not_blank check (btrim(image_url) <> ''),
  constraint canonical_dish_images_source_not_blank check (btrim(source) <> ''),
  constraint canonical_dish_images_status_check check (status in ('pending', 'approved', 'rejected', 'hidden')),
  constraint canonical_dish_images_dimensions_check check (
    (image_width is null or image_width > 0)
    and (image_height is null or image_height > 0)
  ),
  constraint canonical_dish_images_confidence_check check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint canonical_dish_images_approved_at_check check (
    (status = 'approved' and approved_at is not null)
    or (status <> 'approved')
  )
);

comment on table public.canonical_dish_images is
  'Curated representative images for canonical dish cards. Approved rows may come from Wikimedia, food APIs, stock providers, generated assets, or manual curation with attribution metadata.';

comment on column public.canonical_dish_images.image_url is
  'HTTPS image URL displayed by mobile Explore when a canonical dish has no first-party review photo.';
comment on column public.canonical_dish_images.source is
  'Provider identifier such as wikimedia, spoonacular, pexels, unsplash, generated, or manual.';
comment on column public.canonical_dish_images.is_primary is
  'Only one approved primary image is used for a canonical dish card.';

create index if not exists canonical_dish_images_canonical_dish_id_idx
  on public.canonical_dish_images(canonical_dish_id);
create index if not exists canonical_dish_images_status_idx
  on public.canonical_dish_images(status);
create index if not exists canonical_dish_images_source_idx
  on public.canonical_dish_images(source);
create unique index if not exists canonical_dish_images_one_approved_primary_idx
  on public.canonical_dish_images(canonical_dish_id)
  where status = 'approved' and is_primary;

alter table public.canonical_dish_images enable row level security;

drop policy if exists "Approved canonical dish images are readable" on public.canonical_dish_images;
create policy "Approved canonical dish images are readable"
  on public.canonical_dish_images for select
  using (status = 'approved');

revoke all on table public.canonical_dish_images from anon, authenticated;
grant select on table public.canonical_dish_images to anon, authenticated;
grant all privileges on table public.canonical_dish_images to service_role;
