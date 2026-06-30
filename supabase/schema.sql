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
  bio          text,
  account_type text        not null default 'public',
  trust_score  numeric     not null default 20,
  trust_level  text        not null default 'New Reviewer',
  confirmed_recommendations_count integer not null default 0,
  positive_confirmations_count integer not null default 0,
  negative_confirmations_count integer not null default 0,
  total_feedback_points numeric not null default 0,
  created_at   timestamptz not null default now(),
  constraint profiles_username_unique  unique (username),
  constraint profiles_username_format  check  (username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_account_type_check check (account_type in ('private', 'public')),
  constraint profiles_taste_trust_level_check check (trust_level in ('New Reviewer', 'Low Trust', 'Mixed Trust', 'Growing Trust', 'Trusted', 'Highly Trusted')),
  constraint profiles_taste_trust_score_check check (trust_score >= 0 and trust_score <= 100)
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
  restaurant_address text,
  restaurant_lat   double precision,
  restaurant_lng   double precision,
  items            jsonb       not null default '[]',
  body             text,
  tags             text[]      not null default '{}'::text[],
  photo_url        text,
  photo_urls       text[]      default '{}'::text[],
  visibility       text        not null default 'public',
  deleted_at       timestamptz,
  hidden_at        timestamptz,
  reported_at      timestamptz,
  status           text        not null default 'active',
  created_at       timestamptz not null default now(),
  constraint reviews_visibility_check check (visibility in ('public', 'circle', 'me')),
  constraint reviews_status_check check (status in ('active', 'deleted', 'hidden', 'reported', 'removed'))
);

-- Indexes
create index reviews_created_at_desc_idx  on public.reviews(created_at desc);
create index reviews_restaurant_id_idx    on public.reviews(restaurant_id);
create index reviews_restaurant_name_idx  on public.reviews(restaurant_name);
create index reviews_reviewer_name_idx    on public.reviews(reviewer_name);
create index reviews_visibility_idx       on public.reviews(visibility);
create index if not exists reviews_restaurant_location_idx
  on public.reviews(restaurant_lat, restaurant_lng)
  where restaurant_lat is not null
    and restaurant_lng is not null;
create index reviews_reviewer_restaurant_visibility_idx
  on public.reviews(reviewer_name, restaurant_id, restaurant_name, visibility);
create index reviews_visible_feed_idx
  on public.reviews(visibility, created_at desc)
  where deleted_at is null
    and hidden_at is null
    and reported_at is null
    and status = 'active';
create index reviews_suppression_idx
  on public.reviews(deleted_at, hidden_at, reported_at, status);
create index if not exists reviews_tags_gin_idx
  on public.reviews using gin(tags);

-- STORIES
create table if not exists public.stories (
  id            uuid        primary key default gen_random_uuid(),
  author_name   text        not null,
  media_url     text        not null,
  storage_path  text,
  caption       text,
  visibility    text        not null default 'circle',
  status        text        not null default 'active',
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '24 hours'),
  deleted_at    timestamptz,
  hidden_at     timestamptz,
  reported_at   timestamptz,
  constraint stories_visibility_check check (visibility in ('public', 'circle')),
  constraint stories_status_check check (status in ('active', 'deleted', 'hidden', 'reported', 'removed'))
);
create index if not exists stories_active_feed_idx
  on public.stories(author_name, expires_at desc, created_at desc)
  where deleted_at is null
    and hidden_at is null
    and reported_at is null
    and status = 'active';
