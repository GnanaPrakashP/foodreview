create table if not exists public.user_reputation (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  profile_score numeric not null default 0,
  tier_display_name text not null default 'New Taster',
  current_weekly_streak int not null default 0,
  best_weekly_streak int not null default 0,
  current_monthly_streak int not null default 0,
  best_monthly_streak int not null default 0,
  last_weekly_active_period text,
  last_monthly_active_period text,
  updated_at timestamptz not null default now()
);

create index if not exists user_reputation_tier_idx on public.user_reputation(tier_display_name);

alter table public.user_reputation enable row level security;

drop policy if exists "User reputation readable by everyone" on public.user_reputation;
create policy "User reputation readable by everyone"
  on public.user_reputation for select to anon, authenticated
  using (true);

drop policy if exists "Users can update own reputation state" on public.user_reputation;

create table if not exists public.user_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_id text not null,
  badge_type text not null,
  badge_name text not null,
  badge_description text,
  badge_icon text,
  badge_category text,
  earned_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint user_badges_user_badge_unique unique(user_id, badge_id)
);

create index if not exists user_badges_user_earned_idx on public.user_badges(user_id, earned_at);
create index if not exists user_badges_badge_id_idx on public.user_badges(badge_id);

alter table public.user_badges enable row level security;

drop policy if exists "User badges readable by everyone" on public.user_badges;
create policy "User badges readable by everyone"
  on public.user_badges for select to anon, authenticated
  using (true);

create table if not exists public.post_visit_attributions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.reviews(id) on delete cascade,
  source_user_id uuid not null references public.profiles(id) on delete cascade,
  visitor_user_id uuid not null references public.profiles(id) on delete cascade,
  restaurant_id text,
  created_at timestamptz not null default now()
);

create index if not exists post_visit_attributions_post_id_idx on public.post_visit_attributions(post_id);
create index if not exists post_visit_attributions_source_user_id_idx on public.post_visit_attributions(source_user_id);
create index if not exists post_visit_attributions_visitor_user_id_idx on public.post_visit_attributions(visitor_user_id);

alter table public.post_visit_attributions enable row level security;

drop policy if exists "Visit attributions readable by participants" on public.post_visit_attributions;
create policy "Visit attributions readable by participants"
  on public.post_visit_attributions for select to authenticated
  using (source_user_id = auth.uid() or visitor_user_id = auth.uid());

drop policy if exists "Users can insert own visit attributions" on public.post_visit_attributions;
create policy "Users can insert own visit attributions"
  on public.post_visit_attributions for insert to authenticated
  with check (visitor_user_id = auth.uid() and visitor_user_id <> source_user_id);
