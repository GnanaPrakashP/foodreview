# Memory Room complete user-journey audit — 2026-07-27

## A. Overall result

**PASS WITH BLOCKERS**

The scoped Memory Room is functionally stable on the connected authenticated Android device after the fixes in this change. The final run completed 49 tab presses as exactly 49 transitions with no tap retries, sent and confirmed eight messages, exercised image/video uploads and viewers, reconciled after disconnect, switched Room A → Room B → Room A without observed content leakage, and exited three times with zero retained room Realtime channels or media players.

This is not an unconditional production acceptance:

- The connected device was a Motorola Edge 70 Fusion, Android 16, 1272×2772, with Gboard. It was not the requested moto g57 power.
- No iOS device was available.
- Controlled slow-network shaping, a 20–30 minute soak, a physical TalkBack pass, physical camera/microphone denial, and kill/reopen with pending work were unavailable.
- The aggregate development/instrumented `gfxinfo` sample was 25.51% janky with a 93 ms p95. UIAutomator, the development client, 2,925 diagnostic events, and the synthetic media worker are included in that number, so it is neither a release-performance pass nor evidence of a production regression. A release-profile Perfetto run remains required.
- PSS grew from 577,214 KB to a 954,743 KB peak and ended at 946,125 KB. A single warm-cache run cannot establish a leak, but the lack of recovery requires a release-profile soak before a no-growth claim.
- The full repository suite has 20 pre-existing, non-Memory failures. All Memory-specific suites are green.
- `npm run build` stalled twice in Next 15.5.20 Turbopack without a compiler error. A clean `npx next build` completed successfully with the default compiler.

## B. Interaction inventory

Legend: **A** automated behavioral coverage, **P** physical Android coverage, **I** implementation inspection, **U** unavailable in this audit. A slash means more than one evidence type.

### Entry, lifecycle, and exit

| Supported action | Coverage | Result |
| --- | --- | --- |
| Tap a Profile/Memories room card; route with correlated journey/session IDs | A/P | Pass |
| Mount shell, read in-memory/SQLite state, show cached Table, reconcile server in background | A/P | Pass |
| Uncached/bootstrap entry | A/I | Pass in state-machine tests; not separately network-shaped on device |
| Restart and authenticated entry | P | Pass |
| Enter while global Memory synchronization is active | A/P | Pass; one room request coordinator prevents concurrent duplicate local/bootstrap work |
| Offline cached entry and reconnect | A/P | Pass for radio disconnect/reconnect |
| Notification/deep-link entry with no navigation history | A/I | Fallback route is implemented; no physical notification launch |
| Header Back and Android hardware Back | A/P | Pass |
| Back from viewer, dish sheet, attachment sheet, members, and selection modes | A/I | Layer closes before room exit |
| Exit with durable message/media work | A/P | Room route cleanup does not own or cancel the durable outbox |
| Immediate re-entry and Room A → B → A | A/P | Pass; old-session callbacks rejected by reducer tests; no wrong-room content observed |
| Background/foreground and Realtime re-subscription | A/P | Pass |
| Process kill/reopen with pending message/upload | A | Durable behavior covered; physical interruption unavailable |

Horizontal swipe-back is not implemented as a room-owned gesture on Android. Native iOS navigation was unavailable.

### Table surface and room chrome

| Supported action | Coverage | Result |
| --- | --- | --- |
| View title, occasion, visit date, place timeline, stops, dishes, ratings, and empty state | A/P/I | Pass with representative 3-stop/12-dish fixture |
| Scroll complete Table content | P | Pass |
| Open dish detail from a stop and rate in the detail sheet | A/P | Pass |
| Open members, inspect participants, open a participant profile, request Circle membership | I | Present; not physically exercised |
| Add/invite participants and remove pending selections | A/I | Present; not physically exercised |
| Add Place, Dish, or Media from the floating add menu | A/I | Present; physical upload used the Chat attachment route |
| Attachment sheet: select existing dish/rating, camera, or gallery | A/I | Present |
| Room actions and leave room | A/I | Present; destructive leave was not used |
| Add stop, add dish, add participant, and rating error states | A/I | Mutation-local error handling present |
| Permission loss/deleted room | A/I | Authoritative loss removes the local projection; not injected physically |

The “Post this table memory” control is visibly disabled. Opening/editing/removing a stop, editing occasion/details, pull-to-refresh, and opening a place/location are not currently exposed as supported Table actions.

### Media surface