create index if not exists stories_expires_at_idx on public.stories(expires_at);

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
      and deleted_at is null
      and hidden_at is null
      and reported_at is null
      and status = 'active'
      and created_at > now() - interval '7 days'
    group by restaurant_name
  ),
  this_month as (
    select restaurant_name,
           count(distinct reviewer_name) as users_month
    from public.reviews
    where visibility = 'public'
      and deleted_at is null
      and hidden_at is null
      and reported_at is null
      and status = 'active'
      and created_at > now() - interval '30 days'
    group by restaurant_name
  ),
  recent as (
    select distinct restaurant_name
    from public.reviews
    where visibility = 'public'
      and deleted_at is null
      and hidden_at is null
      and reported_at is null
      and status = 'active'
      and created_at > now() - interval '2 days'
  ),
  all_time as (
    select restaurant_name,
           count(distinct reviewer_name) as users_all_time
    from public.reviews
    where visibility = 'public'
      and deleted_at is null
      and hidden_at is null
      and reported_at is null
      and status = 'active'
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
  and r.deleted_at is null
  and r.hidden_at is null
  and r.reported_at is null
  and r.status = 'active'
group by r.restaurant_name, item ->> 'name'
order by avg_score_10 desc, unique_raters desc;

-- =============================================
-- Migration: run this if the table already exists
-- (safe to run on a fresh setup too)
-- =============================================

-- Add area column (run once if table already exists)
alter table public.reviews add column if not exists area text;
alter table public.reviews add column if not exists restaurant_address text;
alter table public.reviews add column if not exists restaurant_lat double precision;
alter table public.reviews add column if not exists restaurant_lng double precision;
alter table public.reviews add column if not exists tags text[] not null default '{}'::text[];

-- Optional stable restaurant identity. Current app data may have null here;
-- application logic falls back to a normalized restaurant_name until this is populated.
alter table public.reviews add column if not exists restaurant_id text;
alter table public.reviews add column if not exists photo_urls text[] default '{}'::text[];
alter table public.reviews alter column photo_urls set default '{}'::text[];

create table if not exists public.stories (
  id            uuid        primary key default gen_random_uuid(),
  author_name   text        not null,
  media_url     text        not null,
  storage_path  text,
  caption       text,
  visibility    text        not null default 'circle',
  status        text        not null default 'active',
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '24 hours'),
  deleted_at    timestamptz,
  hidden_at     timestamptz,
  reported_at   timestamptz
);
alter table public.stories add column if not exists storage_path text;
alter table public.stories add column if not exists caption text;
alter table public.stories add column if not exists visibility text not null default 'circle';
alter table public.stories add column if not exists status text not null default 'active';
alter table public.stories add column if not exists expires_at timestamptz not null default (now() + interval '24 hours');
alter table public.stories add column if not exists deleted_at timestamptz;
alter table public.stories add column if not exists hidden_at timestamptz;
alter table public.stories add column if not exists reported_at timestamptz;
do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stories'::regclass
      and conname = 'stories_visibility_check'
  ) then
    alter table public.stories
      add constraint stories_visibility_check
      check (visibility in ('public', 'circle'));
  end if;
end $$;
do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stories'::regclass
      and conname = 'stories_status_check'
  ) then
    alter table public.stories
      add constraint stories_status_check
      check (status in ('active', 'deleted', 'hidden', 'reported', 'removed'));
  end if;
end $$;
create index if not exists stories_active_feed_idx
  on public.stories(author_name, expires_at desc, created_at desc)
  where deleted_at is null
    and hidden_at is null
    and reported_at is null
    and status = 'active';
create index if not exists stories_expires_at_idx on public.stories(expires_at);

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

alter table public.reviews add column if not exists deleted_at timestamptz;
alter table public.reviews add column if not exists hidden_at timestamptz;
alter table public.reviews add column if not exists reported_at timestamptz;
alter table public.reviews add column if not exists status text;
update public.reviews
set status = 'active'
where status is null
   or lower(status) not in ('active', 'deleted', 'hidden', 'reported', 'removed');
alter table public.reviews alter column status set default 'active';
alter table public.reviews alter column status set not null;
do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.reviews'::regclass
      and conname = 'reviews_status_check'
  ) then
    alter table public.reviews
      add constraint reviews_status_check
      check (status in ('active', 'deleted', 'hidden', 'reported', 'removed'));
  end if;
end $$;

alter table public.profiles add column if not exists account_type text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists trust_score numeric not null default 20;
alter table public.profiles add column if not exists trust_level text not null default 'New Reviewer';
alter table public.profiles add column if not exists confirmed_recommendations_count integer not null default 0;
alter table public.profiles add column if not exists positive_confirmations_count integer not null default 0;
alter table public.profiles add column if not exists negative_confirmations_count integer not null default 0;
alter table public.profiles add column if not exists total_feedback_points numeric not null default 0;
update public.profiles
set account_type = 'public'
where account_type is null
   or account_type not in ('public', 'private');
