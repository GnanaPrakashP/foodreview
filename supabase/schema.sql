-- =============================================
-- FoodReview — Supabase / PostgreSQL schema
-- Run this in the Supabase SQL editor
-- =============================================

-- Drop old tables and triggers if they exist
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.reviews cascade;
drop table if exists public.profiles cascade;

-- =============================================
-- PROFILES  (one row per auth user)
-- =============================================
create table public.profiles (
  id           uuid        primary key references auth.users(id) on delete cascade,
  first_name   text        not null,
  last_name    text        not null,
  username     text        not null,
  avatar_url   text,
  account_type text        not null default 'public',
  created_at   timestamptz not null default now(),
  constraint profiles_username_unique  unique (username),
  constraint profiles_username_format  check  (username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_account_type_check check (account_type in ('private', 'public'))
);

create index if not exists profiles_username_idx on public.profiles(username);

alter table public.profiles enable row level security;

-- Anyone logged in can read all profiles (username uniqueness checks)
create policy "Profiles readable by authenticated users"
  on public.profiles for select to authenticated using (true);

-- Users can only create / update their own row
create policy "Users can insert own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id);

-- REVIEWS
create table public.reviews (
  id               uuid        primary key default gen_random_uuid(),
  reviewer_name    text        not null,
  restaurant_id    text,
  restaurant_name  text        not null,
  area             text,
  items            jsonb       not null default '[]',
  body             text,
  photo_url        text,
  visibility       text        not null default 'public',
  created_at       timestamptz not null default now()
);

-- Indexes
create index reviews_created_at_desc_idx  on public.reviews(created_at desc);
create index reviews_restaurant_id_idx    on public.reviews(restaurant_id);
create index reviews_restaurant_name_idx  on public.reviews(restaurant_name);
create index reviews_reviewer_name_idx    on public.reviews(reviewer_name);
create index reviews_visibility_idx       on public.reviews(visibility);
create index reviews_reviewer_restaurant_visibility_idx
  on public.reviews(reviewer_name, restaurant_id, restaurant_name, visibility);

-- =============================================
-- Trending score helper view
-- Recalculate in-app every 5 min (no cron needed for MVP).
-- For production: promote to a materialised view refreshed
-- every 6 hours via pg_cron.
-- =============================================

create or replace view public.trending_scores as
with
  this_week as (
    select restaurant_name,
           count(distinct reviewer_name) as users_week
    from public.reviews
    where visibility = 'public'
      and created_at > now() - interval '7 days'
    group by restaurant_name
  ),
  this_month as (
    select restaurant_name,
           count(distinct reviewer_name) as users_month
    from public.reviews
    where visibility = 'public'
      and created_at > now() - interval '30 days'
    group by restaurant_name
  ),
  recent as (
    select distinct restaurant_name
    from public.reviews
    where visibility = 'public'
      and created_at > now() - interval '2 days'
  ),
  all_time as (
    select restaurant_name,
           count(distinct reviewer_name) as users_all_time
    from public.reviews
    where visibility = 'public'
    group by restaurant_name
  )
select
  a.restaurant_name,
  coalesce(w.users_week,  0)                              as users_week,
  coalesce(m.users_month, 0)                              as users_month,
  a.users_all_time,
  case when r.restaurant_name is not null then 20 else 0 end as recency_boost,
  (coalesce(w.users_week, 0) * 3)
    + coalesce(m.users_month, 0)
    + case when r.restaurant_name is not null then 20 else 0 end
                                                           as trending_score
from all_time a
left join this_week  w on w.restaurant_name = a.restaurant_name
left join this_month m on m.restaurant_name = a.restaurant_name
left join recent     r on r.restaurant_name = a.restaurant_name
order by trending_score desc;

-- =============================================
-- Dish-level aggregation view
-- Powers the Dishes tab.  The "items" JSONB array
-- stores [{name, rating}] per review — we unnest it here.
-- =============================================

create or replace view public.dish_scores as
select
  r.restaurant_name,
  item ->> 'name'                             as dish_name,
  round(avg((item ->> 'rating')::numeric) * 2, 1)
                                              as avg_score_10,  -- 1-5 → 2-10
  count(distinct r.reviewer_name)             as unique_raters,
  count(*)                                    as total_logs
from public.reviews r,
     lateral jsonb_array_elements(r.items) as item
where (item ->> 'name') is not null
  and (item ->> 'name') != ''
  and r.visibility = 'public'
group by r.restaurant_name, item ->> 'name'
order by avg_score_10 desc, unique_raters desc;

-- =============================================
-- Migration: run this if the table already exists
-- (safe to run on a fresh setup too)
-- =============================================

-- Add area column (run once if table already exists)
alter table public.reviews add column if not exists area text;

-- Optional stable restaurant identity. Current app data may have null here;
-- application logic falls back to a normalized restaurant_name until this is populated.
alter table public.reviews add column if not exists restaurant_id text;

-- Add visibility column (public = everyone, circle = friends only, me = private log)
alter table public.reviews add column if not exists visibility text not null default 'public';
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'reviews_visibility_check'
  ) then
    alter table public.reviews
      add constraint reviews_visibility_check
      check (visibility in ('public', 'circle', 'me'));
  end if;