| Supported action | Coverage | Result |
| --- | --- | --- |
| First/cached activation, empty state, thumbnail/poster loading, grid scroll, and bounded pagination | A/P/I | Pass |
| Open/close image viewer and return to room | A/P | Pass |
| Open/play/close video viewer; pause on background/tab exit; release player | A/P | Pass after player-lifecycle fix |
| Swipe the full media group and select viewer thumbnails | A/P/I | Group propagation fixed; physical image/video viewer exercised |
| Open audio viewer and play/pause | A/I | Player lifecycle covered; no voice fixture in physical run |
| Refresh an expired/failed signed delivery URL | A/I | Error-scoped refresh remains; viewer open no longer refetches the whole room |
| Add from gallery, enqueue/finalize image/video, progress/error/retry, multiple pending uploads | A/P | Five real pipeline uploads completed; synthetic media source, not physical picker/camera |
| Capture/preview/cancel image or video and permission denial | A/I/U | Routes and instrumentation inspected; physical camera matrix unavailable |
| Leave/re-enter or send text while uploads continue | A/P | Pass |

Zoom/pan is not implemented. Video seek, mute, fullscreen, and pause are delegated to native controls; playback was exercised, but the full control matrix was not physically completed.

### Dishes surface

| Supported action | Coverage | Result |
| --- | --- | --- |
| First/cached activation, empty state, list scroll | A/P/I | Pass |
| Open dish details and view raters | A/P | Pass |
| Rate or change own rating with mutation-local pending/error state | A/P | Pass |
| Switch away during rating and return after confirmation | A/P | Pass |
| Add a dish from floating/attachment menus | A/I | Present; not physically exercised |
| Concurrent update, offline rating, server failure/retry | A/I/U | Realtime/query update paths inspected; injection not physical |

Edit/remove dish, hidden-dish expansion, pull-to-refresh, and a separate dish-detail route are not exposed here.

### Chat surface

| Supported action | Coverage | Result |
| --- | --- | --- |
| First/background-warmed/cached activation, empty state, initial window, scroll and older pagination | A/P | Pass |
| Send text, A–E burst, identical text, emoji, multiline, and reply | A/P | Pass; 8 optimistic and 8 confirmed rows |
| Cancel reply/edit, reply to older message, and jump to replied-to message | A/I/P | Reply send exercised; remaining controls inspected/tested |
| Native Android first-tap Send and double-tap protection | A/P | Pass; no repeated click required |
| Failed message retry/cancel and durable outbox reconciliation | A | Pass |
| Long-press selection; edit own text; delete selected messages/media | A/I | Present; not physically exercised |
| Reactions | I | Explicitly disabled |
| Image/video attachment and viewer | A/P | Pass |
| Record/cancel/send voice; audio play/pause | A/I/U | Recorder/player owners inspected and automated; microphone/physical audio unavailable |
| Keyboard open/close, multiline resize, tab switch with IME open, background/foreground | A/P | Pass with Gboard |
| Incoming Realtime while typing/reading/pending, stale refresh, unread/read marker | A | Behavioral and source coverage; no second physical sender |
| Deleted message, membership removal, account switch | A/I | Owner isolation and deletion paths covered; not physically injected |

### Tab navigation

| Supported action | Coverage | Result |
| --- | --- | --- |
| Tap Table, Media, Dishes, Chat in forward/reverse patterns | A/P | Pass |
| Ten repeated multi-tab cycles | P | Pass after gesture ownership fix |
| Switch with keyboard open, viewer/player active, upload/mutation pending | A/P | Pass |
| No fetch fan-out on tab return | A/P | Every recorded transition had request delta 0 |
| Release inactive panes and players | A/P | Pass; final player count 0 |
| Preserve query data across tab return | A/P | Pass |
| Preserve per-pane scroll offset across tab return | I | Not preserved: inactive pane native views intentionally unmount to bound teardown |

Tab swiping is not implemented; navigation is by accessible tab buttons.

### Failure and accessibility inventory

Automated/inspection coverage exists for room/bootstrap failure, stale refresh, SQLite migration failure, upload retry, signed URL failure, authoritative membership loss, account-owner isolation, old-room callbacks, player/subscription cleanup, accessible tab selected state, send/voice labels, rating labels, viewer controls, cancellation controls, and reduced-motion-aware room transitions. Physical radio disconnect/reconnect was completed. TalkBack, dynamic text, permission denial, camera/microphone failure, notification failure, killed-process pending work, and iOS accessibility are unavailable.

## C. Journey results