alter table public.profiles alter column account_type set default 'public';
alter table public.profiles alter column account_type set not null;

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_account_type_check'
  ) then
    alter table public.profiles
      add constraint profiles_account_type_check
      check (account_type in ('private', 'public'));
  end if;
end $$;
do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_taste_trust_level_check'
  ) then
    alter table public.profiles
      add constraint profiles_taste_trust_level_check
      check (trust_level in ('New Reviewer', 'Low Trust', 'Mixed Trust', 'Growing Trust', 'Trusted', 'Highly Trusted'));
  end if;
end $$;
do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_taste_trust_score_check'
  ) then
    alter table public.profiles
      add constraint profiles_taste_trust_score_check
      check (trust_score >= 0 and trust_score <= 100);
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

-- The review read policy depends on Circle tables. Define them before creating
-- the helper functions so a fresh schema load can compile all functions.
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

create table if not exists public.circle_memberships (
  id           uuid        primary key default gen_random_uuid(),
  user_name    text        not null,
  member_name  text        not null,
  created_at   timestamptz not null default now(),
  unique(user_name, member_name),
  check(user_name != member_name)
);

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
            and (
              exists (
                select 1
                from public.circle_memberships cm
                where cm.user_name = review_owner_name
                  and cm.member_name = v.name
              )
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

create or replace function public.can_read_story_row(
  story_owner_name text,
  story_visibility text,
  story_expires_at timestamptz,
  story_deleted_at timestamptz,
  story_hidden_at timestamptz,
  story_reported_at timestamptz,
  story_status text
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
  select story_expires_at > now()
    and story_deleted_at is null
    and story_hidden_at is null
    and story_reported_at is null
    and coalesce(story_status, 'active') not in ('deleted', 'hidden', 'reported', 'removed')
    and (
      coalesce(story_visibility, 'circle') = 'public'
      or exists (
        select 1
        from viewer v
        where v.name is not null
          and v.name = story_owner_name
      )
      or (
        coalesce(story_visibility, 'circle') = 'circle'
        and exists (
          select 1
          from viewer v
          where v.name is not null
            and exists (
              select 1
              from public.circle_memberships cm
              where cm.user_name = story_owner_name
                and cm.member_name = v.name
            )
        )
      )
    )
$$;

grant execute on function public.current_profile_name() to anon, authenticated;
grant execute on function public.review_is_unsuppressed(timestamptz, timestamptz, timestamptz, text) to anon, authenticated;
grant execute on function public.can_read_review_row(text, text, timestamptz, timestamptz, timestamptz, text) to anon, authenticated;
grant execute on function public.can_read_review_id(uuid) to anon, authenticated;
grant execute on function public.can_read_story_row(text, text, timestamptz, timestamptz, timestamptz, timestamptz, text) to anon, authenticated;

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

alter table public.stories enable row level security;
drop policy if exists "Stories readable by visibility" on public.stories;
create policy "Stories readable by visibility"
  on public.stories for select to anon, authenticated
  using (
    public.can_read_story_row(
      author_name,
      visibility,
      expires_at,
      deleted_at,
      hidden_at,
      reported_at,
      status
    )
  );

drop policy if exists "Authenticated users can insert own stories" on public.stories;
create policy "Authenticated users can insert own stories"
  on public.stories for insert to authenticated
  with check (author_name = public.current_profile_name());

drop policy if exists "Users can update own stories" on public.stories;
create policy "Users can update own stories"
  on public.stories for update to authenticated
  using (author_name = public.current_profile_name())
  with check (author_name = public.current_profile_name());

drop policy if exists "Users can delete own stories" on public.stories;
create policy "Users can delete own stories"
  on public.stories for delete to authenticated
  using (author_name = public.current_profile_name());


-- =============================================
-- Review photos (normalized, per-photo rows)
-- =============================================

create table if not exists public.review_photos (
  id           uuid        primary key default gen_random_uuid(),
  review_id    uuid        not null references public.reviews(id) on delete cascade,
  storage_path text        not null,
  public_url   text        not null,
  media_type   text        not null default 'image',
  width        int,
  height       int,
  size_bytes   int,
  position     smallint    not null default 0,
  created_at   timestamptz not null default now(),
  constraint review_photos_media_type_check check (media_type in ('image', 'video'))
);
alter table public.review_photos add column if not exists media_type text not null default 'image';
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

create index if not exists review_photos_review_id_idx on public.review_photos(review_id);

alter table public.review_photos enable row level security;

drop policy if exists "Review photos readable with review" on public.review_photos;
create policy "Review photos readable with review"
  on public.review_photos for select to anon, authenticated
  using (public.can_read_review_id(review_id));

create table if not exists public.review_media_upload_intents (
  id                      uuid        primary key default gen_random_uuid(),
  user_id                 uuid        not null references auth.users(id) on delete cascade,
  user_name               text        not null,
  category                text        not null,
  media_type              text        not null,
  mime_type               text        not null,
  extension               text        not null,
  file_size_bytes         bigint      not null,
  max_file_size_bytes     bigint      not null,
  final_bucket_id         text        not null default 'review-photos',
  quarantine_bucket_id    text        not null default 'review-media-quarantine',
  quarantine_storage_path text        not null unique,
  storage_path            text        not null unique,
  status                  text        not null default 'created',
  moderation_status       text,
  moderation_reason       text,
  created_at              timestamptz not null default now(),
  expires_at              timestamptz not null,
  finalized_at            timestamptz,
  check (category in ('avatar', 'post')),
  check (media_type in ('image', 'video')),
  check (status in ('created', 'finalized', 'consumed', 'expired', 'rejected', 'abandoned')),
  check (file_size_bytes > 0),
  check (max_file_size_bytes > 0),
  check (file_size_bytes <= max_file_size_bytes),
  check (final_bucket_id = 'review-photos'),
  check (quarantine_bucket_id = 'review-media-quarantine'),
  check (quarantine_storage_path ~ ('^pending/' || user_id::text || '/' || id::text || '/[A-Za-z0-9._~-]+$')),
  check (
    (category = 'avatar' and media_type = 'image' and storage_path ~ ('^avatars/' || user_id::text || '/' || id::text || '/[A-Za-z0-9._~-]+$'))
    or
    (category = 'post' and storage_path ~ ('^posts/' || user_id::text || '/' || id::text || '/[A-Za-z0-9._~-]+$'))
  )
);

alter table public.review_media_upload_intents enable row level security;

drop policy if exists "Users can read own review media upload intents" on public.review_media_upload_intents;
create policy "Users can read own review media upload intents"
  on public.review_media_upload_intents for select to authenticated
  using (user_id = auth.uid());

-- =============================================
-- Storage bucket for review photos
-- =============================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'review-photos',
  'review-photos',
  true,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'review-media-quarantine',
  'review-media-quarantine',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view review photos" on storage.objects;
drop policy if exists "Anyone can upload review photos" on storage.objects;
drop policy if exists "Authenticated users can upload review photos" on storage.objects;
drop policy if exists "Authenticated users can upload to quarantine" on storage.objects;
drop policy if exists "Users can delete their own review photos" on storage.objects;
drop policy if exists "Service role can delete review photos" on storage.objects;
drop policy if exists "Authenticated users can upload scoped review media quarantine intents" on storage.objects;
drop policy if exists "Service role can manage review media objects" on storage.objects;

create policy "Anyone can view review photos"
  on storage.objects for select
  using (bucket_id = 'review-photos');

create policy "Authenticated users can upload scoped review media quarantine intents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'review-media-quarantine'
    and exists (
      select 1
      from public.review_media_upload_intents intent
      where intent.quarantine_bucket_id = storage.objects.bucket_id
        and intent.quarantine_storage_path = storage.objects.name
        and intent.user_id = auth.uid()
        and intent.status = 'created'
        and intent.expires_at > now()
        and intent.quarantine_storage_path like ('pending/' || auth.uid()::text || '/' || intent.id::text || '/%')
    )
  );

create policy "Service role can manage review media objects"
  on storage.objects for delete to service_role
  using (bucket_id in ('review-photos', 'review-media-quarantine'));

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
create policy "Users can delete own likes"
  on public.likes for delete to authenticated
  using (user_name = public.current_profile_name());

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
create policy "Users can delete own comments"
  on public.comments for delete to authenticated
  using (user_name = public.current_profile_name());

-- =============================================
-- CONTENT REPORTS / MODERATION QUEUE
-- =============================================
create table if not exists public.content_reports (
  id              uuid        primary key default gen_random_uuid(),
  reporter_id     uuid        not null references public.profiles(id) on delete cascade,
  reporter_name   text        not null,
  target_type     text        not null,
  target_id       text        not null,
  reason          text        not null,
  details         text,
  status          text        not null default 'open',
  moderator_id    uuid        references public.profiles(id) on delete set null,
  moderator_name  text,
  resolution_note text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  constraint content_reports_target_type_check check (target_type in ('review', 'comment', 'profile', 'media')),
  constraint content_reports_reason_check check (reason in ('spam', 'harassment', 'unsafe', 'off_topic', 'copyright', 'other')),
  constraint content_reports_status_check check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  constraint content_reports_details_length_check check (details is null or char_length(details) <= 1000),
  constraint content_reports_unique_open_report unique (reporter_id, target_type, target_id, reason)
);

create index if not exists content_reports_status_created_idx
  on public.content_reports(status, created_at desc);
create index if not exists content_reports_target_idx
  on public.content_reports(target_type, target_id);
create index if not exists content_reports_reporter_idx
  on public.content_reports(reporter_id, created_at desc);

alter table public.content_reports enable row level security;

drop policy if exists "Users can read own content reports" on public.content_reports;
create policy "Users can read own content reports"
  on public.content_reports for select to authenticated
  using (reporter_id = auth.uid());

drop policy if exists "Users can create own content reports" on public.content_reports;
create policy "Users can create own content reports"
  on public.content_reports for insert to authenticated
  with check (reporter_id = auth.uid() and reporter_name = public.current_profile_name());

grant select, insert on table public.content_reports to authenticated;
grant all privileges on table public.content_reports to service_role;

-- =============================================
-- TASTE TRUST / RECOMMENDATION FEEDBACK
-- =============================================
create table if not exists public.recommendation_feedback (
  id                uuid        primary key default gen_random_uuid(),
  post_id           uuid        not null references public.reviews(id) on delete cascade,
  reviewer_user_id  uuid        not null references public.profiles(id) on delete cascade,
  feedback_user_id  uuid        not null references public.profiles(id) on delete cascade,
  place_id          text,
  dish_id           text,
  feedback_label    text        not null,
  feedback_value    numeric     not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint recommendation_feedback_unique_user_post unique (post_id, feedback_user_id),
  constraint recommendation_feedback_not_self check (feedback_user_id <> reviewer_user_id),
  constraint recommendation_feedback_value_check check (feedback_value in (1.0, 0.7, 0.3, -0.5, -1.0)),
  constraint recommendation_feedback_label_check check (feedback_label in ('Strongly agree', 'Agree', 'Neutral', 'Disagree', 'Strongly disagree'))
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
    and exists (
      select 1
      from public.reviews r
      join public.profiles p on p.username = r.reviewer_name
      where r.id = post_id
        and p.id = reviewer_user_id
        and r.visibility in ('public', 'circle')
        and r.reviewer_name <> public.current_profile_name()
    )
  );

drop policy if exists "Users can update own recommendation feedback" on public.recommendation_feedback;
create policy "Users can update own recommendation feedback"
  on public.recommendation_feedback for update to authenticated
  using (feedback_user_id = auth.uid())
  with check (
    feedback_user_id = auth.uid()
    and feedback_user_id <> reviewer_user_id
    and public.can_read_review_id(post_id)
    and exists (
      select 1
      from public.reviews r
      join public.profiles p on p.username = r.reviewer_name
      where r.id = post_id
        and p.id = reviewer_user_id
        and r.visibility in ('public', 'circle')
        and r.reviewer_name <> public.current_profile_name()
    )
  );

drop policy if exists "Users can delete own recommendation feedback" on public.recommendation_feedback;
create policy "Users can delete own recommendation feedback"
  on public.recommendation_feedback for delete to authenticated
  using (feedback_user_id = auth.uid());

revoke update (
  trust_score,
  trust_level,
  confirmed_recommendations_count,
  positive_confirmations_count,
  negative_confirmations_count,
  total_feedback_points
) on public.profiles from authenticated;

create table if not exists public.user_tried_items (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references public.profiles(id) on delete cascade,
  place_id        text,
  dish_id         text,
  source_post_id  uuid        references public.reviews(id) on delete set null,
  source_user_id  uuid        references public.profiles(id) on delete set null,
  feedback_id     uuid        references public.recommendation_feedback(id) on delete set null,
  tried_status    text        not null default 'tried',
  visibility      text        not null default 'private',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
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

-- =============================================
-- USER REPUTATION / BADGES
-- =============================================
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
create index if not exists notifications_recipient_user_unread_idx
  on public.notifications(recipient_user_id, is_read, read)
  where deleted_at is null;
create index if not exists notifications_recipient_name_unread_idx
  on public.notifications(recipient_name, is_read, read)
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
drop policy if exists "Notifications readable by everyone" on public.notifications;
drop policy if exists "Anyone can create notifications" on public.notifications;
drop policy if exists "Anyone can mark read" on public.notifications;
drop policy if exists "Notifications readable by recipient" on public.notifications;
drop policy if exists "Users can mark own notifications read" on public.notifications;
create policy "Notifications readable by recipient"
  on public.notifications for select to authenticated
  using (
    recipient_user_id = auth.uid()
    or recipient_name = (select p.username from public.profiles p where p.id = auth.uid())
  );
create policy "Users can mark own notifications read"
  on public.notifications for update to authenticated
  using (
    recipient_user_id = auth.uid()
    or recipient_name = (select p.username from public.profiles p where p.id = auth.uid())
  )
  with check (
    recipient_user_id = auth.uid()
    or recipient_name = (select p.username from public.profiles p where p.id = auth.uid())
  );

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
  and (n.recipient_name = p.username or n.recipient_name = trim(p.first_name || ' ' || p.last_name));

update public.notifications n
set actor_user_id = p.id
from public.profiles p
where n.actor_user_id is null
  and n.actor_name is not null
  and (n.actor_name = p.username or n.actor_name = trim(p.first_name || ' ' || p.last_name));

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
drop policy if exists "Circle requests readable by everyone" on public.circle_requests;
drop policy if exists "Anyone can send circle request" on public.circle_requests;
drop policy if exists "Anyone can respond to circle request" on public.circle_requests;
drop policy if exists "Anyone can delete circle request" on public.circle_requests;
drop policy if exists "Users can read own circle requests" on public.circle_requests;
create policy "Users can read own circle requests"
  on public.circle_requests for select to authenticated
  using (
    sender_name   = (select p.username from public.profiles p where p.id = auth.uid())
    or receiver_name = (select p.username from public.profiles p where p.id = auth.uid())
  );

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
create index if not exists circle_memberships_pair_idx
  on public.circle_memberships(user_name, member_name);
alter table public.circle_memberships enable row level security;
drop policy if exists "Circle memberships readable by everyone" on public.circle_memberships;
drop policy if exists "Anyone can add to circle" on public.circle_memberships;
drop policy if exists "Anyone can remove from circle" on public.circle_memberships;
drop policy if exists "Users can insert circle memberships" on public.circle_memberships;
drop policy if exists "Users can update circle memberships" on public.circle_memberships;
drop policy if exists "Users can delete circle memberships" on public.circle_memberships;
create policy "Circle memberships readable by authenticated users"
  on public.circle_memberships for select to authenticated using (true);

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
  created_at       timestamptz not null default now()
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
create policy "Users can delete own bookmarks"
  on public.wishlist for delete to authenticated
  using (user_name = public.current_profile_name());

-- =============================================
-- HUNGRY PICKS
-- =============================================
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

-- =============================================
-- POST VIEWS / SEEN POSTS
-- =============================================
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
