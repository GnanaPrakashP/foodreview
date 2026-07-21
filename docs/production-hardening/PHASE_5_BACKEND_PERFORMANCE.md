# Phase 5 — Backend, database, and feed performance

Date: 2026-07-13  
Branch: `hardening/07-backend-performance`  
Parent: `76d1bf6816a46fd08614c5dee2439bbec1e4470d`  
Implementation status: PASS locally  
Release/capacity status: BLOCKED pending hosted staging and Phase 9 capacity testing

## Scope and decision

Phase 5 makes every primary mobile read bounded by a fixed page/section size, a stable owner, and an explicit request/query/payload budget. It consolidates database work at the API/RPC boundary, keeps viewer authority on the server, and removes page-size-multiplied calls.

This phase does not claim production latency, throughput, or 1,000-user readiness. It does not change mobile rendering/list virtualization, tab lifecycle, media player lifecycle, persistent-cache policy, application-wide observability, native store artifacts, or hosted infrastructure. Those remain with Phases 6–9.

## Before inventory

The Phase 4 code had several growth-sensitive paths:

- Circle selected candidate data in multiple layers and feed assembly downloaded raw like/comment/bookmark/reaction rows.
- every mounted feed `PostCard` could start its own Taste/Trust request;
- public, restaurant, and dish services contained broad review batches and client filtering;
- Explore could fall back from the canonical RPC to broad client discovery;
- Profile shell and Profile posts both owned the first posts page, and stats could scan up to 1,000 reviews;
- comments and notifications returned bounded-looking arrays without stable end-to-end cursor ownership, and profile enrichment/count work was fragmented;
- Memory room summaries could multiply queries by room count, room detail composed several independent reads, and chat/media signing happened on the client using raw private Storage paths;
- several first-page consumers lacked one documented cache owner and payload ceiling.

The exact old API latency and query counts were not captured before the refactor, so no fabricated numeric before result is reported. The structural before/after assertions are preserved in Phase 5 tests and Git history.

## Selected architecture

### Feed delivery

`/api/feed/circle` resolves the Phase 4 actor once and calls service-only `circle_feed_page_v2`. The RPC owns viewer UUID, membership, block/suppression, visibility/moderation, seen state, and stable `(created_at,id)` pagination. Feed assembly then performs one batched engagement RPC, one batched profile lookup, and one batched authorized-media lookup.

`/api/mobile/feed` is the single public/restaurant/dish/Profile/detail read boundary. `mobile_public_feed_page_v1` accepts an explicit scope and stable cursor, returns at most 50 reviews, and performs normalized place/dish filtering in PostgreSQL. The route batches engagement/profile/media work and exposes the same mobile DTO shape for all scopes.

Feed cards trust their DTO. `PostCard` only enables Taste/Trust reads when a detail screen explicitly passes `loadDetailEngagement`; a 20–24-card feed mounts zero independent card requests. Engagement mutation helpers patch any matching feed/Profile cache page instead of refetching one endpoint per card.

### Explore and Profile

Explore requires `explore_discovery_canonical_v3`. Missing deployment fails visibly; there is no production opt-out or active broad-scan fallback. Its authenticated-profile-gated definer contract reads bounded place/dish projections with location-aware indexed candidate reduction while raw projection tables remain unavailable to clients.

Profile shell now owns only identity, display data, three aggregate stats, and Circle count. It returns `posts: []`. `useProfilePostsInfiniteQuery` is the sole posts-page owner through `/api/mobile/feed?scope=profile`, preventing a duplicate first-page fetch. `profile_post_stats` replaces the 1,000-review client fallback.

### Comments and notifications

Comments use an opaque `(created_at,id)` cursor, default 30/max 50, exact aggregate count, one batched profile lookup, block filtering, and bounded notification fanout. The comments sheet uses an infinite query and explicitly loads older pages.

Notifications use the same cursor rule, default 30/max 50, a recipient-scoped stable index, batched actor display lookup, and an exact indexed head-only unread count. The first list response includes unread count; the independent badge endpoint also uses the indexed head count. No route downloads all notification rows merely to count them.

### Memory

