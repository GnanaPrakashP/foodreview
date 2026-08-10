# Caching, Pagination, and Feed Smoothness Report

## Goal

Make Witoh feel seamless: fast first paint, stable back navigation, no surprising feed reshuffles, no duplicate posts, and predictable pagination across Circle, Explore, Hungry, profile, restaurant, and notification surfaces.

## Current Architecture

### Browser API cache

File: `lib/browser-api-cache.ts`

- Stores JSON responses by URL in memory and `sessionStorage`.
- Deduplicates simultaneous requests through `pendingRequests`.
- Supports TTLs per caller.
- Supports reload bypass with `bypassOnReload` and explicit `forceRefresh`.
- Invalidates route families such as `/api/feed/circle`, `/api/feed/public`, `/api/me`, `/api/people`, `/api/notifications`.

Recommended use:

- First page data: cache for short TTL.
- Pagination pages: fetch fresh with `cache: "no-store"`.
- Mutation success: invalidate the affected route prefixes.

### Browser feed snapshots

File: `lib/browser-feed-state.ts`

- Memory-only snapshots, not `localStorage`.
- Used to restore long feeds during SPA back navigation.
- Lost on hard reload, which prevents stale feed restoration after a real refresh.
- Can remove a deleted post from persisted in-memory snapshots.

Current TTL pattern:

- Circle, Explore, Hungry, Me: 30 minutes.
- Snapshot size usually capped at 120 posts.

This is good for smoothness because back navigation feels instant, while hard reloads still get fresh server data.

### Server private cache

File: `lib/private-cache.ts`

- Global in-process `Map`.
- TTL-based.
- Deduplicates pending loads.
- Tag invalidation is used by Circle, Me, and People page data.

Important limitation:

- This is per server process only. It does not survive deploys/restarts and does not synchronize across multiple server instances.

### Seen-post storage

File: `lib/browser-post-views.ts`

- Stores seen post IDs per viewer in `localStorage`.
- Retains up to 700 posts.
- TTL is 30 days.
- Used by Circle and Explore feed logic.

Important limitation:

- Seen state is browser-local only. The same user on another browser/device will not share seen history.

## Pagination Model

The app generally uses stable keyset pagination:

```ts
created_at < cursor.createdAt
or created_at === cursor.createdAt and id < cursor.id
```

The server sorts by:

```ts
created_at desc, id desc
```

This is the right direction. It avoids offset drift and keeps pagination stable when new posts arrive above the current page.

Cursor routes:

- `/api/feed/circle`
- `/api/feed/public`
- `/api/me`
- `/api/users/[targetUserId]/reviews`
- Restaurant and place detail pages reuse `/api/feed/public` or user reviews pagination.

Rule to preserve:

- Cache first pages.
- Do not cache cursor pages in the browser.
- Do not restore stale cursors from snapshots unless the page has explicitly persisted a safe cursor model.

## Circle Feed

Main files:

- `app/CirclePageClient.tsx`
- `components/circle/CircleFeedClient.tsx`
- `app/api/feed/circle/route.ts`
- `lib/circle-feed.ts`
- `lib/feed-ranking.ts`
- `lib/browser-post-views.ts`

### First load

- Normal SPA load tries `/api/feed/circle` cache for 3 minutes.
- Document reload bypasses stored browser cache and calls:

```txt
/api/feed/circle?limit=40&refresh=1
```

- Server bypasses private cache only for refresh mode on the first page.
- Cursor pages still use normal server cache behavior.

This is why after a server restart the top posts can be the same: the feed algorithm is deterministic from current data, not random. That is good. Randomized ordering would make the product feel unstable.

### Server ranking

Circle feed candidate posts come from joined circle members, visibility-filtered, then ranked by:

- Freshness decay over 72 hours.
- Likes.
- Comments.
- Average rating.
- Created time tie-breaker.

File: `lib/feed-ranking.ts`

### Client stability

The Circle page now avoids re-ranking posts while the user is looking at them. It uses the server order as the display order. This prevents the old behavior where posts could move around after local seen state loaded.

SPA navigation can restore the exact visible list using `readFeedState`, but pagination cursor is intentionally not restored from that snapshot. This is good because cursors need to match the server-provided page boundary.

### Seen/unseen algorithm

Current Circle behavior:

1. Read the viewer's seen map from `localStorage`.
2. Render Circle posts in server order.
3. A post becomes seen when at least 35% of its card is visible in the viewport.
4. Seen IDs are written through `markPostsSeen`.
5. The client tracks unseen count for the current loaded Circle posts.
6. If Circle mode is exhausted, there are no unseen loaded Circle posts, and the client has not already attempted fallback, it requests public fallback posts.
7. Public fallback request excludes:
   - locally seen post IDs
   - currently rendered post IDs
8. Public fallback uses `/api/feed/public?excludeSeen=...&excludeSynthetic=1`.

This matches the product goal: show Circle content first, then show nearby/trusted public posts only after the user is caught up.