The fixture contained 2 disposable rooms, 3 participants, 3 stops, 12 dishes, 65 messages with replies, and real-pipeline synthetic image/video media. Test users were removed after each run; diagnostics contained no bodies, names, tokens, signed URLs, storage paths, or private media IDs.

| Run | Device/result | Duration | Correctness | Requests | Whole-run dev frame sample | PSS |
| --- | --- | ---: | --- | ---: | --- | --- |
| Accepted | Edge 70 Fusion / PASS | Not emitted by older report | 49 presses/49 transitions; 8/8 messages; 0 retries | Older report did not summarize | 24.00% jank; p95 93 ms; 2,000 frames | 579,839 → 944,658 KB |
| Repeat 2 | Edge 70 Fusion / defect found | 224.7 s | 50 presses/49 transitions; one same-gesture duplicate detected | 407 | 24.03%; p95 85 ms | 581,387 → 967,241 KB |
| Final repeat 3b | Edge 70 Fusion / PASS | 224.8 s | 49/49; 8/8 messages; 2/2 players released; 3/3 channels removed | 404 | 25.51%; p95 93 ms; 1,925 frames | 577,214 → 946,125 KB; peak 954,743 |

The final combined physical journey covered the core of Journeys A, B, C, D, F, and H. It did not constitute controlled Journey E or the 20–30 minute Journey G. One aborted setup run failed before entering the journey because Android 16 presented a precision-location prompt; the login harness now handles “Keep approximate location.”

Visible inspection of the accepted contact sheet found no white/black/empty frame, header mismatch, stale tab content, keyboard gap, wrong-room content, or unexpected media resize. The blue/orange panels are deliberate synthetic media. The screen recording was capped at 180 seconds, shorter than the 224.8-second journey, so the event report—not the video—covers the final Room A/B/A segment.

## D. Entry analysis

Final run, measured from card tap:

| Entry | Local snapshot | First room frame | Table usable | Server reconciled | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| First/cold app journey | 479.0 ms | 596.6 ms | 596.1 ms | 1,327.6 ms | Cached UI usable before network |
| Warm re-entry | 233.7 ms | 366.1 ms | 365.5 ms | 944.6 ms | Pass |
| Room-switch re-entry | 302.6 ms | 424.2 ms | 422.4 ms | 1,102.9 ms | Pass, no cross-room state |

There were three room sessions, three Realtime subscriptions, and three matching unsubscriptions. Concurrent local reads/bootstraps are singleflight, but a later foreground refresh is still allowed. Controlled slow-network timing was unavailable. Offline/reconnect used actual radio disconnect/reconnect, not shaped latency. Blank frames were not emitted as a numeric diagnostic (`null`); none were observed in the captured frames.

## E. Tab-switch matrix

All numbers are milliseconds from the final development-instrumented run. `first` and `usable` are p50/p90/p95. The 93 ms frame p95 and 25.51% jank are aggregate across the full run, not attributable per transition. “Blank” means none observed, but no numeric blank-frame detector was available. Mount is median diagnostic mount events, not native view count.

| Transition | n | First p50/p90/p95 | Usable p50/p90/p95 | Requests | Mount | Result |
| --- | ---: | --- | --- | ---: | ---: | --- |
| Table → Dishes | 1 | 514/514/514 | 641/641/641 | 0 | 13 | Correct; release perf proof blocked |
| Dishes → Chat | 11 | 841/995/1,097 | 842/996/1,099 | 0 | 10 | Correct; visibly budget-risky in dev trace |
| Chat → Media | 1 | 268/268/268 | 308/308/308 | 0 | 5 | Correct |
| Media → Chat | 1 | 975/975/975 | 1,032/1,032/1,032 | 0 | 10 | Correct; release perf proof blocked |
| Chat → Table | 13 | 270/278/384 | 271/386/440 | 0 | 1 | Correct |
| Table → Media | 10 | 160/165/167 | 161/169/184 | 0 | 5 | Correct |
| Media → Dishes | 10 | 496/504/505 | 498/505/507 | 0 | 13 | Correct |
| Table → Chat | 2 | 418/761/761 | 662/825/825 | 0 | 10 | Correct; first Chat ownership is expensive |
| Table → Dishes/other unsampled pairs | — | — | — | — | — | Four directed pairs were not sampled |

No sampled tab transition started a network request. Exactly 49 `TAB_PRESS`, `TAB_TRANSITION_STARTED`, `TAB_FIRST_FRAME`, and `TAB_TRANSITION_SETTLED` events were recorded after the gesture fix.