Profile room list uses `shared_memory_room_summaries_v3`: it returns 12-room pages ordered by the displayed visit timeline and a stable `(timeline_date,id)` cursor. It computes members/media/messages/dishes/unread/latest activity inside one membership-aware RPC, with no per-room network/database loop. Room activity remains available as metadata but no longer reorders the visit timeline.

`/api/mobile/memories/read` owns room list, bounded room bootstrap, chat pages, and media pages. The client makes one authenticated request per read. Chat uses a 50-message maximum stable cursor and returns page attachments, reply snippets, and profile names together. Media uses a 30-item default/50 maximum stable cursor.

Memory RPCs intentionally omit `storage_path` and stored `public_url` values. After an authorized RPC returns safe photo IDs, the API makes one batched service-side path lookup and one batched Storage signing call, adds only short-lived delivery URLs/expiry metadata, and removes private path fields. There is no per-message/per-photo signing query.

## Budgets

The machine-readable inventory contains 16 screens, a combined maximum of 16 screen-owned mobile requests, 56 application database statements, and 11 cursor-owned screens. Each screen owns at most one primary request, at most six application statements, at most 50 rows/items, and at most 256 KiB. Full per-screen values and counting rules are in `docs/performance/BACKEND_QUERY_BUDGETS.md`.

Budgets include one canonical page owner. Genuinely independent global work such as location acquisition is documented separately and may not be hidden inside a feed budget. Supabase Auth token verification is platform work; actor profile resolution is included for authenticated API paths.

## Database changes

Canonical additive migration: `202607130009_backend_feed_performance.sql`.

Added indexes:

- `reviews_active_cursor_idx`
- `reviews_public_cursor_idx`
- `reviews_public_place_cursor_idx`
- `reviews_public_restaurant_cursor_idx`
- `reviews_reviewer_visible_cursor_idx`
- `comments_post_cursor_idx`
- `notifications_recipient_user_cursor_idx`
- `notifications_recipient_name_cursor_idx`
- `notifications_recipient_user_unread_phase5_idx`
- `notifications_recipient_name_unread_phase5_idx`
- `place_stats_recent_idx`
- `place_stats_location_idx`
- `dish_place_stats_recent_idx`
- `shared_memory_rooms_activity_cursor_idx`

Removed indexes, based on observed plan competition/redundancy:

- `reviews_visible_feed_idx`: PostgreSQL preferred its partial order and omitted the UUID tie-breaker needed by the stable public cursor; the narrower public/reviewer indexes replace it.
- `notifications_created_at_idx`: a sparse recipient inbox could walk unrelated users chronologically.
- `notifications_recipient_created_idx`: the older two-column form lacked the stable ID tie-breaker and competed with the replacement index.
- `shared_memory_messages_room_created_idx`: the older two-column room/time form was redundant with the Phase 3 stable room/time/ID index and could win with an incremental sort.

Added/replaced functions:

- `mobile_post_engagement_v1`
- `mobile_public_feed_page_v1`
- `circle_feed_page_v2`
- `shared_memory_room_summaries_v3`
- `shared_memory_chat_page` (path-free Phase 5 payload)
- `shared_memory_room_bootstrap_v1`
- `shared_memory_media_page_v1`
- `explore_discovery_canonical_v3`
- `touch_shared_memory_room_activity`
- `reconcile_phase5_projections`

Feed RPCs capable of bypassing RLS are revoked from public/anonymous/authenticated clients and executable only by `service_role`. Client-callable Explore and Memory functions keep RLS/current-profile enforcement. pgTAP checks functions, grants, and critical indexes.

The room-activity reconciliation in the migration updates existing rooms and can take row locks while it computes maximum child activity. On a large hosted table it must be reviewed and timed in disposable staging before production. New indexes should use a hosted rollout method appropriate to Supabase/PostgreSQL maintenance constraints; this local migration does not prove lock time on production data.

## Projection reconciliation

`npm run backend:reconcile` is dry-run by default and reports bounded place/dish projection drift through a service-only RPC. Applying repair requires both `--apply` and `--confirm=PHASE5_PROJECTION_REPAIR`; the limit is 1–5,000. It never auto-targets production and does not print private content or paths.

