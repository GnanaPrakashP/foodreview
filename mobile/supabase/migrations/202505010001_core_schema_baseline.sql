-- Forward-safe core schema baseline for Supabase CLI reproducibility.
--
-- The mobile migration chain is applied to the same FoodReview database as the
-- web app. These mobile migrations assume the production core schema already
-- exists, so clean local validation needs the same core objects before the
-- Table Memory and Profile hardening migrations run. This migration creates
-- only missing objects and does not drop, rename, or rewrite existing data.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  username text not null,
  avatar_url text,
  bio text,
  account_type text not null default 'public',
  trust_score numeric not null default 20,
  trust_level text not null default 'New Reviewer',
  confirmed_recommendations_count integer not null default 0,
  positive_confirmations_count integer not null default 0,
  negative_confirmations_count integer not null default 0,
  total_feedback_points numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint profiles_username_unique unique (username),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_account_type_check check (account_type in ('private', 'public')),
  constraint profiles_taste_trust_level_check check (trust_level in ('New Reviewer', 'Low Trust', 'Mixed Trust', 'Growing Trust', 'Trusted', 'Highly Trusted')),
  constraint profiles_taste_trust_score_check check (trust_score >= 0 and trust_score <= 100)
);

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists username text,
  add column if not exists avatar_url text,
  add column if not exists bio text,
  add column if not exists account_type text not null default 'public',
  add column if not exists trust_score numeric not null default 20,
  add column if not exists trust_level text not null default 'New Reviewer',
  add column if not exists confirmed_recommendations_count integer not null default 0,
  add column if not exists positive_confirmations_count integer not null default 0,
  add column if not exists negative_confirmations_count integer not null default 0,
  add column if not exists total_feedback_points numeric not null default 0,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists profiles_username_unique_idx on public.profiles(username);
create index if not exists profiles_username_idx on public.profiles(username);

alter table public.profiles enable row level security;

drop policy if exists "Profiles readable by authenticated users" on public.profiles;
create policy "Profiles readable by authenticated users"
  on public.profiles for select to authenticated using (true);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  reviewer_name text not null,
  restaurant_id text,
  restaurant_name text not null,
  area text,
  restaurant_address text,
  restaurant_lat double precision,
  restaurant_lng double precision,
  items jsonb not null default '[]'::jsonb,
  body text,
  tags text[] not null default '{}'::text[],
  photo_url text,
  photo_urls text[] default '{}'::text[],
  visibility text not null default 'public',
  deleted_at timestamptz,
  hidden_at timestamptz,
  reported_at timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint reviews_visibility_check check (visibility in ('public', 'circle', 'me')),
  constraint reviews_status_check check (status in ('active', 'deleted', 'hidden', 'reported', 'removed'))
);

alter table public.reviews
  add column if not exists reviewer_name text,
  add column if not exists restaurant_id text,
  add column if not exists restaurant_name text,
  add column if not exists area text,
  add column if not exists restaurant_address text,
  add column if not exists restaurant_lat double precision,
  add column if not exists restaurant_lng double precision,
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists body text,
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists photo_url text,
  add column if not exists photo_urls text[] default '{}'::text[],
  add column if not exists visibility text not null default 'public',
  add column if not exists deleted_at timestamptz,
  add column if not exists hidden_at timestamptz,
  add column if not exists reported_at timestamptz,
  add column if not exists status text not null default 'active',
  add column if not exists created_at timestamptz not null default now();

create index if not exists reviews_created_at_desc_idx on public.reviews(created_at desc);
create index if not exists reviews_restaurant_id_idx on public.reviews(restaurant_id);
create index if not exists reviews_restaurant_name_idx on public.reviews(restaurant_name);
create index if not exists reviews_reviewer_name_idx on public.reviews(reviewer_name);
create index if not exists reviews_visibility_idx on public.reviews(visibility);
create index if not exists reviews_restaurant_location_idx
  on public.reviews(restaurant_lat, restaurant_lng)
  where restaurant_lat is not null and restaurant_lng is not null;
create index if not exists reviews_reviewer_restaurant_visibility_idx
  on public.reviews(reviewer_name, restaurant_id, restaurant_name, visibility);
create index if not exists reviews_visible_feed_idx
  on public.reviews(visibility, created_at desc)
  where deleted_at is null
    and hidden_at is null
    and reported_at is null
    and status = 'active';
create index if not exists reviews_suppression_idx
  on public.reviews(deleted_at, hidden_at, reported_at, status);
create index if not exists reviews_tags_gin_idx on public.reviews using gin(tags);

