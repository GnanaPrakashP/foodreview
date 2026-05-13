-- Migration: Switch primary identity from full name to username
-- Run BEFORE deploying the matching code changes.
-- Safe to run on a fresh DB (all UPDATEs will be no-ops on empty tables).

-- ── 1. current_profile_name() ──────────────────────────────────────────────
-- Used by RLS policies on reviews. Now returns username instead of full name.
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

-- ── 2. Migrate data: replace full names with usernames in all tables ────────

UPDATE reviews r
SET reviewer_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(r.reviewer_name))
  AND p.username IS NOT NULL AND p.username <> '';

UPDATE circle_memberships cm
SET user_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(cm.user_name))
  AND p.username IS NOT NULL AND p.username <> '';

UPDATE circle_memberships cm
SET member_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(cm.member_name))
  AND p.username IS NOT NULL AND p.username <> '';

UPDATE circle_requests cr
SET sender_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(cr.sender_name))
  AND p.username IS NOT NULL AND p.username <> '';

UPDATE circle_requests cr
SET receiver_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(cr.receiver_name))
  AND p.username IS NOT NULL AND p.username <> '';

UPDATE likes l
SET user_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(l.user_name))
  AND p.username IS NOT NULL AND p.username <> '';

UPDATE comments c
SET user_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(c.user_name))
  AND p.username IS NOT NULL AND p.username <> '';

UPDATE wishlist w
SET user_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(w.user_name))
  AND p.username IS NOT NULL AND p.username <> '';

UPDATE notifications n
SET recipient_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(n.recipient_name))
  AND p.username IS NOT NULL AND p.username <> '';

UPDATE notifications n
SET actor_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(n.actor_name))
  AND p.username IS NOT NULL AND p.username <> '';

-- ── 3. Update RLS policies to use username ──────────────────────────────────

-- reviews
drop policy if exists "Authenticated users can insert own reviews" on public.reviews;
create policy "Authenticated users can insert own reviews"
  on public.reviews for insert to authenticated
  with check (
    reviewer_name = (select p.username from public.profiles p where p.id = auth.uid())
  );

drop policy if exists "Users can update own reviews" on public.reviews;
create policy "Users can update own reviews"
  on public.reviews for update to authenticated
  using  (reviewer_name = (select p.username from public.profiles p where p.id = auth.uid()))
  with check (reviewer_name = (select p.username from public.profiles p where p.id = auth.uid()));

drop policy if exists "Users can delete own reviews" on public.reviews;
create policy "Users can delete own reviews"
  on public.reviews for delete to authenticated
  using (
    reviewer_name = (select p.username from public.profiles p where p.id = auth.uid())
  );

-- likes
drop policy if exists "Authenticated users can insert own likes" on public.likes;
create policy "Authenticated users can insert own likes"
  on public.likes for insert to authenticated
  with check (
    user_name = (select p.username from public.profiles p where p.id = auth.uid())
    and public.can_read_review_id(post_id)
  );

drop policy if exists "Users can delete own likes" on public.likes;
create policy "Users can delete own likes"
  on public.likes for delete to authenticated
  using (
    user_name = (select p.username from public.profiles p where p.id = auth.uid())
  );

-- comments
drop policy if exists "Authenticated users can insert own comments" on public.comments;
create policy "Authenticated users can insert own comments"
  on public.comments for insert to authenticated
  with check (
    user_name = (select p.username from public.profiles p where p.id = auth.uid())
    and public.can_read_review_id(post_id)
  );

drop policy if exists "Users can delete own comments" on public.comments;
create policy "Users can delete own comments"
  on public.comments for delete to authenticated
  using (
    user_name = (select p.username from public.profiles p where p.id = auth.uid())
  );

-- notifications
drop policy if exists "Notifications readable by recipient" on public.notifications;
create policy "Notifications readable by recipient"
  on public.notifications for select to authenticated
  using (
    recipient_user_id = auth.uid()
    or recipient_name = (select p.username from public.profiles p where p.id = auth.uid())
  );

drop policy if exists "Users can mark own notifications read" on public.notifications;
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

-- circle_requests
drop policy if exists "Users can read own circle requests" on public.circle_requests;
create policy "Users can read own circle requests"
  on public.circle_requests for select to authenticated
  using (
    sender_name   = (select p.username from public.profiles p where p.id = auth.uid())
    or receiver_name = (select p.username from public.profiles p where p.id = auth.uid())
  );

-- wishlist
drop policy if exists "Wishlist readable by owner" on public.wishlist;
create policy "Wishlist readable by owner"
  on public.wishlist for select to authenticated
  using (
    user_name = (select p.username from public.profiles p where p.id = auth.uid())
  );

drop policy if exists "Authenticated users can bookmark" on public.wishlist;
create policy "Authenticated users can bookmark"
  on public.wishlist for insert to authenticated
  with check (
    user_name = (select p.username from public.profiles p where p.id = auth.uid())
    and (post_id is null or public.can_read_review_id(post_id))
  );

drop policy if exists "Users can delete own bookmarks" on public.wishlist;
create policy "Users can delete own bookmarks"
  on public.wishlist for delete to authenticated
  using (
    user_name = (select p.username from public.profiles p where p.id = auth.uid())
  );