## Deterministic local plan evidence

`npm run validate:backend-performance:db` loads synthetic data in one rolled-back transaction:

| Fixture | Rows |
| --- | ---: |
| Reviews | 10,000 |
| Comments | 2,000 |
| Notifications | 5,000 |
| Memory messages | 5,000 |

Observed local PostgreSQL execution times after the final clean reset:

| Query | Required index | Execution |
| --- | --- | ---: |
| Circle candidate cursor | `reviews_active_cursor_idx` | 0.112 ms |
| Public feed cursor | `reviews_public_cursor_idx` | 0.032 ms |
| Comments cursor | `comments_post_cursor_idx` | 0.061 ms |
| Notification cursor | `notifications_recipient_user_cursor_idx` | 0.025 ms |
| Memory chat cursor | `shared_memory_messages_room_created_id_desc_idx` | 0.020 ms |

All five plans avoided sequential scans of the seeded large table. The representative 24-row Circle RPC payload was 18,155 bytes and the 24-row public feed RPC payload was 17,092 bytes, each against a 196,608-byte budget. A concurrent newer insert produced zero page-one/page-two ID overlap and a full 24-row second page.

These are database execution times in a local synthetic transaction, not Next API p50/p95, mobile latency, hosted query latency, or capacity evidence.

## Local production API evidence

`npm run validate:backend-performance:api` rebuilt Next with the local Supabase configuration, started `next start`, created disposable users and bounded feed/notification/Memory data, warmed each flow, recorded 20 samples per flow, and removed the fixture. Each sample made one primary request. The harness emits only duration, request count, and payload size—not response bodies, tokens, signed URLs, private content, or Storage paths.

| Flow | Local p50 | Local p95 | Maximum payload |
| --- | ---: | ---: | ---: |
| Circle | 49.372 ms | 62.332 ms | 52,527 B |
| Public feed | 50.328 ms | 57.011 ms | 17,858 B |
| Explore v3 | 22.650 ms | 26.241 ms | 481 B |
| Restaurant feed | 48.729 ms | 62.396 ms | 17,858 B |
| Dish feed | 48.048 ms | 54.005 ms | 17,858 B |
| Profile shell | 43.005 ms | 50.812 ms | 526 B |
| Profile posts | 48.237 ms | 53.062 ms | 17,858 B |
| Post detail | 54.877 ms | 58.517 ms | 811 B |
| Comments | 47.533 ms | 56.649 ms | 6,202 B |
| Notifications | 46.763 ms | 50.702 ms | 16,868 B |
| Memory rooms | 40.049 ms | 50.336 ms | 608 B |
| Memory room detail | 42.708 ms | 48.680 ms | 8,659 B |
| Memory chat | 37.891 ms | 40.531 ms | 7,613 B |

These warm loopback measurements prove the production-built contracts execute and stay within payload budgets locally. They are not mobile device latency or hosted acceptance evidence. Cold-start latency, hosted p50/p95/p99, connection-pool wait, Storage-signing latency with real media, cache hit ratios, realistic social graphs, contention, and concurrency remain unverified.

## Tests and CI

Added:

- `tests/backend-performance-phase5.test.mjs`
- `tests/supabase-backend-performance-phase5-runtime-validation.mjs`
- `tests/backend-performance-phase5-api-runtime-validation.mjs`
- `tests/fixtures/phase5-performance.sql`
- `supabase/tests/0003_backend_performance.sql`
- `scripts/report-backend-performance.mjs`
- `scripts/backend-projection-reconcile.mjs`
- `config/backend-performance-budgets.json`

CI runs the static budget/architecture report, eight focused Phase 5 tests, the deterministic database plan harness, and the production Next API timing/payload matrix. The canonical database suite now contains 57 passing pgTAP assertions across Phases 3–5.

Changed-path tests cover Circle cache mutation, notification list/unread ownership, comments pagination, mandatory Explore v3, filtered restaurant/dish reads, Profile single ownership, Memory bounded read paths, path-free signing, and schema/index grants.

## Local result and baseline comparison