create table if not exists public.circle_requests (
  id uuid primary key default gen_random_uuid(),
  sender_name text not null,
  receiver_name text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique(sender_name, receiver_name),
  check(status in ('pending', 'accepted', 'rejected')),
  check(sender_name <> receiver_name)
);
create index if not exists circle_requests_sender_idx on public.circle_requests(sender_name);
create index if not exists circle_requests_receiver_idx on public.circle_requests(receiver_name);
alter table public.circle_requests enable row level security;
drop policy if exists "Circle requests readable by everyone" on public.circle_requests;
drop policy if exists "Anyone can send circle request" on public.circle_requests;
drop policy if exists "Anyone can respond to circle request" on public.circle_requests;
drop policy if exists "Anyone can delete circle request" on public.circle_requests;
drop policy if exists "Users can read own circle requests" on public.circle_requests;
create policy "Users can read own circle requests"
  on public.circle_requests for select to authenticated
  using (
    sender_name = (select p.username from public.profiles p where p.id = auth.uid())
    or receiver_name = (select p.username from public.profiles p where p.id = auth.uid())
  );

create table if not exists public.circle_memberships (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  member_name text not null,
  created_at timestamptz not null default now(),
  unique(user_name, member_name),
  check(user_name <> member_name)
);
create index if not exists circle_memberships_user_idx on public.circle_memberships(user_name);
create index if not exists circle_memberships_member_idx on public.circle_memberships(member_name);
create index if not exists circle_memberships_pair_idx on public.circle_memberships(user_name, member_name);
alter table public.circle_memberships enable row level security;
drop policy if exists "Circle memberships readable by everyone" on public.circle_memberships;
drop policy if exists "Anyone can add to circle" on public.circle_memberships;
drop policy if exists "Anyone can remove from circle" on public.circle_memberships;
drop policy if exists "Users can insert circle memberships" on public.circle_memberships;
drop policy if exists "Users can update circle memberships" on public.circle_memberships;
drop policy if exists "Users can delete circle memberships" on public.circle_memberships;
create policy "Circle memberships readable by authenticated users"
  on public.circle_memberships for select to authenticated using (true);

create or replace function public.current_profile_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.username
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

