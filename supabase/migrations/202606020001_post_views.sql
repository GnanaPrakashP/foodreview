-- Durable per-user seen-post tracking for feeds.
create table if not exists public.post_views (
  user_id   uuid        not null references public.profiles(id) on delete cascade,
  post_id   uuid        not null references public.reviews(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists post_views_user_viewed_at_idx
  on public.post_views(user_id, viewed_at desc);

create index if not exists post_views_post_id_idx
  on public.post_views(post_id);

alter table public.post_views enable row level security;

drop policy if exists "Post views readable by owner" on public.post_views;
create policy "Post views readable by owner"
  on public.post_views for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert own post views" on public.post_views;
create policy "Users can insert own post views"
  on public.post_views for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.can_read_review_id(post_id)
  );

drop policy if exists "Users can update own post views" on public.post_views;
create policy "Users can update own post views"
  on public.post_views for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.can_read_review_id(post_id)
  );

drop policy if exists "Users can delete own post views" on public.post_views;
create policy "Users can delete own post views"
  on public.post_views for delete to authenticated
  using (user_id = auth.uid());