- clean canonical database reset: pass after the final migration;
- Supabase SQL lint: no schema errors;
- pgTAP: 57/57 pass;
- Phase 5 focused tests: 8/8 pass;
- Phase 5 plan/payload/cursor harness: pass;
- Phase 5 production API timing/payload harness: 13 flows × 20 warm samples; pass;
- migration manifest: 66 canonical migrations, 84 tracked entries, two preserved conflicts;
- root/mobile TypeScript: pass after the final Memory API boundary;
- root lint: 0 errors/101 warnings; mobile lint: 0 errors/50 warnings;
- full root suite: 1,072/1,093 passing, with 20 registered PH-002 failures plus Node's aggregate file wrapper for `mobile-profile-layout.test.mjs`;
- Memory hardening: 71/72, with the same registered PH-002 failure;
- Next production build: pass;
- Android and iOS production Expo exports: pass; privileged/autologin configuration-name scan: pass;
- real Auth/RLS/Storage validation: 10/10; canonical upgrade fixtures: pass; canonical drift: zero;
- Phase 4 API security inventory: 72 route files, 96 operations, 65 active-mobile operations, nine internal operations, and 60 explicitly rate-limited operations; pass;
- Phase 1A runtime: 13/13; Phase 1B runtime: 9/9; Phase 1C focused cache isolation: pass; Phase 2 database/processing: 14/14 and 10/10; Phase 4 database/API behavior: 9/9 and ten behavior groups; all pass.

The Phase 4 full-suite baseline is 1,077/1,097 with 20 registered PH-002 failures; Memory is 71/72 with the same registered PH-002 failure. Phase 5's suite topology changed while old contract assertions were consolidated and eight focused Phase 5 tests were added, so raw totals are not directly comparable. The exact failing-name comparison remains authoritative: all 20 registered failures are unchanged, the extra reported failure is only Node's aggregate wrapper for one failing test file, and Phase 5 introduced no new failing name.

## Legacy paths remaining

Some defensive legacy helper functions remain in `mobile/src/services/memories.ts` for older write/delete and schema-compatibility behavior, but active room list/bootstrap/chat/media reads use `/api/mobile/memories/read`. Existing public/restaurant/dish hooks currently consume bounded first pages even though the consolidated API supports cursor continuation. Phase 6 may add UI pagination where product behavior needs it without changing the backend contract.

Older direct feed assembly utilities remain for supporting web/legacy routes. Phase 5 tests guard the active mobile consumers and do not claim every standalone web path was redesigned.

## Hosted staging and production steps

Before production:

1. review hosted migration history and run the Phase 3 read-only drift report;
2. restore a recent sanitized production-sized backup into disposable staging;
3. inspect lock/index build time and disk headroom for `202607130009`;
4. run clean and in-place upgrade gates, pgTAP, RLS/Storage behavior, and Phase 1A–4 regressions;
5. execute authenticated Circle/public/Explore/restaurant/dish/Profile/comments/notifications/Memory flows with real media signing;
6. record cold/warm API p50/p95, database/pool latency, rows/buffers, payload bytes, request count, and duplicate requests;
7. run dry-run projection reconciliation, review counts, and apply only with operator approval;
8. verify dashboards/alerts in Phase 7 and native artifacts/devices in Phase 8;
9. run Phase 9 peak, two-times stress, soak, failure, and recovery tests before any capacity statement.

No hosted project was mutated in Phase 5.

## Remaining risks and ownership

- Phase 6: list/render behavior, viewport media, tabs/navigation, cache persistence/expiry, and UI ownership of additional feed pages.
- Phase 7: API/database/pool/queue metrics, slow-query capture, duplicate-request telemetry, correlation, dashboards, and alerts.
- Phase 8: signed Android/iOS release artifacts and real-device flows.
- Phase 9: hosted latency, concurrency, connection saturation, realtime fanout, Storage/CDN, worker contention, failure recovery, and 1,000-user readiness.
- Existing Phase 1A–4 hosted blockers and PH-001/PH-002 remain open; Phase 5 does not supersede them.

## Phase gate

```text
PASS locally
```

This means the repository-local Phase 5 implementation and deterministic gates pass. It does not mean production release verification or capacity testing has passed.