### Public fallback

Current logic:

- Triggered automatically only when:
  - mounted,
  - not preserving a restored SPA snapshot,
  - feed mode is still Circle,
  - Circle has no `hasMore`,
  - current loaded posts are all seen,
  - fallback has not already been attempted.

This prevents the reload storm that previously caused many cursor calls on every reload.

### Circle risks

- Seen state is local-only, so cross-device catch-up will not work.
- `/api/feed/public` falls back to base filtered rows if all exclude-seen rows are exhausted. That prevents empty feeds, but it can reintroduce seen posts when truly caught up.
- Server private cache is process-local. Multi-instance deploys need Redis or database-backed cache if strict consistency matters.

### Circle recommendations

- Keep current deterministic top order.
- Do not randomize Circle feed order.
- Add optional server-side `post_views` later for cross-device seen sync.
- Add a background prefetch for the next Circle page only after the user scrolls near the bottom, not immediately on page load.
- Keep public fallback explicit with a divider, so users understand why posts outside Circle appear.

## Explore Page

Main files:

- `app/people/PeoplePageClient.tsx`
- `components/people/PeopleTab.tsx`
- `app/api/people/route.ts`
- `lib/people-page-data.ts`
- `app/api/feed/public/route.ts`

### Current tabs

Visible tabs are:

```txt
Places | Dishes | People
```

The old Posts tab is hidden from the visible UI, but public feed loading still exists because Places and Dishes are derived from public review data.

### Caching

- `/api/people` is browser-cached for 5 minutes.
- Server-side people suggestions are cached for 5 minutes by viewer and limit.
- Explore public feed first page is browser-cached for 2 minutes.
- Explore feed snapshots are memory-only for 30 minutes.
- Location is stored in `localStorage` and a cookie.

### Pagination

- Public feed uses `/api/feed/public`.
- First page can use cache.
- Cursor pages are fetched with `cache: "no-store"`.
- Dedupe is done by post ID when appending.

### Seen/unseen

Explore still has seen/unseen ranking utilities:

- Posts are marked seen at 35% visibility.
- On fresh load, seen posts can be ranked below unseen posts.
- On SPA back navigation, restored feed order is preserved.
- On refresh, the first request can exclude up to 80 recent seen post IDs.
- There is a guard of 8 extra unseen page loads.

Since Posts is no longer visible, this logic is mostly legacy/supporting infrastructure. If Places and Dishes no longer need post-card rendering, we can simplify later.

### Explore recommendations

- Keep `/api/feed/public` as the single source for Places/Dishes data.
- Consider renaming internal `posts` tab code to `feedData` or `publicReviews` to reduce confusion.
- If Explore no longer shows a post feed at all, remove the IntersectionObserver auto-pagination tied to `activeTab === "posts"` after confirming no hidden flow depends on it.

## Hungry Page

Main files:

- `components/mylist/HungryPageClient.tsx`
- `components/mylist/SwipeStack.tsx`
- `components/mylist/MustTryChecklist.tsx`
- `app/api/hungry/must-try/route.ts`
- `app/api/feed/public/route.ts`

### Pick Now

- Uses `/api/feed/public`.
- Page size is 40.
- First page cache TTL is 2 minutes.
- Feed snapshot TTL is 30 minutes.
- Reload bypasses stale browser cache.
- Cursor pages are fetched fresh with `cache: "no-store"`.
- Swipe stack asks for more when the stack drops to 3 cards.
- Stack keeps a local `seenIds` set so swiped-away posts do not re-enter the stack.

This is tuned well for a no-lag swiping experience.

### Must Try

- Uses `/api/hungry/must-try`.
- Cache TTL is 2 minutes.
- Loads only when the tab is active and a location exists.
- Optimistic updates are used for:
  - mark tried,
  - undo tried,
  - save/unsave.
- Cached items are updated after optimistic local changes.

Must Try ranking uses:

- Circle reviewers.
- Total reviewers.
- Likes.
- Saves.
- Positive feedback.
- Freshness.
- Distance.
- Tried penalty.

### Hungry recommendations

- Prefetch Must Try after the user lands on Hungry and a location exists, but only when the browser is idle.
- Keep Pick Now and Must Try caches separate because they solve different moments.
- Consider excluding locally swiped Pick Now posts from the next public feed request if users report repeats after many swipes.

## Me Page

Main files:

- `app/me/MePageClient.tsx`
- `components/me/MeClient.tsx`
- `app/api/me/route.ts`
- `lib/me-page-data.ts`

### Caching

- `/api/me` browser cache TTL is 3 minutes.
- Server cache TTL is 5 minutes for first page.
- Me feed snapshot TTL is 30 minutes.
- Loading page can render stale cached `/api/me` while the route resolves.

### Pagination

- Reviews page size is 24.
- First page includes stats, public best reviews, circle members, engagement maps, taste trust, and reputation.
- Cursor pages bypass server private cache and skip stats/public-best work.
- Append dedupes by review ID.

