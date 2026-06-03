# Supabase Schema Notes

Canonical source: `supabase/schema.sql`. Migrations in `supabase/migrations/*` show recent additions.

## Identity

### `profiles`

One row per Supabase Auth user.

Important columns:

- `id uuid`: primary key, references `auth.users(id)`.
- `first_name text`
- `last_name text`
- `username text`: unique, format `^[a-z0-9_]{3,20}$`.
- `avatar_url text`
- `bio text`
- `account_type text`: `public` or `private`.
- Taste Trust fields:
  - `trust_score`
  - `trust_level`
  - `confirmed_recommendations_count`
  - `positive_confirmations_count`
  - `negative_confirmations_count`
  - `total_feedback_points`

RLS:

- Authenticated users can read profiles.
- Users can insert/update only their own row.
- Trust fields are revoked from authenticated update.

Mobile rule:

- Always load `profiles.username` after auth and use it as actor name.

## Reviews

### `reviews`

Main post table.

Important columns:

- `id uuid`
- `reviewer_name text`
- `restaurant_id text`: Google Places place ID when available.
- `restaurant_name text`
- `area text`
- `restaurant_address text`
- `restaurant_lat double precision`
- `restaurant_lng double precision`
- `items jsonb`: array of `{ name, rating }`.
- `body text`
- `tags text[]`
- `photo_url text`: legacy primary media URL.
- `photo_urls text[]`: legacy URL list.
- `visibility text`: `public`, `circle`, `me`.
- moderation/suppression:
  - `deleted_at`
  - `hidden_at`
  - `reported_at`
  - `status`: `active`, `deleted`, `hidden`, `reported`, `removed`.
- `created_at`

Indexes support:

- recent feed: `created_at desc`.
- restaurant lookup: `restaurant_id`, `restaurant_name`.
- profile lookup: `reviewer_name`.
- visibility/status filtering.
- location bounds.
- tags GIN.

RLS:

- Select uses `can_read_review_row`.
- Public active reviews are readable.
- Owner can read own posts.
- Circle posts are readable when the viewer is in the owner's Circle.
- `me` posts are only visible to owner.
- Insert/update/delete requires `reviewer_name = current_profile_name()`.

### `review_photos`

Normalized media rows. Name is legacy; supports images and videos.

Columns:

- `review_id uuid`
- `storage_path text`
- `public_url text`
- `media_type`: `image` or `video`
- `width`
- `height`
- `size_bytes`
- `position`

RLS:

- Select only if viewer can read parent review.

## Storage

### Bucket `review-photos`

Public bucket with max file size 50 MB and allowed MIME:

- `image/jpeg`
- `image/png`
- `image/webp`
- `image/gif`
- `video/mp4`
- `video/webm`
- `video/quicktime`

Prefixes:

- `quarantine/*`: temporary uploads from authenticated users.
- `public/*`: moderated/accepted media.

Mobile rule:

- Never put unmoderated media in a final review.
- Upload to quarantine, call moderation, then use returned public path.

## Circle

### `circle_requests`

Columns:

- `sender_name`
- `receiver_name`
- `status`: `pending`, `accepted`, `rejected`
- unique sender/receiver pair.

RLS:

- Users can read requests where they are sender or receiver.

### `circle_memberships`

Directed Circle edge.

Columns:

- `user_name`: profile owner.
- `member_name`: viewer/member who can see owner Circle content.

RLS:

- Authenticated users can read memberships.
- Writes are handled by server/admin routes in web code.

Mobile rule:

- Use existing server routes for request/respond/remove actions unless equivalent secure Edge Functions are created.

## Engagement

### `likes`

Columns:

- `post_id`
- `user_name`
- unique `(post_id, user_name)`.

RLS:

- Read if parent review visible.
- Insert own like only if parent review visible.
- Delete own like.

### `comments`

Columns:

- `post_id`
- `user_name`
- `content`, max 500 chars.

RLS:

- Read if parent review visible.
- Insert own comment only if parent review visible.
- Delete own comments.

### `wishlist`

Columns:

- `user_name`
- `restaurant_name`
- `post_id nullable`

Uniqueness:

- `(user_name, post_id)` when `post_id` is not null.
- `(user_name, restaurant_name)` when `post_id` is null.

RLS:

- Owner-only read/delete.
- Insert own bookmark; post bookmark requires visible review.

### `hungry_picks`

Columns:

- `user_name`
- `post_id`
- unique `(user_name, post_id)`.

RLS:

- Owner-only read/delete.
- Insert own pick if post is visible.

### `post_views`

Columns:

- `user_id`
- `post_id`
- `viewed_at`
- primary key `(user_id, post_id)`.

Use:

- Seen-post ranking and feed reconciliation.

RLS:

- Owner-only read/update/delete.
- Insert own view only if post is visible.

## Reputation And Trust

### `user_reputation`

Columns:

- `user_id`
- `profile_score`
- `tier_display_name`
- weekly/monthly streak fields.

RLS:

- Readable by everyone.
- No authenticated self-update policy in schema; server/admin updates.

### `user_badges`

Columns:

- `user_id`
- `badge_id`
- `badge_type`
- `badge_name`
- `badge_description`
- `badge_icon`
- `badge_category`
- `earned_at`
- `metadata`

RLS:

- Readable by everyone.

### `recommendation_feedback`

Used for Taste Trust/recommendation confirmation.

Columns:

- `post_id`
- `reviewer_user_id`
- `feedback_user_id`
- `place_id`
- `dish_id`
- `feedback_label`: `Strongly agree`, `Agree`, `Neutral`, `Disagree`, `Strongly disagree`
- `feedback_value`: `1.0`, `0.7`, `0.3`, `-0.5`, `-1.0`

RLS:

- Feedback owner can read own feedback.
- Insert/update own feedback only on readable public/circle post and not self.

### `user_tried_items`

Tracks when a user tried something based on another post/feedback.

Columns:

- `user_id`
- `place_id`
- `dish_id`
- `source_post_id`
- `source_user_id`
- `feedback_id`
- `tried_status`: currently `tried`
- `visibility`: `private`, `circle`, `public`

## Notifications

### `notifications`

Columns include legacy and new fields:

- `recipient_user_id`
- `actor_user_id`
- `recipient_name`
- `actor_name`
- `type`
- `title`
- `message`
- `entity_type`
- `entity_id`
- `metadata`
- `is_read`
- `post_id`
- `restaurant_name`
- `content`
- `read`
- `deleted_at`

RLS:

- Recipient can read/update own notifications by user id or username.

Mobile rule:

- Treat `is_read` as primary, but support `read` because legacy routes still normalize both.

## Stories

### `stories`

Exists but defer from v1 unless explicitly needed.

Columns:

- `author_name`
- `media_url`
- `storage_path`
- `caption`
- `visibility`: `public`, `circle`
- `expires_at`
- suppression/status fields.

## Views

### `trending_scores`

Aggregates public reviews by restaurant:

- week users.
- month users.
- all-time users.
- recency boost.
- trending score.

### `dish_scores`

Unnests `reviews.items` for public active reviews:

- `restaurant_name`
- `dish_name`
- `avg_score_10`
- `unique_raters`
- `total_logs`

Mobile v1 can query views for simple public discovery, but current web Explore mostly computes richer cards from public feed rows.