end $$;

alter table public.profiles add column if not exists account_type text not null default 'public';
alter table public.profiles alter column account_type set default 'public';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_account_type_check'
  ) then
    alter table public.profiles
      add constraint profiles_account_type_check
      check (account_type in ('private', 'public'));
  end if;
end $$;

-- No new columns needed — dish data lives in items[] JSONB.
-- To query dish data directly in SQL, use the dish_scores view above.
-- Example: find best "biryani" spots
--   select * from dish_scores
--   where dish_name ilike '%biryani%'
--   order by avg_score_10 desc, unique_raters desc;


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

-- =============================================
-- LIKES
-- =============================================
create table if not exists public.likes (
  id           uuid        primary key default gen_random_uuid(),
  post_id      uuid        not null references public.reviews(id) on delete cascade,
  user_name    text        not null,
  created_at   timestamptz not null default now(),
  unique(post_id, user_name)
);
create index if not exists likes_post_id_idx on public.likes(post_id);
alter table public.likes enable row level security;
create policy "Likes readable by everyone" on public.likes for select using (true);
create policy "Anyone can like"            on public.likes for insert with check (true);
create policy "Anyone can unlike"          on public.likes for delete using (true);

-- =============================================
-- COMMENTS
-- =============================================
create table if not exists public.comments (
  id           uuid        primary key default gen_random_uuid(),
  post_id      uuid        not null references public.reviews(id) on delete cascade,
  user_name    text        not null,
  content      text        not null check(char_length(content) <= 500),
  created_at   timestamptz not null default now()
);
create index if not exists comments_post_id_idx on public.comments(post_id, created_at desc);
alter table public.comments enable row level security;
create policy "Comments readable by everyone"    on public.comments for select using (true);
create policy "Anyone can comment"               on public.comments for insert with check (true);
create policy "Anyone can delete own comments"   on public.comments for delete using (true);

