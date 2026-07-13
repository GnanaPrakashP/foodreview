# Phase 6 — React Native mobile performance and rendering

Date: 2026-07-13
Branch: `hardening/08-mobile-performance`
Parent: `0af380ac1533253dca07af95f144ad6892714f50`
Implementation status: PASS locally
Release verification status: BLOCKED

## Executive result

Phase 6 changes the mobile client from eager, refetch-heavy screen ownership to lazy retained tabs, owner-safe selected persistence, targeted cache patches, bounded cursor lists, viewport-owned video, delta realtime, and one AppState/network coordinator. The deterministic architecture and behavior gate passes, native exports, the Android release APK, and an isolated generated iOS arm64 simulator Release compile pass, and Phases 1A–5 focused regressions remain green.

This is not a production-readiness or 1,000-user claim. Representative release profiling is blocked because the configured hosted database does not contain the Phase 5 `mobile_public_feed_page_v1` RPC: `/api/mobile/feed` correctly fails closed with HTTP 503. No physical Android or iOS device was available. The Android emulator run is retained as partial diagnostic evidence; useful-content, tab-content, mixed-media scroll, active-player, and representative memory/frame acceptance remain unverified.

## Performance inventory

The final automated inventory reports:

- four main tabs, zero eager main tabs;
- one native AppState/network listener owner;
- zero notification polling intervals;
- eight detected persistence-policy predicates covering five logical bounded surfaces;
- feed initial/batch/window values of 4/4/5;
- maximum one active feed player;
- next-two thumbnail prefetch depth.

Before Phase 6, the tab navigator explicitly disabled lazy mounting; Profile-owned Memory queries/realtime and Explore location work could start before first visit; multiple providers/screens independently observed AppState; notification refresh used polling; common mutation paths broadly invalidated feeds/Profile; several active detail/settings lists consumed bounded first pages without UI cursor continuation; feed videos created players without one viewport owner; Memory deltas could be followed by immediate full reloads; and persisted Query data was limited to the older Memory policy.

## Selected startup and tab architecture

The navigator now uses `lazy: true` and `freezeOnBlur: true`. Only Circle mounts at cold authenticated startup. Explore, Create, and Profile mount on first visit; visited screens remain in navigation state, preserving their component and list state, and freeze while blurred. Heavy Profile data, Memory room summaries/realtime, Explore discovery/location, and camera work are focus/visit-gated.

Startup order is: auth session → canonical owner/cleanup recovery → account-status validation → matching-owner cache hydration → initial-tab shell/cached data → online focused refresh. Phase 1C generation guards remain authoritative. A release-only problem found during profiling was fixed: React Native release did not provide `globalThis.crypto.getRandomValues`, causing the Phase 4 install identity to fail closed and blocking API reads. `expo-crypto` now supplies cryptographic `getRandomValues`; no insecure random fallback was added.

## Cache persistence and hydration

The Query envelope is UUID-owner-scoped, schema/buster-versioned, mutation-free, maximum age 24 hours, and sanitized both when written and restored. Selected successful data only:

| Surface | Persisted bound |
| --- | ---: |
| Circle | First page, 24 posts |
| Explore | 60 places, 60 dishes, 60 people |
| Current Profile | 24 posts |
| Memory room summaries | 50 rooms |
| Notification unread count | Scalar |

Infinite-query tail pages, mutations, errors, and other queries are omitted. Expired or within-15-second-safety-window signed media entries are stripped. A malformed dehydrated state now safely becomes an empty query/mutation state. Wrong-owner/corrupt envelopes are deleted. Phase 1C cleanup additionally clears Expo Image disk/memory caches.

One release cold-launch sample recorded `app.cache_hydration=46 ms`, within the 200 ms cache-hydration budget. `app.account_boundary_ready=3,877 ms` was not within the useful-content target because it includes hosted account-status/network work; weakening that fail-closed check was rejected.

## React Query policy

The app uses one QueryClient per active owner, a two-hour garbage-collection time, bounded retries, and the canonical runtime focus/online managers. Domain stale times are explicit: Circle 45 s; Explore 5 min; Profile 2 min; Memory summaries 45 s; notification list/count 30 s; active signed-media refresh 4 min. Foreground does not refetch every query. Active/focused stale data may refresh when online, while cached content remains visible.

## Targeted cache mutation

- Like and bookmark use recursive post-ID patches across Circle/public/restaurant/dish/Profile/liked/saved caches, with optimistic rollback and server correction.
- Post deletion removes only the matching post from active pages.
- Comment creation inserts an optimistic comment and patches the post count; success replaces it with the server row, and failure rolls back. Delete remains targeted.
- Notification read/read-all/delete patch paginated rows and unread totals, snapshot prior state, and roll back on failure.
- Profile edits patch the current/profile caches.
- Circle request changes use narrowed keys.
- Memory message/photo delta and successful writes patch relevant data without immediate room-wide reload.

Structural participant/dish/stop/create/leave operations retain narrow domain invalidations where the server changes ordering or aggregate membership. Ordinary item mutations do not clear the application cache.

## Circle, Explore, Profile, comments, and notifications

