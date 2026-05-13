-- Migration: Switch primary identity from full name to username
-- Run this in your Supabase SQL Editor BEFORE deploying the updated code.
-- After this runs, all name columns in the DB will contain usernames instead of full names.

-- 1. reviews.reviewer_name
UPDATE reviews r
SET reviewer_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(r.reviewer_name))
  AND p.username IS NOT NULL
  AND p.username <> '';

-- 2. circle_memberships.user_name
UPDATE circle_memberships cm
SET user_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(cm.user_name))
  AND p.username IS NOT NULL
  AND p.username <> '';

-- 3. circle_memberships.member_name
UPDATE circle_memberships cm
SET member_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(cm.member_name))
  AND p.username IS NOT NULL
  AND p.username <> '';

-- 4. circle_requests.sender_name
UPDATE circle_requests cr
SET sender_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(cr.sender_name))
  AND p.username IS NOT NULL
  AND p.username <> '';

-- 5. circle_requests.receiver_name
UPDATE circle_requests cr
SET receiver_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(cr.receiver_name))
  AND p.username IS NOT NULL
  AND p.username <> '';

-- 6. likes.user_name
UPDATE likes l
SET user_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(l.user_name))
  AND p.username IS NOT NULL
  AND p.username <> '';

-- 7. comments.user_name
UPDATE comments c
SET user_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(c.user_name))
  AND p.username IS NOT NULL
  AND p.username <> '';

-- 8. wishlist.user_name (if this table exists in your schema)
UPDATE wishlist w
SET user_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(w.user_name))
  AND p.username IS NOT NULL
  AND p.username <> '';

-- 9. notifications.recipient_name
UPDATE notifications n
SET recipient_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(n.recipient_name))
  AND p.username IS NOT NULL
  AND p.username <> '';

-- 10. notifications.actor_name
UPDATE notifications n
SET actor_name = p.username
FROM profiles p
WHERE LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(n.actor_name))
  AND p.username IS NOT NULL
  AND p.username <> '';

-- Verify: rows that couldn't be migrated (no matching profile username)
-- Run these SELECTs after the UPDATE to see any unmatched rows:
-- SELECT reviewer_name FROM reviews WHERE reviewer_name NOT IN (SELECT username FROM profiles WHERE username IS NOT NULL);
-- SELECT user_name FROM circle_memberships WHERE user_name NOT IN (SELECT username FROM profiles WHERE username IS NOT NULL);
-- SELECT member_name FROM circle_memberships WHERE member_name NOT IN (SELECT username FROM profiles WHERE username IS NOT NULL);
-- SELECT sender_name FROM circle_requests WHERE sender_name NOT IN (SELECT username FROM profiles WHERE username IS NOT NULL);
-- SELECT receiver_name FROM circle_requests WHERE receiver_name NOT IN (SELECT username FROM profiles WHERE username IS NOT NULL);
