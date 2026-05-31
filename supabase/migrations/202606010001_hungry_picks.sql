-- Server-backed right-swiped Hungry picks.
create table if not exists public.hungry_picks (
  id         uuid        primary key default gen_random_uuid(),
  user_name  text        not null,
  post_id    uuid        not null references public.reviews(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists hungry_picks_user_idx on public.hungry_picks(user_name);

create unique index if not exists hungry_picks_user_post_unique
  on public.hungry_picks(user_name, post_id);

alter table public.hungry_picks enable row level security;

drop policy if exists "Hungry picks readable by owner" on public.hungry_picks;
create policy "Hungry picks readable by owner"
  on public.hungry_picks for select to authenticated
  using (user_name = public.current_profile_name());

drop policy if exists "Authenticated users can pick hungry posts" on public.hungry_picks;
create policy "Authenticated users can pick hungry posts"
  on public.hungry_picks for insert to authenticated
  with check (
    user_name = public.current_profile_name()
    and public.can_read_review_id(post_id)
  );

drop policy if exists "Users can delete own hungry picks" on public.hungry_picks;
create policy "Users can delete own hungry picks"
  on public.hungry_picks for delete to authenticated
  using (user_name = public.current_profile_name());