Circle owns one infinite query and zero card-mounted requests. Seen post IDs are buffered for 600 ms. The first four cards render, with a four-item batch and five-window ceiling. Returning to Circle uses retained state and stale-while-revalidate semantics.

Explore starts location/discovery only while focused, uses its five-minute cache, and retains its selected screen/tab state. Restaurant and dish post surfaces now consume stable cursor infinite queries and virtualized load-more lists. The hidden hungry/public stack also consumes cursor pages.

Profile starts only while focused. Its shell remains the single Profile metadata owner; posts use the existing infinite query; Memory summaries and summary realtime are focus-gated. Profile post visibility also selects the sole active media post.

Comments retain stable cursor pagination and now have optimistic insert/count rollback. Notifications use an infinite cursor list, focus-aware stale refresh, push-driven narrow invalidation, and optimistic row/count patches. The old duplicate interval polling is removed. Liked and saved settings now use authenticated stable `(created_at,id)` API cursors instead of unbounded client Supabase scans.

## Memory room and chat behavior

The room list still uses one bounded summary contract and zero per-room reads. The Profile owner starts summary realtime only while focused and patches summary message/photo deltas. A delayed 10-second fallback reconciliation is reserved for an unrecognized active-room event; non-delta summary recovery is delayed 15 seconds.

Memory room panes mount on first visit and remain retained. The old eager interaction-time prewarm was removed. Media queries start only after the media tab is visited. Message/media pages keep stable ID tie-breaker cursors and zero per-message identity requests. Only the active media-viewer video creates a player; other pages render posters. Chat/vendor console logging is development-only.

## Lists, media, and players

`PostFeed` uses a 65% visibility threshold with 900 ms minimum view time to choose one stable active post. `PostCard` is memoized. Feed images use thumbnail/feed variants, placeholder, aspect ratio, disk/memory caching, and stable recycling keys; detail uses canonical delivery. Offscreen video has no player and shows its poster. Players pause/release offscreen and do not stay active in background. Maximum active feed players is one.

Prefetch is deliberately small: only the next two image thumbnails, only on Wi-Fi/Ethernet, only from a focused list, and only while the captured account generation remains active. Cellular/offline prefetch is disabled. The emulator could not observe a real player count because the feed deployment contract was unavailable.

## Realtime and runtime coordination

`runtimeActivity.ts` is the sole `AppState.addEventListener` owner and also owns Expo Network subscription plus React Query focus/online state. Account boundary, Explore location, camera, and providers consume this snapshot. This prevents duplicated foreground validation, unfocused location work, and offline retries.

Realtime subscriptions are focus/room scoped and generation guarded. Recognized delta events patch caches once; stale old-account callbacks are ignored. Full reload is not scheduled immediately after a delta.

## Large components

Runtime ownership was extracted into performance/runtime modules and active restaurant/dish list ownership was separated, but no risky whole-screen rewrite was performed. Significant debt remains: Memory room 12,285 lines, Explore 2,354, Profile 1,619, and `useMemories.ts` 1,926. PH-902 remains in progress for safe component splitting. PH-603 remains open because a complete post draft surviving process termination is not proven; existing Phase 2 upload recovery is preserved but does not satisfy the whole draft contract.

## Bundle and artifact results

Deep imports restrict vector-font inclusion to Ionicons and MaterialCommunityIcons. Required icons and product assets remain. Compared with the initial Phase 6 barrel-import export, Android/iOS export size fell about 13.3%, font bytes fell 53.1%, and Hermes fell about 1.9%.

| Artifact | Final | Budget | Result |
| --- | ---: | ---: | --- |
| Android export | 16,647,373 B | 19,922,944 B | PASS |
| iOS export | 16,639,725 B | 19,922,944 B | PASS |
| Android Hermes | 9,262,946 B | 11,010,048 B | PASS |
| iOS Hermes | 9,254,301 B | 11,010,048 B | PASS |
| Fonts per platform | 2,101,500 B | 2,621,440 B | PASS |
| Android release APK | 151,601,421 B | 178,257,920 B | PASS |

The final APK is 156,936 B smaller than the Phase 5 reference. Android Gradle release succeeds with Expo SDK 54, React Native 0.81.5, Hermes, Reanimated 4.1.7, Expo Image 3.0.11, and Expo Video 3.0.16. Because this managed project does not check in an iOS native directory, a current-source isolated `expo prebuild`, CocoaPods install, and code-signing-disabled arm64 iPhone simulator Release compile were also run; Xcode completed with `BUILD SUCCEEDED` and embedded the production Hermes bundle and 56 assets. This compile is native compatibility evidence, not a signed-device or App Store release gate.

## Release-profile measurements

Device: Android emulator `sdk_gphone64_arm64`, Android 15/API 35, 1080×2400, 2,560 MiB configured RAM. Build: installed Gradle release/profile with `EXPO_PUBLIC_PERFORMANCE_PROFILE=1`, package `com.circlebites.mobile` 0.1.0 (1). Five samples; no physical device.