### Recommendations

- This is a good split: first page has rich profile data; cursor pages are lighter.
- Consider making `/api/me` reload behavior match Circle/Explore by using the shared `isInitialDocumentReload` helper instead of local `isDocumentReload` copies.

## Public Profile Page

Main files:

- `app/people/[username]/page.tsx`
- `components/people/FriendProfileClient.tsx`
- `app/api/users/[targetUserId]/reviews/route.ts`
- `lib/profile-reviews.ts`

### Caching

- SSR page is force dynamic.
- Relationship data is rendered from server when available, then refreshed silently on client.
- No browser feed snapshot is currently used for profile pages.

### Pagination

- Profile reviews page size is 24.
- Cursor route is `/api/users/[targetUserId]/reviews`.
- Cursor pages include engagement maps and wishlist state.
- Append dedupes by review ID.

### Recommendations

- Add a short browser snapshot for profile place lists if profile back navigation feels slow.
- Do not cache profile visibility aggressively because circle access can change.

## Restaurant and Place Pages

Main files:

- `app/trending/[restaurant]/page.tsx`
- `app/restaurants/[placeId]/page.tsx`
- `components/trending/RestaurantPostsClient.tsx`
- `app/people/[username]/[restaurant]/page.tsx`
- `components/people/RestaurantDetailClient.tsx`

### Caching

- Pages are force dynamic.
- First page data is loaded server-side.
- Circle status is browser-cached for 5 minutes.
- No dedicated browser snapshot for restaurant pages.

### Pagination

- Public restaurant/place pages use `/api/feed/public` with `restaurantName` or `placeId`.
- Profile restaurant pages use `/api/users/[targetUserId]/reviews?restaurantName=...`.
- Page size is generally 24.
- Append dedupes by post ID.

### Recommendations

- These pages are fine with manual Load more.
- If users frequently return from a review detail to a restaurant page, add memory-only snapshots for visible posts and active tab.

## Notifications

Main files:

- `components/reviews/NotificationBell.tsx`
- `components/reviews/NotificationsClient.tsx`
- `app/api/notifications/*`

### Caching

- Unread count TTL is 15 seconds.
- Bell refreshes every 45 seconds.
- Notifications list TTL is 60 seconds.
- Notifications page renders cached data immediately, then refreshes.
- Mark-read and mark-all-read optimistically update local cache and invalidate unread count.

### Recommendations

- Current behavior is good for perceived speed.
- If notifications become realtime-critical, add Supabase realtime or polling only while app is focused.

## Mutation Invalidation Map

Current useful invalidations:

- New review: invalidate `/api/feed/circle` and `/api/feed/public`.
- Circle request/accept/remove: invalidate `/api/feed/circle`, `/api/people`, and circle status caches.
- Delete post: remove post from feed snapshots and invalidate `/api/me`, `/api/feed/circle`, `/api/feed/public`, `/api/people`.
- Notifications mark-read: invalidate `/api/notifications/unread-count`.

Recommended additions:

- Must Try mark tried should invalidate or update `/api/hungry/must-try` for the active location. It currently updates the cached items optimistically, which is enough for the active tab.
- Wishlist save/unsave should continue updating local card state; route-wide invalidation is only needed when navigating to saved-list pages.

## Seamless Experience Checklist

Keep:

- First page cached.
- Cursor pages fresh.
- Memory-only feed snapshots for back navigation.
- Skeletons that match the final layout.
- Optimistic mutations.
- Deterministic Circle ordering.
- Seen-state marking based on real viewport exposure.

Avoid:

- Auto-loading many cursor pages on reload.
- Re-ranking visible feed cards while the user is reading.
- Restoring stale cursors from navigation snapshots.
- Random feed order on every refresh.
- Full route refreshes after every small action unless visibility/access changed.

Add next:

1. Next-page prefetch only near bottom or near end of swipe stack.
2. Server-side seen sync for Circle if cross-device continuity matters.
3. Shared reload/navigation helper usage everywhere.
4. Optional memory snapshots for restaurant/profile detail pages.
5. Lightweight performance logging for first page time, pagination time, and duplicate filtered count.

## Final Recommended Circle Feed Algorithm

1. Load first Circle page from server with deterministic ranking.
2. On hard reload, bypass browser cache and request a larger first page.
3. On SPA return, restore exact in-memory snapshot and visual order.
4. Mark a post seen only after 35% viewport visibility.
5. Persist seen state per viewer for 30 days and max 700 posts.
6. Do not reorder the currently visible Circle list after seen state updates.
7. When Circle has no more pages and all loaded Circle posts are seen, request public fallback.
8. Public fallback excludes seen and currently displayed posts.
9. Show a divider before public fallback posts.
10. Continue paginating public fallback normally after fallback mode starts.

This gives the user the feeling that Circle is stable and personal, while still avoiding a dead end after they are caught up.