## F. Surface analysis

- **Table:** Representative content and scrolling remained usable during room reconciliation. The current surface is intentionally a timeline/view surface; several prompt-listed edit/place actions are not product features.
- **Media:** Full gallery groups now reach the viewer, allowing horizontal media navigation. Viewer opening no longer triggers a room-wide refetch. Image and video open/close completed without the earlier player-release crash.
- **Dishes:** Rating was local to the dish mutation and remained responsive while switching tabs. Dish detail is a room-owned sheet and closes before route Back.
- **Chat:** Eight optimistic messages became eight confirmations with no retry and no confirmation-driven extra row. Gboard send works on the first physical press. Reply, multiline, pagination, offline/reconnect, and upload concurrency completed. The earlier rapid-send architecture was retained.
- **Viewer/camera/voice:** Image/video viewer ownership is now atomic. `useVideoPlayer` alone owns native release; backgrounding only pauses. Camera/preview/voice routes are instrumented and automated, but physical camera, microphone, audio, and permission matrices remain unavailable.
- **Exit:** App-side Back-to-unmount was 101.6, 79.6, and 97.9 ms. The 3.5–4.2 second `roomExitMs` harness values are UIAutomator polling-to-Profile detection and must not be presented as app exit latency. Inactive panes now unmount, making teardown independent of previously visited heavy tabs.

## G. Resource, render, data, and network analysis

### Ownership state machine

```text
card tap
→ route shell + journey session
→ in-memory/SQLite snapshot (singleflight)
→ cached room/query rendered
→ server detail reconciliation (singleflight)
→ one room Realtime channel
→ one active pane's native views
→ optimistic local mutations + durable outbox
→ server confirmation/reconciliation
→ background pause / foreground reconcile
→ layer cleanup
→ channel/player/pane cleanup
→ route unmount
```

| Resource | Canonical owner | Cleanup/result |
| --- | --- | --- |
| Room detail/query cache | React Query `memoryKeys.detail(roomId)` | Persists bounded data across panes; owner-scoped |
| Durable snapshot/outbox/read state | owner-scoped SQLite store | Survives route exit; authoritative access loss removes projection |
| Initial local and room refresh request | per-mounted-room request coordinator | Concurrent duplicates coalesced; later foreground refresh allowed |
| Room summaries/global Memory | global Memory bootstrap/Realtime owner | Separate from room channel; request counts include global activity |
| Room Realtime | `useMemoryRoomRealtime` | 3 subscribe / 3 unsubscribe; final 0 |
| Active tab content | `RoomPane` | Only active pane mounted; inactive panes released |
| Chat/media pages | bounded React Query infinite pages + SQLite | No tab-return fetch fan-out |
| Pending messages/uploads | durable outbox/media recovery services | Not canceled by room exit |
| Audio/video | individual media row/viewer hook | 2 created / 2 released; final 0 |
| Keyboard inset | one translated Chat surface/native inset owner | Removed with Chat pane |
| Viewer/reply/selection | room-local state | Cleared on close/exit/room session change |

Final-run diagnostics: 2,925 events, 1,756 surface renders, 365 mounts and 365 unmounts, 7 scroll starts/6 settles, 13 refresh starts/applies, 6 pagination starts with 4 finishes and 2 expected offline failures, and final player/channel counts of zero. Typing is owned by the native/composer subtree; no diagnostic evidence showed inactive pane activity during typing.

The request total was 404, but 237 were the development harness’s `POST /api/internal/media/process` pump and the remainder includes login/global app traffic. Room-specific calls were detail 2, chat 2, media 4, messages 8, room media 5, upload intent/finalize 5 each, notifications 13, rooms 32, and sync 68. The global rooms/sync traffic is not caused by tab return; each tab transition had a request delta of zero. No per-row query was observed.

PSS samples (KB): baseline 577,214; room entry 635,852; after uploads 792,958; image viewer 933,373; after close 877,819; video 943,679; after background 889,459; after ten cycles 954,743; reconnect 929,471; first exit 915,818; final exit 946,125. Graphics memory fell after viewer close, and player/channel owners reached zero. Native/PSS retention remains unresolved until a release-profile long soak.

SQLite diagnostics counted two explicit local-read starts and no writes. Writes were not instrumented at the SQLite boundary, so zero is an instrumentation gap, not a claim that messages/ratings/uploads caused no persistence. Durable behavior is covered by the behavioral suites.

## H. Findings

### Fixed P1 — video viewer close could crash

