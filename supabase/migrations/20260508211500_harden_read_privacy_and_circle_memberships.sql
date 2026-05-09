-- Production safety patch:
-- 1. Add the missing circle_memberships table without dropping data.
-- 2. Replace open SELECT policies with visibility-aware read policies.
-- 3. Prevent comments/likes/wishlist from leaking private review engagement.
--
-- Safe to run more than once. Do not run supabase/schema.sql against a live DB;
-- that file contains destructive DROP TABLE statements.

-- Optional suppression columns used by the RLS helper. They are nullable and
-- default to active behavior, so adding them does not hide existing reviews.
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

create index if not exists reviews_visible_feed_idx
  on public.reviews(visibility, created_at desc)
  where deleted_at is null
    and hidden_at is null
    and reported_at is null
    and status = 'active';

create index if not exists reviews_suppression_idx
  on public.reviews(deleted_at, hidden_at, reported_at, status);

-- Ensure circle_requests exists because both app fallback behavior and the
-- visibility helper below depend on accepted request rows.
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

create index if not exists circle_requests_sender_idx
  on public.circle_requests(sender_name);
create index if not exists circle_requests_receiver_idx
  on public.circle_requests(receiver_name);
create index if not exists circle_requests_status_pair_idx
  on public.circle_requests(status, sender_name, receiver_name);

alter table public.circle_requests enable row level security;

drop policy if exists "Circle requests readable by everyone" on public.circle_requests;
drop policy if exists "Anyone can send circle request" on public.circle_requests;
drop policy if exists "Anyone can respond to circle request" on public.circle_requests;
drop policy if exists "Anyone can delete circle request" on public.circle_requests;
drop policy if exists "Users can read own circle requests" on public.circle_requests;

create policy "Users can read own circle requests"
  on public.circle_requests for select to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (
          sender_name = trim(p.first_name || ' ' || p.last_name)
          or receiver_name = trim(p.first_name || ' ' || p.last_name)
          or sender_name = p.username
          or receiver_name = p.username
        )
    )
  );

-- Directed Circle edges. If A adds B, store (B, A): A is inside B's Circle.
-- Private-account accepts are represented by both directions.
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

-- Server routes mutate this table with the service-role client. Authenticated
-- clients may read membership state, but there are intentionally no client
-- INSERT/UPDATE/DELETE policies.
create policy "Circle memberships readable by authenticated users"
  on public.circle_memberships for select to authenticated
  using (true);

-- Preserve existing fallback data from accepted circle_requests when the real
-- edge table was previously missing.
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

create or replace function public.current_profile_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select trim(p.first_name || ' ' || p.last_name)
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
              or exists (
                select 1
                from public.circle_requests cr
                where cr.status = 'accepted'
                  and (
                    (cr.sender_name = review_owner_name and cr.receiver_name = v.name)
                    or (cr.sender_name = v.name and cr.receiver_name = review_owner_name)
                  )
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

grant execute on function public.current_profile_name() to anon, authenticated;
grant execute on function public.review_is_unsuppressed(timestamptz, timestamptz, timestamptz, text) to anon, authenticated;
grant execute on function public.can_read_review_row(text, text, timestamptz, timestamptz, timestamptz, text) to anon, authenticated;
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

-- Engagement tables inherit visibility from their parent review.
alter table public.comments enable row level security;

drop policy if exists "Comments readable by everyone" on public.comments;
drop policy if exists "Comments readable by visible review" on public.comments;

create policy "Comments readable by visible review"
  on public.comments for select to anon, authenticated
  using (public.can_read_review_id(post_id));

drop policy if exists "Authenticated users can insert own comments" on public.comments;

create policy "Authenticated users can insert own comments"
  on public.comments for insert to authenticated
  with check (
    user_name = public.current_profile_name()
    and public.can_read_review_id(post_id)
  );

alter table public.likes enable row level security;

drop policy if exists "Likes readable by everyone" on public.likes;
drop policy if exists "Likes readable by visible review" on public.likes;

create policy "Likes readable by visible review"
  on public.likes for select to anon, authenticated
  using (public.can_read_review_id(post_id));

drop policy if exists "Authenticated users can insert own likes" on public.likes;

create policy "Authenticated users can insert own likes"
  on public.likes for insert to authenticated
  with check (
    user_name = public.current_profile_name()
    and public.can_read_review_id(post_id)
  );

alter table public.wishlist enable row level security;

drop policy if exists "Wishlist readable by everyone" on public.wishlist;
drop policy if exists "Wishlist readable by owner" on public.wishlist;

create policy "Wishlist readable by owner"
  on public.wishlist for select to authenticated
  using (user_name = public.current_profile_name());

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
