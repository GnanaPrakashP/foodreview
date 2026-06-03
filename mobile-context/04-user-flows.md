# User Flows

## Sign Up And Profile Creation

1. User creates a Supabase Auth account.
2. App validates username client-side and server/RLS-side.
3. App inserts into `profiles`:
   - `id`: auth user id.
   - `first_name`
   - `last_name`
   - `username`
   - optional `avatar_url`, `bio`.
   - `account_type`: default `public`.
4. App treats `profiles.username` as the canonical actor name.
5. App loads main tabs.

Important:

- Current web route identity uses `getRouteActor()` and `current_profile_name()`.
- Mobile must not trust a username typed into mutation payloads.

## Create Review

Source files:

- `components/reviews/ReviewForm.tsx`
- `components/reviews/PhotoUpload.tsx`
- `app/api/reviews/route.ts`
- `lib/server/review-validation.ts`

Flow:

1. User selects media.
2. Client validates:
   - max 4 media.
   - image types: jpeg, png, webp, gif.
   - video types: mp4, webm, quicktime.
   - image max 5 MB in web; mobile can compress to stay under this.
   - video max 50 MB and max 10 seconds.
3. User chooses restaurant from Google Places autocomplete.
4. App fetches Google Place details:
   - `placeId`
   - name
   - formatted address
   - short formatted address/area
   - latitude
   - longitude
5. User adds dish rows:
   - at least one dish.
   - every non-empty dish has rating 1-5.
6. User selects tags:
   - max 5.
   - max 28 chars each.
7. User selects visibility: `public`, `circle`, `me`.
8. Client uploads media to `review-photos/quarantine/*`.
9. Client calls moderation route:
   - photos: `/api/photos/moderate`
   - videos: `/api/videos/moderate`
10. Moderation moves/rewrites media into `review-photos/public/*` and returns public URLs/storage paths.
11. Client calls `/api/reviews` with:
   - `restaurantName`
   - `restaurantId`
   - `restaurantAddress`
   - `restaurantLat`
   - `restaurantLng`
   - `area`
   - `items`
   - `body`
   - `tags`
   - `visibility`
   - `media`
12. Server inserts `reviews` row and `review_photos` rows.
13. Server refreshes reputation foundation.
14. Client triggers notification event for `CIRCLE_POST_CREATED`.
15. Client invalidates feed/profile caches and opens the review detail.

Mobile note:

- Prefer keeping `/api/reviews`, `/api/photos/moderate`, and `/api/videos/moderate` as backend routes. Direct mobile insert is possible under RLS, but would miss admin-side media row fallback, reputation refresh, cache invalidation, and notification fanout.

## Circle Feed

Source files:

- `app/api/feed/circle/route.ts`
- `lib/circle-feed.ts`
- `lib/feed-ranking.ts`
- `lib/visibility.ts`

Flow:

1. App loads authenticated user and profile username.
2. App loads Circle relationships from `circle_memberships`.
3. Feed candidate reviewers are `joinedCircles`.
4. Query `reviews` where:
   - `reviewer_name in joinedCircles`
   - not suppressed: `deleted_at`, `hidden_at`, `reported_at` null, `status = active`
   - ordered by `created_at desc`, `id desc`
5. Filter with Circle visibility:
   - owner's own public/circle posts visible.
   - Circle members' `public` and `circle` posts visible.
   - `me` posts not visible to others.
6. Exclude seen posts using `post_views` and local `excludeSeen` ids.
7. Load engagement maps:
   - likes count and liked-by-me.
   - comments count/top comment.
   - wishlist/saved by me.
   - Taste Trust summary.
   - profile display names.
8. Rank unseen posts first using:
   - freshness decay over 72 hours.
   - `log1p(likes) * 6`.
   - `log1p(comments) * 10`.
   - average item rating * 3.
9. Return paginated list with `nextCursor`.

Mobile note:

- Use TanStack Query/React Query for caching and pagination.
- Keep ranking client-side only if the full candidate page is already loaded; otherwise prefer backend route output.