| Metric | Result | Interpretation |
| --- | ---: | --- |
| Cold Activity draw | min 8,323; median 9,153; p95 13,047; max 13,657 ms | Diagnostic, above target; hosted/status and emulator cold costs included |
| Warm Activity resume | min 978; median 1,463; p95 1,680; max 1,869 ms | Diagnostic shell result |
| Useful Circle content | 0/5 samples | Blocked by missing hosted RPC |
| Circle/Explore/Profile cached tab marks | 0/5 each | Blocked by no valid content state |
| Frames | 434 total; 416 janky (95.85%) | Invalid as feed-scroll evidence; repeated error/time-out cycles |
| PSS | 139,516 → 203,424 KiB; +63,908 KiB across 30 tab cycles | Exceeds 40 MiB diagnostic budget; not representative data |
| Active feed players | Not observed | No feed content |

The profiler emitted only aggregate events and declares content/media URL/account logging false. Full JSON is in `docs/performance/phase6-android-emulator-profile.json`.

## Tests and validation

Added `tests/mobile-performance-phase6.test.mjs` with 12 passing behavior/source gates for tab lifecycle, single runtime ownership, owner persistence/signed-media stripping, targeted post identity patches, cursor de-duplication, feed media/player ownership, bounded lists/prefetch, notifications, Memory delta behavior, and sanitized bounded instrumentation.

Focused results:

- Phase 6: 12/12;
- Phase 1A: 6/6;
- Phase 1B: 6/6;
- Phase 1C: 8/8;
- Phase 2: 11/11;
- Phase 3: 9/9;
- Phase 4: 10/10;
- Phase 5: 8/8;
- Memory hardening: 72/72;
- issue register and mobile performance inventory: pass;
- root/mobile typecheck: pass;
- root/mobile lint: zero errors;
- Android and iOS production Expo exports: pass;
- Android release APK: pass;
- isolated generated iOS arm64 simulator Release compile: pass;
- bundle budgets and secret/configuration scans: pass.

The parent full suite was independently rerun from an isolated archive: 1,072/1,093 with 21 failures (20 registered PH-002 names plus Node's aggregate wrapper). The final Phase 6 suite is 1,085/1,105 with 20 failures: every remaining failing name exists at the parent, Phase 6 adds no new failing name, and the obsolete Memory eager-warm assertion is now fixed.

## Staging matrix

Run this matrix on disposable production-like staging after deploying the Phase 5 database contract. Capture useful-content time, tab response, request count, render count, active players, PSS/RSS, JS/UI frame stalls, payload reuse, and cache hydration for every row.

| Flow | Android mid-range | iOS supported device | Required conditions |
| --- | --- | --- | --- |
| Cold/warm launch | Pending | Pending | Five samples each; valid owner cache |
| Circle cached page/return | Pending | Pending | 24 mixed posts, long captions |
| Explore first visit/return | Pending | Pending | Location allow/deny; offline cache |
| Profile first visit/return | Pending | Pending | Several post pages; 50 Memory rooms |
| Long/mixed feed scroll | Pending | Pending | Multiple images/videos; player count ≤1 |
| Like/bookmark/comment | Pending | Pending | Optimistic success, failure rollback |
| Comment/notification pages | Pending | Pending | Multiple cursor pages; no duplicates |
| Memory room/chat/media | Pending | Pending | Large chat, gallery, keyboard, pane switching |
| Background/foreground | Pending | Pending | Stale/fresh queries and missed realtime delta |
| Offline/reconnect | Pending | Pending | No retry storm; cached data remains |
| Account switch | Pending | Pending | Alice data never visible to Bob |

Hosted API latency is reported separately from mobile rendering time.

## Manual production steps and remaining phases

1. Review and deploy the Phase 5 canonical database migration to disposable staging; prove `mobile_public_feed_page_v1` and all prior RPCs before any app rollout.
2. Run Phase 1A–5 hosted/RLS/Storage/media-worker gates and the complete staging matrix above.
3. Use Phase 7 to add production crash/ANR, frame, API, database, pool, realtime, and queue telemetry plus alerts. Phase 7 was not started here.
4. Use Phase 8 to produce signed environment-separated Android/iOS artifacts, privacy manifests, store disclosures, accessibility checks, and physical-device validation.
5. Use Phase 9 for peak, 2× stress, soak, realtime fanout, Storage/CDN, worker contention, and recovery tests. Only Phase 9 may support a capacity/1,000-user statement.

## Unverified items and risks

- missing hosted Phase 5 feed RPC and hosted migration history;
- no physical mid-range Android or physical iOS run;
- useful-content/tab-return budgets, mixed-media frames, active players, and long-session memory;
- production CDN/cache and signed-media renewal behavior;
- complete process-termination-safe post drafts (PH-603);
- oversized Memory/Explore/Profile modules (PH-902);
- iOS signed release, background behavior, and privacy manifests;
- Phase 7 telemetry and alert delivery;
- Phase 9 concurrency, soak, and failure recovery;
- existing PH-001/PH-002 and earlier hosted release blockers.

## Phase gate

```text
PASS locally
```

Implementation is locally complete for the 22 Phase 6 gate criteria. Release verification remains blocked by hosted data-contract and device limitations described above.