- **Symptom:** closing/switching from an active video could touch an already released Expo shared object.
- **Root cause/trigger:** component cleanup called `pause()` after `useVideoPlayer` had begun native release.
- **Evidence:** physical reproduction during the first wider journey; final runs completed 2 player creates/releases with no crash.
- **Files:** `mobile/app/memories/[id].tsx`.
- **Correction/test:** `useVideoPlayer` exclusively owns release; background state may pause defensively. Viewer lifecycle regression tests assert no cleanup pause and balanced owners.

### Fixed P1 — stale viewer selection could create/release a video before its surface attached

- **Symptom:** a video player could exist for roughly one render turn before `SurfaceVideoView` attached.
- **Root cause/trigger:** the always-mounted viewer received `selection=null` and retained its previous active index.
- **Evidence:** physical crash investigation and lifecycle event order.
- **Files:** `mobile/app/memories/[id].tsx`.
- **Correction/test:** mount `MediaViewer` only when selection is non-null; state-machine/player cleanup tests cover close and tab switch.

### Fixed P1 — one tab gesture could become two transitions

- **Symptom:** one run required a retry and recorded 50 tab presses for 49 intended transitions.
- **Root cause/trigger:** `onPressIn` activated immediately, while a delayed `onPress` could outlive a time-window dedupe and activate again.
- **Evidence:** repeat 2; final repeat recorded exactly 49/49 and zero retries.
- **Files:** `mobile/app/memories/[id].tsx`, Android journey validator.
- **Correction/test:** consume the matching release using per-gesture refs with a bounded expiry; physical validator now rejects extra presses.

### Fixed P1 — media viewer received only the selected item

- **Symptom:** viewer swipe could not reach adjacent gallery media.
- **Root cause/trigger:** gallery passed `[photo]` instead of the current media group.
- **Evidence:** source trace and physical viewer coverage.
- **Files:** `mobile/app/memories/[id].tsx`.
- **Correction/test:** pass the full group; automated source/behavior tests assert group propagation.

### Fixed P2 — viewer open and room entry performed avoidable whole-room work

- **Symptom:** viewer open could refetch the whole room; concurrent mount paths could repeat local/bootstrap reads.
- **Root cause:** unconditional viewer refetch and competing query/effect owners.
- **Evidence:** request instrumentation; final tab transitions all had request delta 0.
- **Files:** `mobile/src/hooks/useMemories.ts`, `mobile/app/memories/[id].tsx`, `mobile/src/services/memoryRoomJourneyDiagnostics.mjs`.
- **Correction/test:** error-scoped URL renewal and per-room singleflight coordinator with retry/foreground-release tests.

### Fixed P2 — exit cost depended on previously visited heavy tabs

- **Symptom:** some rooms exited noticeably later after visiting Chat/Media/Dishes.
- **Root cause:** inactive panes retained native lists, rows, and media owners, making teardown content-dependent.
- **Evidence:** physical app-side exit is now 79.6–101.6 ms over three rooms.
- **Files:** `mobile/app/memories/[id].tsx`.
- **Correction/test:** only the active pane mounts; regression test asserts inactive panes have no retained mount state.

### Open P2 — release smoothness is not proven

- **Symptom:** development aggregate was 25.51% jank, p95 93 ms; Dishes → Chat p95 usable was 1,099 ms.
- **Cause/trigger:** likely includes development instrumentation, UIAutomator, cold native view/player/list ownership, and media worker load; attribution is not available from `gfxinfo`.
- **Evidence:** final `report.json` and recording.
- **Files:** room surface and physical harness; no single product root cause proven.
- **Recommended correction/test:** release-profile APK on the target moto g57, Perfetto/FrameTimeline plus React profiling, isolated pair transitions, and production diagnostics disabled. Do not tune from this dev aggregate alone.

### Open P2 — scroll position resets when a pane unmounts

- **Symptom:** returning to a previously scrolled inactive tab reconstructs its native view and may reset offset.
- **Root cause:** active-only pane policy chosen to make exit and resource ownership bounded.
- **Evidence:** `RoomPane` ownership and test contract.
- **Files:** `mobile/app/memories/[id].tsx`.
- **Recommended correction/test:** if product requires position retention, persist a small per-tab offset and restore once without retaining the whole pane; add physical forward/reverse offset assertions.

### Open P2/P3 — warm memory retention requires a soak