## Public Feed And Explore

Source files:

- `app/api/feed/public/route.ts`
- `components/people/PeopleTab.tsx`
- `lib/explore-categories.ts`

Flow:

1. Request public reviews with optional:
   - `lat`, `lng`: 30 km nearby bounds.
   - `placeId`: restaurant page.
   - `restaurantName`: legacy restaurant page fallback.
   - `exclude`, `excludeSeen`, `excludeSynthetic`.
   - cursor.
2. Query only public, active, unsuppressed reviews.
3. Fetch extra rows to allow filtering excluded names/posts.
4. Build engagement maps and profile map.
5. Explore derives restaurants/dishes from returned reviews.

Mobile note:

- For Explore v1, request public feed pages near the selected location and compute local groupings.
- If app scale grows, move restaurant/dish aggregation to backend RPC/materialized views.

## Profile Flow

Current user:

1. Load Supabase Auth user.
2. Load `profiles` row.
3. Load `reviews` by own `reviewer_name`, all visibilities.
4. Load relationship data.
5. Compute stats from own reviews:
   - total visits.
   - unique places.
   - unique dishes.
6. Load engagement maps for profile posts.
7. Load public best reviews for comparison/recommendation features.
8. Load reputation and Taste Trust.

Other user:

1. Load profile by `username`.
2. Determine viewer username.
3. Check Circle access in both directions.
4. Load visible reviews through `loadProfileReviewsPage`.
5. Compute hidden Circle post prompt if viewer lacks access.
6. Compute common restaurants from both users' visible reviews.
7. Load relationship request state.
8. Load reputation and Taste Trust.

## Circle Relationship Flow

Tables:

- `circle_requests`
- `circle_memberships`

Directed membership semantics:

- `circle_memberships.user_name` is the profile owner.
- `circle_memberships.member_name` is the member who can see the owner's Circle posts.
- If A adds B to A's Circle, store `(user_name = A, member_name = B)`.
- Mutual Circle is represented by two rows.

Request flow:

1. Sender creates pending `circle_requests`.
2. Receiver accepts or rejects.
3. Accept creates membership rows according to app logic.
4. Remove deletes membership rows.
5. Status can be none, pending, one-way, mutual.

## Like, Comment, Save, Hungry Pick

Like:

1. Check authenticated actor.
2. Check actor can read post.
3. Insert into `likes(post_id, user_name)`.
4. Unique constraint makes duplicate likes safe.
5. Delete by post and actor to unlike.

Comment:

1. Require `postId` and non-empty content.
2. Max 500 chars.
3. Insert `comments(post_id, user_name, content)`.
4. Delete own comments only.

Save/Wishlist:

1. Insert `wishlist(user_name, restaurant_name, post_id)`.
2. For pure place save, `post_id` can be null and uniqueness is by restaurant name.

Hungry Pick:

1. Insert `hungry_picks(user_name, post_id)`.
2. Owner-only read/delete.

## Restaurant Detail Flow

1. Open by Google `placeId`.
2. Query public active reviews where `restaurant_id = placeId`.
3. Load total post count, weekly count, all item rows for average score.
4. Build engagement maps for displayed reviews.
5. Generate Google Maps URL from coordinates when available; otherwise place query.
6. Paginate through `/api/feed/public?placeId=...`.

## Dish Detail Flow

1. Normalize dish name through `lib/dish-normalizer.ts`.
2. Optional nearby bounds from `lat/lng`.
3. First query exact JSONB contains match for `items`.
4. If no exact results, scan recent public reviews and match normalized dish names in code.
5. Group by restaurant.
6. Rank by:
   - mentions.
   - average rating.
   - reviewer count.
   - latest post time.

## Notifications

Notification rows are created by server utilities. Mobile v1 should consume:

- list notifications.
- unread count.
- mark one read.
- mark all read.
- delete/hide notification if supported.

Navigation is derived from notification fields:

- post notifications open review detail.
- circle request notifications open profile/request UI.
- achievement notifications open profile reputation.
