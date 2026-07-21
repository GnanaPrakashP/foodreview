# Mobile runtime architecture

Date: 2026-07-13
Applies to: FoodReview/CircleBites Expo React Native app

## Runtime ownership

`mobile/src/performance/runtimeActivity.ts` is the only native AppState/network listener owner. It translates AppState and Expo Network state into one immutable runtime snapshot, React Query `focusManager`, and React Query `onlineManager`. Screens and providers subscribe through `useRuntimeActivity`; they must not create competing AppState listeners.

The account-session boundary remains outside authenticated navigation. It validates the canonical Supabase user ID, resumes any interrupted local cleanup, validates account status, activates a fresh per-owner QueryClient, restores only the matching owner envelope, and then exposes authenticated screens. A generation change revokes stale async and realtime callbacks before cleanup.

## Startup order

1. Load the native shell and auth session.
2. Resolve the canonical UUID owner and resume incomplete cleanup.
3. Validate account status without falling back to user-supplied identity.
4. Restore the bounded matching-owner query envelope; reject corrupt, wrong-owner, stale, or over-age state.
5. Mount the initial tab only.
6. Render valid cached content.
7. Refresh stale active data in the background when online and focused.
8. Mount Explore, Create, and Profile only on first visit; retain visited screens and freeze them while blurred.

Cold startup must not initialize location, Profile, Memory summaries/realtime, camera, or other inactive-tab work.

## Query and persistence policy

React Query defaults use a two-hour garbage-collection window, bounded retry, focus/online awareness, and per-domain stale times. The persisted envelope is owner-scoped, versioned, capped at 24 hours, mutation-free, and stores only successful bounded data:

- Memory room summaries, first page of 12;
- Circle first page, at most 10 posts;
- Explore places/dishes/people sections, at most 60 each;
- Profile post first page, at most 10 posts;
- unread-notification boolean state.

Only the first infinite-query page is retained. Mutation state and errors are never persisted. Modern Home media metadata survives without signed URLs so cached bytes remain addressable; other expired signed media continues to be removed. Logout, account switch, invalid session, deletion, or owner mismatch first aborts and settles Home prefetch, then clears owner files and Expo Image memory/disk caches. Native cache clearing retries once and leaves the cleanup journal incomplete on repeated failure.

## Rendering and media ownership

Feed lists render 4 items initially, 4 per batch, use a window size of 5, and key by post ID. A 65%/900 ms viewability rule selects one stable active media post. Home images consume the 720×900 feed derivative, with canonical only as a server fallback. A video renders only its poster until explicit Play authorizes playback; visibility alone never creates a remote player. One Home player may exist and it is released offscreen, on tab blur, and in background. Detail screens may still consume canonical media.

On Wi-Fi or Ethernet, only the next two modern Home image covers are prefetched while Home is focused, foregrounded, online, not refreshing/paginating, and not on a detected metered/low-data connection. The abortable download is tied to owner scope and generation, excludes legacy URLs, writes into the owner directory, and is rendered with the same `mediaAssetId:feed` key. Cellular and offline prefetch are disabled. Seen-post writes are batched rather than sent per card.

Post cards are memoized. Like, bookmark, delete, comment, Profile, and notification operations patch the exact cached entity/page with rollback or server correction. Structural changes may still invalidate a narrow domain key. Broad application cache resets are prohibited for ordinary item mutations.

## Pagination and realtime

Circle, public, restaurant, dish, Profile, liked, saved, comments, notifications, Memory messages, and Memory media consume stable cursor pages. Page merge helpers preserve server order and remove duplicate IDs. Active list footers own the single load-more request.

Memory room summaries use 12-room stable timeline pages. The visible Profile Memories tab owns the query and summary subscription; Posts does not start this secondary work. Active-room message/photo deltas patch the relevant paged cache once without changing visit-date order. Realtime callbacks capture the account generation and ignore old-account events. Delta events do not immediately trigger a full room reload; a delayed reconciliation is reserved for unrecognized/non-delta events and foreground recovery.

## Performance evidence

Profile logging exists only in development or an explicit release-profile build. It emits aggregate `CB_PERF` events and never private data. See `docs/performance/MOBILE_PERFORMANCE_BUDGETS.md` and `docs/performance/phase6-android-emulator-profile.json`.

## Known structural debt

`mobile/app/memories/[id].tsx`, Explore, Profile, and `useMemories.ts` remain oversized. Phase 6 separated runtime ownership and removed eager work without rewriting these screens. Further component splitting is tracked by PH-902 and must preserve navigation, cache isolation, and behavior coverage.