-- =============================================
-- NOTIFICATIONS
-- =============================================
create table if not exists public.notifications (
  id                 uuid        primary key default gen_random_uuid(),
  recipient_user_id  uuid        references public.profiles(id) on delete cascade,
  actor_user_id      uuid        references public.profiles(id) on delete set null,
  recipient_name     text        not null,
  actor_name         text,
  type               text        not null,
  title              text,
  message            text,
  entity_type        text,
  entity_id          text,
  metadata           jsonb       not null default '{}',
  is_read            boolean     not null default false,
  post_id            uuid        references public.reviews(id) on delete cascade,
  restaurant_name    text,
  content            text,
  read               boolean     not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index if not exists notifications_recipient_idx
  on public.notifications(recipient_name, read, created_at desc);
create index if not exists notifications_recipient_created_idx
  on public.notifications(recipient_user_id, created_at desc)
  where deleted_at is null;
create index if not exists notifications_recipient_read_idx
  on public.notifications(recipient_user_id, is_read)
  where deleted_at is null;
create index if not exists notifications_actor_idx
  on public.notifications(actor_user_id);
create index if not exists notifications_type_idx
  on public.notifications(type);
create index if not exists notifications_entity_idx
  on public.notifications(entity_type, entity_id);
create index if not exists notifications_created_at_idx
  on public.notifications(created_at desc);
alter table public.notifications enable row level security;
create policy "Notifications readable by everyone" on public.notifications for select using (true);
create policy "Anyone can create notifications"    on public.notifications for insert with check (true);
create policy "Anyone can mark read"               on public.notifications for update using (true);

-- =============================================
-- MIGRATION: make notifications.post_id nullable
-- (run once if the table already exists)
-- =============================================
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='notifications'
      and column_name='post_id' and is_nullable='NO'
  ) then
    alter table public.notifications alter column post_id drop not null;
  end if;
end $$;

-- =============================================
-- NOTIFICATION LIFECYCLE INDEXES
-- Speeds up entity-state validation queries in GET /notifications
-- =============================================

-- For validating like notifications: find likes by (post_id, user_name)
create index if not exists likes_post_user_idx on public.likes(post_id, user_name);

-- For validating circle request notifications: pending requests by sender
create index if not exists circle_requests_pending_sender_idx
  on public.circle_requests(sender_name, status)
  where status = 'pending';

-- For notification upsert: find existing circle request notification by actor+recipient
create index if not exists notifications_actor_recipient_type_idx
  on public.notifications(actor_name, recipient_name, type);

-- For like notification removal by actor+post
create index if not exists notifications_actor_post_type_idx
  on public.notifications(actor_name, post_id, type)
  where deleted_at is null;

-- For comment notification removal by metadata.commentId (jsonb containment)
create index if not exists notifications_metadata_gin_idx
  on public.notifications using gin(metadata)
  where deleted_at is null;

alter table public.notifications add column if not exists recipient_user_id uuid references public.profiles(id) on delete cascade;
alter table public.notifications add column if not exists actor_user_id uuid references public.profiles(id) on delete set null;
alter table public.notifications alter column actor_name drop not null;
alter table public.notifications add column if not exists title text;
alter table public.notifications add column if not exists message text;
alter table public.notifications add column if not exists entity_type text;
alter table public.notifications add column if not exists entity_id text;
alter table public.notifications add column if not exists metadata jsonb not null default '{}';
alter table public.notifications add column if not exists is_read boolean not null default false;
alter table public.notifications add column if not exists updated_at timestamptz not null default now();
alter table public.notifications add column if not exists deleted_at timestamptz;

update public.notifications
set
  is_read = coalesce(is_read, read, false),
  message = coalesce(
    message,
    case
      when type in ('like', 'POST_LIKED') then coalesce(actor_name, 'Someone') || ' liked your post'
      when type in ('comment', 'POST_COMMENTED') then coalesce(actor_name, 'Someone') || ' commented on your post'
      when type in ('also_commented', 'THREAD_REPLY') then coalesce(actor_name, 'Someone') || ' replied in a discussion you joined'
      when type in ('circle_request', 'CIRCLE_REQUEST_RECEIVED') then coalesce(actor_name, 'Someone') || ' requested to join your circle'
      when type in ('circle_accepted', 'CIRCLE_REQUEST_ACCEPTED') then coalesce(actor_name, 'Someone') || ' accepted your circle request'
      when type in ('circle_added', 'ADDED_TO_CIRCLE') then coalesce(actor_name, 'Someone') || ' joined your circle'
      when type in ('circle_post', 'CIRCLE_POST_CREATED') then coalesce(actor_name, 'Someone') || ' posted about ' || coalesce(restaurant_name, 'a restaurant')
      else 'You have a new notification'
    end
  ),
  entity_type = coalesce(
    entity_type,
    case
      when post_id is not null then 'POST'
      when type like 'CIRCLE_REQUEST%' or type like 'circle_%' then 'CIRCLE_REQUEST'
      else 'SYSTEM'
    end
  ),
  entity_id = coalesce(entity_id, post_id::text),
  metadata = coalesce(metadata, '{}'::jsonb)
