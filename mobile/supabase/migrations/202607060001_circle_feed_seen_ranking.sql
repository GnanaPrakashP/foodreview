-- Persist per-viewer feed impressions so the Circle feed can rank unseen posts first.

-- Legacy-only migration kept for historical deployments/backfill.
-- Runtime Circle seen/view tracking is now canonicalized through public.post_views.

create table if not exists public.post_impressions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.reviews(id) on delete cascade,
  viewer_user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  viewer_name text not null default public.current_profile_name(),
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint post_impressions_unique_viewer_post unique (post_id, viewer_user_id)
);

alter table public.post_impressions
  add column if not exists post_id uuid references public.reviews(id) on delete cascade,
  add column if not exists viewer_user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists viewer_name text,
  add column if not exists seen_at timestamptz not null default now(),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.post_impressions
  alter column viewer_user_id set default auth.uid(),
  alter column viewer_name set default public.current_profile_name();

create unique index if not exists post_impressions_post_viewer_idx
  on public.post_impressions(post_id, viewer_user_id);
create index if not exists post_impressions_viewer_seen_idx
  on public.post_impressions(viewer_user_id, seen_at desc);
create index if not exists post_impressions_post_idx
  on public.post_impressions(post_id);

alter table public.post_impressions enable row level security;

drop policy if exists "Post impressions readable by viewer" on public.post_impressions;
create policy "Post impressions readable by viewer"
  on public.post_impressions for select to authenticated
  using (viewer_user_id = auth.uid());

drop policy if exists "Users can insert own post impressions" on public.post_impressions;
create policy "Users can insert own post impressions"
  on public.post_impressions for insert to authenticated
  with check (
    viewer_user_id = auth.uid()
    and viewer_name = public.current_profile_name()
    and public.can_read_review_id(post_id)
  );

drop policy if exists "Users can update own post impressions" on public.post_impressions;
create policy "Users can update own post impressions"
  on public.post_impressions for update to authenticated
  using (viewer_user_id = auth.uid())
  with check (
    viewer_user_id = auth.uid()
    and viewer_name = public.current_profile_name()
    and public.can_read_review_id(post_id)
  );

drop policy if exists "Users can delete own post impressions" on public.post_impressions;
create policy "Users can delete own post impressions"
  on public.post_impressions for delete to authenticated
  using (viewer_user_id = auth.uid());

grant select, insert, update, delete on public.post_impressions to authenticated;

comment on table public.post_impressions is
  'Per-viewer post seen state used by the Circle feed to prioritize unseen posts without exposing impressions to other users.';
