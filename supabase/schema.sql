-- =============================================
-- FoodReview — Supabase / PostgreSQL schema
-- Run this in the Supabase SQL editor
-- =============================================

-- Drop old tables and triggers if they exist
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.reviews cascade;
drop table if exists public.profiles cascade;

-- REVIEWS
create table public.reviews (
  id               uuid        primary key default gen_random_uuid(),
  reviewer_name    text        not null,
  restaurant_name  text        not null,
  items            jsonb       not null default '[]',
  body             text,
  photo_url        text,
  created_at       timestamptz not null default now()
);

-- Index for feed ordering
create index reviews_created_at_desc_idx on public.reviews(created_at desc);


-- =============================================
-- Row Level Security
-- =============================================

alter table public.reviews enable row level security;

create policy "Reviews are readable by everyone"
  on public.reviews for select
  using (true);

create policy "Anyone can post reviews"
  on public.reviews for insert
  with check (true);


-- =============================================
-- Storage bucket for review photos
-- =============================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'review-photos',
  'review-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

drop policy if exists "Anyone can view review photos" on storage.objects;
drop policy if exists "Anyone can upload review photos" on storage.objects;
drop policy if exists "Authenticated users can upload review photos" on storage.objects;
drop policy if exists "Users can delete their own review photos" on storage.objects;

create policy "Anyone can view review photos"
  on storage.objects for select
  using (bucket_id = 'review-photos');

create policy "Anyone can upload review photos"
  on storage.objects for insert
  with check (bucket_id = 'review-photos');