- **Symptom:** final PSS remained 368,911 KB above baseline after viewers, uploads, and cycles.
- **Root cause:** not established; decoded/native caches and development runtime are plausible, while balanced player/channel counts argue against those owners.
- **Evidence:** eleven PSS/heap/graphics samples.
- **Recommended correction/test:** 30-minute release-profile room-switch soak, forced-GC comparison where valid, bitmap/player/native heap attribution, and repeated post-exit stabilization samples.

### Open P3 — SQLite write timing and per-transition frame metrics are incomplete

- **Symptom:** report shows zero SQLite writes and only whole-run frame metrics.
- **Root cause:** instrumentation is intentionally privacy-bounded and did not wrap the persistence boundary or collect FrameTimeline slices.
- **Recommended correction/test:** add development-only aggregate operation counters/durations and Perfetto markers without recording rows or IDs.

## I. Physical evidence

- Final report: `/private/tmp/memory-room-journey-20260727-repeat3b/report.json`
- Final redacted events: `/private/tmp/memory-room-journey-20260727-repeat3b/journey-events.json`
- Final harness events/request timeline: `/private/tmp/memory-room-journey-20260727-repeat3b/events.json`
- Final screen recording: `/private/tmp/memory-room-journey-20260727-repeat3b/memory-chat-visual.mp4`
- Accepted visual contact sheet: `/private/tmp/memory-room-journey-20260727-accepted/contact-sheet.png`
- Accepted report/recording: `/private/tmp/memory-room-journey-20260727-accepted/report.json`, `/private/tmp/memory-room-journey-20260727-accepted/memory-chat-visual.mp4`
- Defect-discovery run: `/private/tmp/memory-room-journey-20260727-repeat2/report.json`
- Android precision-prompt setup failure: `/private/tmp/memory-room-journey-20260727-repeat3`

No personal room content was used or retained. The raw evidence is local and intentionally not committed.

## J. Test and gate results

| Gate | Result | Classification |
| --- | --- | --- |
| `npm run test:memory-rapid-send` | 14/14 pass | Scoped pass |
| `npm run test:memory-hardening` | 105/105 pass | Scoped pass |
| `node --test tests/memory-room-journey.test.mjs` | 15/15 pass | Scoped behavioral pass |
| Memory visual/cache/video/performance focused set | 39/39 pass | Scoped pass |
| Backend/durable-replica focused set | 19/19 pass | Stale Memory contract assertions corrected; pass |
| Root `npm run typecheck` | Pass | Gate pass |
| Mobile `npm run typecheck` | Pass | Gate pass |
| `npm run lint -- --quiet` | Pass | Gate pass |
| `npx next build` | Pass; compiled in 13.9 s | Production compile pass |
| `npm run build` (`next build --turbopack`) | Stalled twice, including clean cache | Environment/compiler blocker |
| `npm test` | 1,747/1,767 pass; 20 fail | Pre-existing stale assertions/test harnesses outside Memory scope |

The 20 full-suite failures are all reproducible against unchanged source areas: one review activation assertion; three media-pipeline harness tests; nine media-worker harness/static-contract tests; one Explore slide-over assertion; one Profile error-sanitization assertion; two Profile/layout token assertions; one post-upload static assertion; one reduced-motion static assertion; and one review-media hardening assertion. They are classified as **stale assertion/test harness**, not introduced Memory regressions. This audit did not rewrite unrelated tests merely to make the total green.

The Memory-related stale assertions updated here preserve or strengthen the intended invariant: current v2 bounded RPC names, centralized signing with no selected `storage_path`, reconciliation module mocks, disabled-reaction guard, production diagnostics rejection, active-only pane ownership, and whitespace-tolerant shared-transcoder detection.

`git diff --check` is run after report generation and generated Android artifacts are restored before commit. Database/pgTAP gates are not applicable because no Supabase migration, server write contract, or persistence schema changed.

## K. Direct acceptance answer

**Not an unconditional “yes” yet.** On the connected authenticated Edge 70 Fusion, a real user can complete the representative supported core path—enter cached rooms, inspect Table, use Media and Dishes, send/reply in Chat on the first press, upload image/video media, play video, switch tabs repeatedly, disconnect/reconnect, switch rooms, and exit—without observed state corruption, wrong-room leakage, crash, retained player, or retained room subscription.

The claim that *every* supported action is smooth and repeatedly bounded is blocked until the target moto g57 release-profile run, controlled slow network, 20–30 minute memory soak, TalkBack/permission/camera/microphone matrices, physical pending-work kill/reopen, iOS validation, per-transition frame evidence, and the pre-existing repository/build-path blockers are closed.
