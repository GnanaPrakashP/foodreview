# Home FlashList recycling migration

## Status

This is a production-path candidate with a build-time list-engine selector. The
store-production profile still defaults to `FlatList`; the optimized internal
preview profile and an explicitly configured local build use `FlashList` with:

```env
EXPO_PUBLIC_HOME_LIST_ENGINE=flashlist
```

The selector is not gated by `__DEV__`, so preview/profile artifacts exercise
the real optimized FlashList path. Development-only recycling telemetry,
subtree tracing, staged placeholders, and the `RECYCLE` overlay remain behind
`EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC=recycling-list` and cannot activate in a
release build. An invalid list-engine value fails mobile configuration instead
of silently selecting an unintended implementation.

The experiment renders the complete real `PostCard`. It does not replace text, actions, feedback, media, callbacks, accessibility nodes, or geometry with diagnostic shells.

## Why this differs from the failed outer-cell A/B

The earlier FlashList test recycled the outer list cell while the inner card still behaved as if each React component instance belonged to one post forever. On item reassignment, post-owned state was corrected in effects, mapped child keys changed with the post ID, feedback was explicitly remounted, media surfaces were conditionally recreated, and scroll/media ownership invalidated the engaged cell set.

This migration addresses those boundaries:

- Post-owned like, bookmark, comment, circle-request, overflow, feedback, header-press, carousel, cover, video, and avatar state uses FlashList recycling state keyed by logical post or media identity.
- Feedback keeps one component identity inside a recycled cell.
- Carousel pages, tags, and dishes use FlashList mapping keys so positional native children can be reused.
- Reaction animation refs reset when a physical control is assigned to another post.
- Fixed-height state changes such as image readiness, icon selection, counts, and carousel index explicitly skip FlashList parent-layout requests; height-changing status text does not.
- FlashList pools incompatible card media/feedback shapes separately with `getItemType`.
- A stable recycling `renderItem` no longer closes over changing scroll ownership.
- A post-keyed external store notifies only rows whose media priority, cover ownership, playback ownership, or scrolling state changed.
- Every bounded FlashList cell retains its first cover surface. Background rows may restore cached/prefetched bytes, but only the visible owner can directly start a network cover load; carousel metadata and video playback retain their existing ownership rules.
- `drawDistance` is 1200 px in the candidate branch so recycled cards are prepared before their boundary reaches the viewport.

The project uses `@shopify/flash-list` 2.3.2, matching the locally audited source tree. The core recycler and render-ahead algorithms were already equivalent to the previous 2.0.2 package; the version change alone is not treated as the fix.

## Physical-device acceptance run

Use the same account, device, gesture, and feed data as the FlatList baseline. Do not judge a debug-only simulator run.

1. Build and install the optimized internal `preview` profile so
   `EXPO_PUBLIC_HOME_LIST_ENGINE=flashlist` is compiled into the artifact.
2. Log in manually and wait for real initial content to settle. Do not enable
   the development recycling overlay or staged PostCard diagnostics.
3. Reset Android frame statistics immediately before the gesture.
4. Perform the established slow forward scroll through the initial ten posts.
5. Repeat with reverse scrolling, a fast forward fling, a reverse fling, and pagination.
6. Record the perceptible bump, total frames, deadline-janky frames and
   percentage, p95, and p99 from the native frame tooling. The sanitized Home
   media profile may be enabled for a non-production profile artifact when its
   bounded cache/readiness counters are useful.
7. Check that image covers are present before entering the viewport, carousel page changes remain correct, feedback and optimistic action state never leak between posts, and video playback ownership remains singular.
8. Compare startup-to-ready time and memory after the initial page and after multiple pages with the FlatList baseline.

## Required acceptance gates

- No perceptible boundary bump at normal browsing cadence.
- No blank gaps or visible scroll-position correction.
- No author/avatar, action count, selected reaction, carousel index, retry, or loading state leaks between recycled posts.
- Cached or prefetched covers appear before their row becomes visible under the normal test cadence.
- Fast forward and reverse flings remain visually stable.
- Pagination does not grow the native cell pool or memory without a bound.
- Exactly one Home video player can be active.
- Startup and retained-memory deltas are measured and accepted explicitly.

Until those physical-device gates pass, the store-production profile keeps
`FlatList` as its default. After acceptance, promote `FlashList` to the Home
default and remove the legacy `recycling-list` engine fallback while retaining
only genuinely useful development diagnostics.
