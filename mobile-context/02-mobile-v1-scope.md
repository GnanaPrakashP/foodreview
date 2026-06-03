# Mobile V1 Scope

This is the practical v1 target for a new React Native + Expo app. Do not try to rebuild every web route.

## Must Have

### Auth And Onboarding

- Supabase Auth sign in/sign up.
- Create/read `profiles` row with `first_name`, `last_name`, `username`, `account_type`.
- Username format must match schema: lowercase letters, numbers, underscore, 3-20 chars.
- Persist session using Expo-compatible secure storage.
- After auth, load the actor profile and use `profiles.username` as the app identity.

### Circle Feed

- Feed of visible `public` and `circle` posts from users whose Circle the viewer has joined.
- Pull to refresh.
- Cursor pagination by `created_at` and `id`.
- Media carousel for `review_photos`.
- Display dish ratings, tags, body, restaurant, area, author display name, like/comment/save state.
- Like, comment, save, and open detail.
- Record seen posts through `post_views` or a server route equivalent.

### Public Explore

- Location picker: current GPS plus manual Google Places area search.
- Restaurants tab from public review data.
- Dishes tab from public review data.
- People search/list.
- Category chips matching `lib/explore-categories.ts`.
- Restaurant cards should show name, area, reviewers, top dishes, average rating, photo, distance when location is available.
- Dish cards should show dish name, best/top restaurant, mention count, average rating, photo.

### Create Review

- Camera/gallery media selection through Expo.
- Max 4 media items.
- At least 1 media item required.
- Images: crop to 4:5 if practical, compress before upload.
- Videos: max 10 seconds.
- Upload to Supabase Storage `review-photos` quarantine prefix.
- Call existing moderation route or mobile backend equivalent before public storage.
- Restaurant must be selected from Google Places autocomplete/details.
- At least 1 dish required; every dish requires a 1-5 rating.
- Optional body must be empty or at least 5 chars.
- Tags max 5, tag length max 28.
- Visibility selector: `public`, `circle`, `me`.
- After successful create: invalidate feed/profile query caches and navigate to the post detail.

### Profile

- Current user profile screen from `/api/me` behavior:
  - Display name, username, bio.
  - Stats: total visits, unique places, unique dishes.
  - Reviews timeline with pagination.
  - Reputation tier, badges, progress.
  - Taste Trust summary.
- Public/friend profile:
  - Respect visibility.
  - Show hidden Circle prompt/count when the viewer lacks access.
  - Circle relationship status and request/remove actions.
  - Common restaurants count.

### Restaurant And Dish Pages

- Restaurant detail by `restaurant_id`/Google place ID:
  - Header with restaurant name, area/address, maps link.
  - Public posts for that place.
  - Total posts, average rating, visits this week.
  - Pagination through public feed filtered by `placeId`.
- Dish detail:
  - Top restaurants for a dish.
  - Nearby filtering when location is available.
  - Rank by mentions, average rating, reviewer count, recency.

### Social Actions

- Likes: insert/delete in `likes`.
- Comments: insert/delete in `comments`; max 500 chars.
- Wishlist/saved: insert/delete in `wishlist`.
- Hungry picks: insert/delete in `hungry_picks`.
- Circle request, cancel, accept, reject, remove.
- Notifications list, unread count, mark read/read-all.

## Should Have

- Native share for post links/images.
- Push notifications once server support exists.
- Deep links for `/reviews/:id`, `/people/:username`, `/restaurants/:placeId`, `/dishes/:dish`.
- Optimistic updates for like/save/comment.
- Lightweight offline cache for feed/profile last successful data.

## Defer From V1

- Stories (`stories` table and `/stories/new`).
- Shared memory rooms.
- Manual QA pages.
- Full account deletion flow, unless required for store compliance.
- Advanced Taste Trust feedback UI, unless already needed for reputation goals.
- Video editing beyond duration validation/compression.
- Web-only browser navigation state helpers.

## V1 Non-Negotiables

- Do not write client-supplied `reviewer_name`; always derive it from authenticated profile.
- Do not expose service-role Supabase keys in mobile.
- Do not call Google Places directly from the app with unrestricted server keys.
- Do not bypass media moderation for production.
- Do not display `circle` or `me` posts unless the viewer has access.
- Do not build a WebView wrapper of the existing Next.js app.