create or replace function public.review_is_unsuppressed(
  review_deleted_at timestamptz,
  review_hidden_at timestamptz,
  review_reported_at timestamptz,
  review_status text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select review_deleted_at is null
     and review_hidden_at is null
     and review_reported_at is null
     and coalesce(review_status, 'active') not in ('deleted', 'hidden', 'reported', 'removed')
$$;

create or replace function public.can_read_review_row(
  review_owner_name text,
  review_visibility text,
  review_deleted_at timestamptz,
  review_hidden_at timestamptz,
  review_reported_at timestamptz,
  review_status text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with viewer as (
    select public.current_profile_name() as name
  )
  select public.review_is_unsuppressed(
      review_deleted_at,
      review_hidden_at,
      review_reported_at,
      review_status
    )
    and (
      coalesce(review_visibility, 'public') = 'public'
      or exists (
        select 1
        from viewer v
        where v.name is not null
          and v.name = review_owner_name
      )
      or (
        coalesce(review_visibility, 'public') = 'circle'
        and exists (
          select 1
          from viewer v
          where v.name is not null
            and exists (
              select 1
              from public.circle_memberships cm
              where cm.user_name = review_owner_name
                and cm.member_name = v.name
            )
        )
      )
    )
$$;

create or replace function public.can_read_review_id(review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.can_read_review_row(
      r.reviewer_name,
      r.visibility,
      r.deleted_at,
      r.hidden_at,
      r.reported_at,
      r.status
    )
    from public.reviews r
    where r.id = review_id
  ), false)
$$;

revoke all on function public.current_profile_name() from public;
grant execute on function public.current_profile_name() to anon, authenticated;
revoke all on function public.review_is_unsuppressed(timestamptz, timestamptz, timestamptz, text) from public;
grant execute on function public.review_is_unsuppressed(timestamptz, timestamptz, timestamptz, text) to anon, authenticated;
revoke all on function public.can_read_review_row(text, text, timestamptz, timestamptz, timestamptz, text) from public;
grant execute on function public.can_read_review_row(text, text, timestamptz, timestamptz, timestamptz, text) to anon, authenticated;
revoke all on function public.can_read_review_id(uuid) from public;
grant execute on function public.can_read_review_id(uuid) to anon, authenticated;

alter table public.reviews enable row level security;

drop policy if exists "Reviews are readable by everyone" on public.reviews;
drop policy if exists "Reviews readable by visibility" on public.reviews;
create policy "Reviews readable by visibility"
  on public.reviews for select to anon, authenticated
  using (
    public.can_read_review_row(
      reviewer_name,
      visibility,
      deleted_at,
      hidden_at,
      reported_at,
      status
    )
  );

drop policy if exists "Anyone can post reviews" on public.reviews;
drop policy if exists "Authenticated users can insert own reviews" on public.reviews;
create policy "Authenticated users can insert own reviews"
  on public.reviews for insert to authenticated
  with check (reviewer_name = public.current_profile_name());

drop policy if exists "Users can update own reviews" on public.reviews;
create policy "Users can update own reviews"
  on public.reviews for update to authenticated
  using (reviewer_name = public.current_profile_name())
  with check (reviewer_name = public.current_profile_name());

drop policy if exists "Users can delete own reviews" on public.reviews;
create policy "Users can delete own reviews"
  on public.reviews for delete to authenticated
  using (reviewer_name = public.current_profile_name());

create table if not exists public.review_photos (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  storage_path text not null,
  public_url text not null,
  media_type text not null default 'image',
  width int,
  height int,
  size_bytes int,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint review_photos_media_type_check check (media_type in ('image', 'video'))
);

alter table public.review_photos
  add column if not exists storage_path text,
  add column if not exists public_url text,
  add column if not exists media_type text not null default 'image',
  add column if not exists width int,
  add column if not exists height int,
  add column if not exists size_bytes int,
  add column if not exists position smallint not null default 0,
  add column if not exists created_at timestamptz not null default now();

create index if not exists review_photos_review_id_idx on public.review_photos(review_id);
alter table public.review_photos enable row level security;

drop policy if exists "Review photos readable with review" on public.review_photos;
create policy "Review photos readable with review"
  on public.review_photos for select to anon, authenticated
  using (public.can_read_review_id(review_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'review-photos',
  'review-photos',
  true,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view review photos" on storage.objects;
create policy "Anyone can view review photos"
  on storage.objects for select
  using (bucket_id = 'review-photos');

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.reviews(id) on delete cascade,
  user_name text not null,
  created_at timestamptz not null default now(),
  unique(post_id, user_name)
);

create index if not exists likes_post_id_idx on public.likes(post_id);
alter table public.likes enable row level security;

drop policy if exists "Likes readable by everyone" on public.likes;
drop policy if exists "Likes readable by visible review" on public.likes;
create policy "Likes readable by visible review"
  on public.likes for select to anon, authenticated
  using (public.can_read_review_id(post_id));

drop policy if exists "Anyone can like" on public.likes;
drop policy if exists "Authenticated users can insert own likes" on public.likes;
create policy "Authenticated users can insert own likes"
  on public.likes for insert to authenticated
  with check (
    user_name = public.current_profile_name()
    and public.can_read_review_id(post_id)
  );

drop policy if exists "Anyone can unlike" on public.likes;
drop policy if exists "Users can delete own likes" on public.likes;
create policy "Users can delete own likes"
  on public.likes for delete to authenticated
  using (user_name = public.current_profile_name());

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.reviews(id) on delete cascade,
  user_name text not null,
  content text not null check(char_length(content) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists comments_post_id_idx on public.comments(post_id, created_at desc);
alter table public.comments enable row level security;

drop policy if exists "Comments readable by everyone" on public.comments;
drop policy if exists "Comments readable by visible review" on public.comments;
create policy "Comments readable by visible review"
  on public.comments for select to anon, authenticated
  using (public.can_read_review_id(post_id));

drop policy if exists "Anyone can comment" on public.comments;
drop policy if exists "Authenticated users can insert own comments" on public.comments;
create policy "Authenticated users can insert own comments"
  on public.comments for insert to authenticated
  with check (
    user_name = public.current_profile_name()
    and public.can_read_review_id(post_id)
  );

drop policy if exists "Anyone can delete own comments" on public.comments;
drop policy if exists "Users can delete own comments" on public.comments;
create policy "Users can delete own comments"
  on public.comments for delete to authenticated
  using (user_name = public.current_profile_name());

create table if not exists public.wishlist (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  restaurant_name text not null,
  post_id uuid references public.reviews(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists wishlist_user_idx on public.wishlist(user_name);
create unique index if not exists wishlist_user_post_unique
  on public.wishlist(user_name, post_id)
  where post_id is not null;
create unique index if not exists wishlist_user_place_unique
  on public.wishlist(user_name, restaurant_name)
  where post_id is null;

alter table public.wishlist enable row level security;

drop policy if exists "Wishlist readable by everyone" on public.wishlist;
drop policy if exists "Wishlist readable by owner" on public.wishlist;
create policy "Wishlist readable by owner"
  on public.wishlist for select to authenticated
  using (user_name = public.current_profile_name());

drop policy if exists "Anyone can bookmark" on public.wishlist;
drop policy if exists "Authenticated users can bookmark" on public.wishlist;
create policy "Authenticated users can bookmark"
  on public.wishlist for insert to authenticated
  with check (
    user_name = public.current_profile_name()
    and (
      post_id is null
      or public.can_read_review_id(post_id)
    )
  );

drop policy if exists "Anyone can unbookmark" on public.wishlist;
drop policy if exists "Users can delete own bookmarks" on public.wishlist;
create policy "Users can delete own bookmarks"
  on public.wishlist for delete to authenticated
  using (user_name = public.current_profile_name());

create table if not exists public.recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.reviews(id) on delete cascade,
  reviewer_user_id uuid not null references public.profiles(id) on delete cascade,
  feedback_user_id uuid not null references public.profiles(id) on delete cascade,
  place_id text,
  dish_id text,
  feedback_label text not null,
  feedback_value numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recommendation_feedback_unique_user_post unique (post_id, feedback_user_id),
  constraint recommendation_feedback_not_self check (feedback_user_id <> reviewer_user_id),
  constraint recommendation_feedback_value_check check (feedback_value in (1.0, 0.7, 0.3, -0.5, -1.0)),
  constraint recommendation_feedback_label_check check (feedback_label in ('Totally worth it', 'Mostly yes', 'It was okay', 'Not really', 'Not worth it'))
);

create index if not exists recommendation_feedback_post_id_idx on public.recommendation_feedback(post_id);
create index if not exists recommendation_feedback_reviewer_user_id_idx on public.recommendation_feedback(reviewer_user_id);
create index if not exists recommendation_feedback_feedback_user_id_idx on public.recommendation_feedback(feedback_user_id);
create index if not exists recommendation_feedback_place_id_idx
  on public.recommendation_feedback(place_id)
  where place_id is not null;

alter table public.recommendation_feedback enable row level security;

drop policy if exists "Recommendation feedback readable by owner" on public.recommendation_feedback;
create policy "Recommendation feedback readable by owner"
  on public.recommendation_feedback for select to authenticated
  using (feedback_user_id = auth.uid());

drop policy if exists "Users can insert own recommendation feedback" on public.recommendation_feedback;
create policy "Users can insert own recommendation feedback"
  on public.recommendation_feedback for insert to authenticated
  with check (
    feedback_user_id = auth.uid()
    and feedback_user_id <> reviewer_user_id
    and public.can_read_review_id(post_id)
  );

drop policy if exists "Users can update own recommendation feedback" on public.recommendation_feedback;
create policy "Users can update own recommendation feedback"
  on public.recommendation_feedback for update to authenticated
  using (feedback_user_id = auth.uid())
  with check (
    feedback_user_id = auth.uid()
    and feedback_user_id <> reviewer_user_id
    and public.can_read_review_id(post_id)
  );

drop policy if exists "Users can delete own recommendation feedback" on public.recommendation_feedback;
create policy "Users can delete own recommendation feedback"
  on public.recommendation_feedback for delete to authenticated
  using (feedback_user_id = auth.uid());

create table if not exists public.user_tried_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  place_id text,
  dish_id text,
  source_post_id uuid references public.reviews(id) on delete set null,
  source_user_id uuid references public.profiles(id) on delete set null,
  feedback_id uuid references public.recommendation_feedback(id) on delete set null,
  tried_status text not null default 'tried',
  visibility text not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_tried_items_visibility_check check (visibility in ('private', 'circle', 'public')),
  constraint user_tried_items_status_check check (tried_status in ('tried')),
  constraint user_tried_items_not_self check (source_user_id is null or user_id <> source_user_id)
);

create unique index if not exists user_tried_items_user_source_post_unique
  on public.user_tried_items(user_id, source_post_id)
  where source_post_id is not null;
create index if not exists user_tried_items_user_id_idx on public.user_tried_items(user_id);
create index if not exists user_tried_items_place_id_idx
  on public.user_tried_items(place_id)
  where place_id is not null;
create index if not exists user_tried_items_dish_id_idx
  on public.user_tried_items(dish_id)
  where dish_id is not null;
create index if not exists user_tried_items_source_post_id_idx on public.user_tried_items(source_post_id);
create index if not exists user_tried_items_source_user_id_idx on public.user_tried_items(source_user_id);
create index if not exists user_tried_items_feedback_id_idx on public.user_tried_items(feedback_id);
create index if not exists user_tried_items_visibility_idx on public.user_tried_items(visibility);

alter table public.user_tried_items enable row level security;

drop policy if exists "Users can read own tried items" on public.user_tried_items;
create policy "Users can read own tried items"
  on public.user_tried_items for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert own tried items" on public.user_tried_items;
create policy "Users can insert own tried items"
  on public.user_tried_items for insert to authenticated
  with check (
    user_id = auth.uid()
    and (source_user_id is null or source_user_id <> auth.uid())
    and visibility in ('private', 'circle', 'public')
    and tried_status = 'tried'
  );

drop policy if exists "Users can update own tried items" on public.user_tried_items;
create policy "Users can update own tried items"
  on public.user_tried_items for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (source_user_id is null or source_user_id <> auth.uid())
    and visibility in ('private', 'circle', 'public')
    and tried_status = 'tried'
  );

drop policy if exists "Users can delete own tried items" on public.user_tried_items;
create policy "Users can delete own tried items"
  on public.user_tried_items for delete to authenticated
  using (user_id = auth.uid());

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

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid references public.profiles(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  recipient_name text not null,
  actor_name text,
  type text not null,
  title text,
  message text,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}',
  is_read boolean not null default false,
  post_id uuid references public.reviews(id) on delete cascade,
  restaurant_name text,
  content text,
  read boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists notifications_recipient_idx
  on public.notifications(recipient_name, read, created_at desc);
create index if not exists notifications_recipient_created_idx
  on public.notifications(recipient_user_id, created_at desc)
  where deleted_at is null;
create index if not exists notifications_recipient_read_idx
  on public.notifications(recipient_user_id, is_read)
  where deleted_at is null;
create index if not exists notifications_recipient_user_unread_idx
  on public.notifications(recipient_user_id, is_read, read)
  where deleted_at is null;
create index if not exists notifications_recipient_name_unread_idx
  on public.notifications(recipient_name, is_read, read)
  where deleted_at is null;
create index if not exists notifications_actor_idx on public.notifications(actor_user_id);
create index if not exists notifications_type_idx on public.notifications(type);
create index if not exists notifications_entity_idx on public.notifications(entity_type, entity_id);
create index if not exists notifications_created_at_idx on public.notifications(created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "Notifications readable by everyone" on public.notifications;
drop policy if exists "Anyone can create notifications" on public.notifications;
drop policy if exists "Anyone can mark read" on public.notifications;
drop policy if exists "Notifications readable by recipient" on public.notifications;
drop policy if exists "Users can mark own notifications read" on public.notifications;

create policy "Notifications readable by recipient"
  on public.notifications for select to authenticated
  using (
    recipient_user_id = auth.uid()
    or recipient_name = public.current_profile_name()
  );

create policy "Users can mark own notifications read"
  on public.notifications for update to authenticated
  using (
    recipient_user_id = auth.uid()
    or recipient_name = public.current_profile_name()
  )
  with check (
    recipient_user_id = auth.uid()
    or recipient_name = public.current_profile_name()
  );

-- Supabase API roles need table privileges before RLS policies can be
-- evaluated. RLS remains the authorization boundary for anon/authenticated;
-- service_role is reserved for trusted server code and bypasses RLS.
grant usage on schema public to anon, authenticated, service_role;

grant select on table
  public.profiles,
  public.reviews,
  public.review_photos,
  public.likes,
  public.comments,
  public.wishlist,
  public.recommendation_feedback,
  public.user_tried_items,
  public.user_reputation,
  public.user_badges,
  public.post_visit_attributions,
  public.notifications
to anon, authenticated;

grant insert, update, delete on table
  public.profiles,
  public.reviews,
  public.review_photos,
  public.likes,
  public.comments,
  public.wishlist,
  public.recommendation_feedback,
  public.user_tried_items,
  public.post_visit_attributions,
  public.notifications
to authenticated;

grant all privileges on table
  public.profiles,
  public.reviews,
  public.circle_requests,
  public.circle_memberships,
  public.review_photos,
  public.likes,
  public.comments,
  public.wishlist,
  public.recommendation_feedback,
  public.user_tried_items,
  public.user_reputation,
  public.user_badges,
  public.post_visit_attributions,
  public.notifications
to service_role;
