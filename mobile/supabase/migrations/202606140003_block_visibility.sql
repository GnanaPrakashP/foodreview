-- Bidirectional block enforcement at the database level.
--
-- The Settings block list only lets a user filter people *they* blocked. This
-- migration enforces blocks in BOTH directions inside the database so it can't
-- be bypassed by any client: a viewer never sees content from anyone they've
-- blocked, AND anyone who has blocked the viewer never sees the viewer's
-- content or can interact with it.
--
-- Implemented with RESTRICTIVE policies, which AND with the existing permissive
-- read policies (rather than replacing them). Scoped to the authenticated role —
-- anon has no profile name, so a block relationship can never match.
--
-- Run after 202606140002_settings_account_management.sql (needs blocked_users).

-- True when the current user and p_other_name have a block in either direction.
-- SECURITY DEFINER so it can read blocked_users rows the caller can't (RLS only
-- exposes a user's own block rows). Returns false for null/unknown names.
create or replace function public.is_blocked_with(p_other_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.blocked_users b
    where (b.blocker_name = public.current_profile_name() and b.blocked_name = p_other_name)
       or (b.blocked_name = public.current_profile_name() and b.blocker_name = p_other_name)
  );
$$;

grant execute on function public.is_blocked_with(text) to authenticated, anon, service_role;

-- True when there is no block between the current user and the author of the
-- given post. Reads reviews directly (definer) so it isn't itself filtered by
-- the restrictive review policy below. Returns true when the post is unknown.
create or replace function public.not_blocked_from_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.reviews r
    join public.blocked_users b
      on (b.blocker_name = public.current_profile_name() and b.blocked_name = r.reviewer_name)
      or (b.blocked_name = public.current_profile_name() and b.blocker_name = r.reviewer_name)
    where r.id = p_post_id
  );
$$;

grant execute on function public.not_blocked_from_post(uuid) to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Read side: hide content authored by anyone in a block relationship.
-- ---------------------------------------------------------------------------
drop policy if exists "Hide blocked users' reviews" on public.reviews;
create policy "Hide blocked users' reviews"
  on public.reviews as restrictive for select to authenticated
  using (not public.is_blocked_with(reviewer_name));

drop policy if exists "Hide blocked users' comments" on public.comments;
create policy "Hide blocked users' comments"
  on public.comments as restrictive for select to authenticated
  using (not public.is_blocked_with(user_name));

drop policy if exists "Hide blocked users' likes" on public.likes;
create policy "Hide blocked users' likes"
  on public.likes as restrictive for select to authenticated
  using (not public.is_blocked_with(user_name));

-- ---------------------------------------------------------------------------
-- Write side: a blocked user can't like or comment on the blocker's posts.
-- ---------------------------------------------------------------------------
drop policy if exists "Block prevents liking" on public.likes;
create policy "Block prevents liking"
  on public.likes as restrictive for insert to authenticated
  with check (public.not_blocked_from_post(post_id));

drop policy if exists "Block prevents commenting" on public.comments;
create policy "Block prevents commenting"
  on public.comments as restrictive for insert to authenticated
  with check (public.not_blocked_from_post(post_id));