where true;

update public.notifications n
set recipient_user_id = p.id
from public.profiles p
where n.recipient_user_id is null
  and (n.recipient_name = trim(p.first_name || ' ' || p.last_name) or n.recipient_name = p.username);

update public.notifications n
set actor_user_id = p.id
from public.profiles p
where n.actor_user_id is null
  and n.actor_name is not null
  and (n.actor_name = trim(p.first_name || ' ' || p.last_name) or n.actor_name = p.username);

-- =============================================
-- CIRCLE REQUESTS
-- =============================================
create table if not exists public.circle_requests (
  id            uuid        primary key default gen_random_uuid(),
  sender_name   text        not null,
  receiver_name text        not null,
  status        text        not null default 'pending',
  created_at    timestamptz not null default now(),
  unique(sender_name, receiver_name),
  check(status in ('pending', 'accepted', 'rejected')),
  check(sender_name != receiver_name)
);
create index if not exists circle_requests_sender_idx   on public.circle_requests(sender_name);
create index if not exists circle_requests_receiver_idx on public.circle_requests(receiver_name);
alter table public.circle_requests enable row level security;
create policy "Circle requests readable by everyone"    on public.circle_requests for select using (true);
create policy "Anyone can send circle request"          on public.circle_requests for insert with check (true);
create policy "Anyone can respond to circle request"    on public.circle_requests for update using (true);
create policy "Anyone can delete circle request"        on public.circle_requests for delete using (true);

-- =============================================
-- CIRCLE MEMBERSHIPS
-- Directed Circle edges. If A adds B, store (B, A):
-- A is inside B's Circle and receives B's posts.
-- Mutual Circle is represented by both directions existing.
-- =============================================
create table if not exists public.circle_memberships (
  id           uuid        primary key default gen_random_uuid(),
  user_name    text        not null,
  member_name  text        not null,
  created_at   timestamptz not null default now(),
  unique(user_name, member_name),
  check(user_name != member_name)
);
create index if not exists circle_memberships_user_idx
  on public.circle_memberships(user_name);
create index if not exists circle_memberships_member_idx
  on public.circle_memberships(member_name);
alter table public.circle_memberships enable row level security;
create policy "Circle memberships readable by everyone"
  on public.circle_memberships for select using (true);
create policy "Anyone can add to circle"
  on public.circle_memberships for insert with check (true);
create policy "Anyone can remove from circle"
  on public.circle_memberships for delete using (true);

insert into public.circle_memberships (user_name, member_name)
select sender_name, receiver_name
from public.circle_requests
where status = 'accepted'
on conflict (user_name, member_name) do nothing;

insert into public.circle_memberships (user_name, member_name)
select receiver_name, sender_name
from public.circle_requests
where status = 'accepted'
on conflict (user_name, member_name) do nothing;

-- =============================================
-- WISHLIST
-- =============================================
create table if not exists public.wishlist (
  id               uuid        primary key default gen_random_uuid(),
  user_name        text        not null,
  restaurant_name  text        not null,
  post_id          uuid        references public.reviews(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique(user_name, restaurant_name)
);
create index if not exists wishlist_user_idx on public.wishlist(user_name);
alter table public.wishlist enable row level security;
create policy "Wishlist readable by everyone" on public.wishlist for select using (true);
create policy "Anyone can bookmark"           on public.wishlist for insert with check (true);
create policy "Anyone can unbookmark"         on public.wishlist for delete using (true);
