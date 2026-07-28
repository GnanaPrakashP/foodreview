# Memory Room focused release-jank and memory follow-up — 2026-07-28

## A. Result

**FAIL**

The focused implementation materially reduced the four priority transition
costs and preserved all automated Memory correctness gates. It did not meet
the Android release-frame budget and did not establish a bounded memory
plateau. Per the acceptance instructions, the full 30-minute matrix was not
run after the isolated gates remained red.

This result does not revert the passing rapid-send, reconciliation, reply,
offline/outbox, viewer, player, Realtime, scroll-restoration, accessibility,
RLS, private-media, or rate-limit work already accepted on the branch.

## B. Scope and build

- Branch baseline: `release/mvp-candidate` at `f1814eb`.
- Earlier implementation/report baselines: `0592154` and `87b8ef5`.
- Device: physical Motorola `motorola edge 70 fusion`, Android 16, 7.3 GiB
  reported RAM, 1272x2772 at 90 Hz.
- Battery/thermal at micro-soak start: 21%, powered, 32 C, no severe thermal
  throttling.
- App: `com.circlebites.mobile.dev`.
- Artifact: signed, minified Hermes Android release/profile APK.
- APK size: 138,303,812 bytes.
- APK SHA-256:
  `267cd6f5b431922bb5acec6e8a164e634dfefb5231d91fe0f0036b476c499b47`.
- The APK passed `scripts/scan-release-artifact.mjs` and `apksigner verify`.
  The local debug certificate was injected only to preserve the device's
  authenticated data during the before/after upgrade; this is not the
  production upload certificate.
- Disposable hosted fixture: 1 room, 4 stops, 16 rated dishes, and 85 seeded
  messages. The first cached page exposed 50 chat entities. The exact fixture
  room and all cascade-owned rows were deleted after validation.

## C. Root-cause summary

### Repeated-flow memory

Measured symptom:

```text
prior 31-minute active growth:       91.0 MiB
same-device before targeted growth: 106.5 MiB over 40 measured transitions
same-device after targeted growth:  108.1 MiB over 80 measured transitions
after 10-minute active growth:       101.9 MiB
after exit +60 s retained growth:     67.8 MiB
```

Attribution:

- The after-fix targeted run moved from 88,324 KB to 156,520 KB native heap
  while Java heap finished 1,824 KB lower and graphics grew 3,876 KB.
- The micro-soak moved from 138,544 KB to 175,304 KB native heap. Native heap
  dipped at cycles 7–8, then rose again to a new maximum at cycle 10.
- Active native view counts still changed from 1,140 Table views to 1,378 Chat
  views and 1,319 Dishes views. Before the fix, Chat and Dishes used 1,487 and
  1,585 views respectively.
- Fabric traces prove repeated heavy native tree destruction/creation. The
  remaining cold Chat activation inserts about 260 Fabric instructions even
  after message projection is removed from the activation path.
- The local SQLite request coordinator also retained a successfully resolved
  promise containing the room graph. It now clears ownership on success and
  failure. This removes a real JavaScript retention path but was not the
  dominant physical PSS owner.

Conclusion:

The primary measured owner group is native React Native/Fabric tree
creation/layout and its allocator high-water behavior, with a smaller expected
JavaScript room-graph retention removed. A Java/native heap dominator dump and
GC-root path were not captured on this non-debuggable installed artifact, so a
more specific native allocator/class-level claim is not justified.

### Chat to Dishes

Before-fix representative Fabric batch:

```text
REMOVE:                514 instructions
INSERT:                613 instructions
UPDATE_LAYOUT:         614 instructions
pre-mount passes p50:   15
```

The Dishes surface was a `ScrollView` that synchronously mapped every dish. A
16-dish activation created every card, rater stack, text subtree, and five-star
control while the Chat tree was removed in the same Fabric batch.

Implemented correction:

- Replaced the eager Dishes `ScrollView`/`map` with a bounded `FlatList`.
- Initial rows: 4.
- Batch: 4.
- Window: 3 viewports.
- Android clipping enabled.
- Dish row moved behind `memo()` with stable handlers and stable dish identity.

After-fix physical evidence:

```text
maximum mounted dish rows:     9 of 16
REMOVE:                      405 instructions
INSERT:                      157 instructions
UPDATE_LAYOUT:               158 instructions
pre-mount passes p50:          5
```

The insert/layout batch fell about 74%. The repeated 200–250 ms bucket was
eliminated, but the new frame p95 was still 121 ms and therefore failed the
documented provisional <=20 ms frame gate.

### Transitions into Chat

Before the fix, every inactive-to-Chat activation recreated the unread anchor
and all projected message objects. The projection itself cost only about
2–3 ms, but it created new Date/user/reaction/reply objects and invalidated row
identity immediately before the cold native Chat mount.

Implemented correction:

- Moved the unread anchor to the room-screen lifetime.
- Moved the stable chat projection to the room owner.
- Reduced the first Chat render from 18 to 8 rows and the batch from 12 to 6.
- Preserved active-only native pane ownership.

After the fix there were zero `MemoryRoomChatCachedMessages` spans across the
80 measured cached returns. Query/entity counts also remained constant. The
remaining cost is the cold native Chat tree itself:

```text
Media -> Chat source remove:     9 instructions
Chat insert/layout:            260/261 instructions
Table -> Chat usable p95:      213.71 ms
Media -> Chat usable p95:      201.63 ms
Dishes -> Chat usable p95:     210.28 ms
```

This isolates the residual blocker from data projection, SQLite, network, and
the source pane. A persistent/warmed native Chat surface might reduce it, but
would contradict the accepted active-only ownership and could reintroduce
content-dependent exit/memory lag. That trade-off was not introduced without a
new architecture and memory proof.

## D. Memory attribution

| Area | Evidence | Conclusion |
| --- | --- | --- |
| Java/Kotlin | Targeted Java heap 24,520 -> 22,696 KB; micro-soak 17,800 -> 33,100 KB, then 19,356 KB at exit +60 s | Not the dominant targeted owner; active soak allocations partly collect after exit |
| Native/Fabric | Targeted native 88,324 -> 156,520 KB; micro-soak 138,544 -> 175,304 KB; hundreds of deterministic Fabric remove/insert/layout instructions per cold pane | Primary measured owner group; no stable active plateau |
| Hermes/JS | Successful local-read promise retained the room graph; fixed. Projection spans fell to zero on cached returns | Real retention and allocation churn removed, but not enough to control PSS |
| React Query | Across 156 targeted samples: 27 total queries, 3 current-room queries, 23 observers, 1 mutation, 50 chat entities, 16 dish entities; every min/max identical | No per-transition cache/entity accumulation |
| SQLite | No local snapshot, SQLite, or server-reconcile span in the targeted cached transitions | Not the isolated transition owner; micro-soak queue depth was not extracted from the binary trace |
| Media/cache | Targeted graphics +3,876 KB. Media-free micro-soak graphics +13,516 KB and stayed allocated after exit | Not the original rich-viewer primary owner; residual graphics/cache warm-up remains |
| Instrumentation | Development journey diagnostics remained disabled; release counters are scalar; existing diagnostic maps/rings have bounded tests | No evidence of per-transition instrumentation accumulation |
| Players/channels | Media-free micro-soak used zero player sessions; prior rich-media acceptance remains the player baseline | No new player regression observed; final Realtime scalar was not independently extracted from Perfetto |

No database schema, RLS, Storage, private-media, authentication, or rate-limit
contract changed.

## E. Memory results

### Same-device targeted experiment

The before run used 10 repetitions per pair and the after run used the required
20, so their total active-growth values are not normalized comparisons.

| Checkpoint | PSS KB | Java KB | Native KB | Graphics KB | Views |
| --- | ---: | ---: | ---: | ---: | ---: |
| After run start, Table | 267,732 | 24,520 | 88,324 | 61,520 | 1,140 |
| After Chat/Dishes pair | 365,137 | 29,928 | 150,136 | 65,128 | 1,319 |
| After Table/Chat pair | 355,630 | 25,256 | 141,780 | 64,556 | 1,378 |
| After Media/Chat pair | 364,414 | 29,688 | 142,780 | 64,520 | 1,378 |
| After Dishes/Chat pair | 388,505 | 28,880 | 160,672 | 65,372 | 1,378 |
| Final Table | 378,388 | 22,696 | 156,520 | 65,396 | 1,140 |

The first warm-up accounts for most of the rise, but the accepted active
budget applies to the repeated flow and the run still grew 108.1 MiB.

### Ten-minute micro-soak

Work performed:

```text
10 room entries
11 room exits
40 tab transitions
20 confirmed text/reply sends
10 replies
10 ratings
3 background/foreground cycles
0 crash / 0 ANR / 0 OOM
```

| Checkpoint | PSS KB | Java KB | Native KB | Graphics KB |
| --- | ---: | ---: | ---: | ---: |
| Start | 353,475 | 17,800 | 138,544 | 62,796 |
| Cycle 1 | 398,746 | 30,528 | 153,964 | 64,804 |
| Cycle 2 | 405,882 | 33,136 | 157,208 | 63,940 |
| Cycle 3 | 407,394 | 34,608 | 158,828 | 63,344 |
| Cycle 4 | 415,353 | 34,968 | 163,388 | 63,796 |
| Cycle 5 | 431,056 | 33,696 | 164,896 | 77,020 |
| Cycle 6 | 436,687 | 34,756 | 166,116 | 76,360 |
| Cycle 7 | 436,603 | 32,232 | 164,364 | 76,944 |
| Cycle 8 | 436,222 | 30,960 | 161,796 | 75,884 |
| Cycle 9 | 450,215 | 33,268 | 169,336 | 75,876 |
| Cycle 10 | 457,848 | 33,100 | 175,304 | 76,312 |
| Final exit | 429,396 | 24,692 | 154,940 | 76,812 |
| Exit +30 s | 425,203 | 20,828 | 154,744 | 76,812 |
| Exit +60 s | 422,915 | 19,356 | 154,332 | 76,812 |

Active growth was 104,373 KB / 101.9 MiB. Retained growth at +60 seconds was
69,440 KB / 67.8 MiB. Cycles 6–8 briefly held a narrow band, but cycles 9–10
rose to new maxima; this is not an accepted plateau. Native heap also ended at
its active maximum and therefore failed the no-monotonic-native-growth gate.

## F. Transition results

The before and after rows are from the same physical device and harness.
Before used 10 samples per pair; after used 20.

| Pair | Metric | Before | After | Change | Gate |
| --- | --- | ---: | ---: | ---: | --- |
| Chat -> Dishes | first-frame p95 | 199.84 ms | 90.65 ms | -54.6% | improved, fail |
| Chat -> Dishes | usable p95 | 284.05 ms | 139.60 ms | -50.9% | improved, fail |
| Chat -> Dishes | frame p95 bucket | 200 ms | 121 ms | -39.5% | improved, fail |
| Table -> Chat | first-frame p95 | 226.10 ms | 205.26 ms | -9.2% | fail |
| Table -> Chat | usable p95 | 247.88 ms | 213.71 ms | -13.8% | fail |
| Table -> Chat | frame p95 bucket | 97 ms | 81 ms | -16.5% | fail |
| Media -> Chat | first-frame p95 | 221.72 ms | 146.19 ms | -34.1% | fail |
| Media -> Chat | usable p95 | 256.15 ms | 201.63 ms | -21.3% | fail |
| Media -> Chat | frame p95 bucket | 93 ms | 77 ms | -17.2% | fail |
| Dishes -> Chat | first-frame p95 | 312.24 ms | 185.12 ms | -40.7% | fail |
| Dishes -> Chat | usable p95 | 349.63 ms | 210.28 ms | -39.9% | fail |
| Dishes -> Chat | frame p95 bucket | 109 ms | 77 ms | -29.4% | fail |

All 80 after-fix target presses selected the requested tab exactly once. No
ignored press or external foreground interruption was accepted. There were no
server-reconcile, local-snapshot, or SQLite markers during the cached return
series.

## G. Architecture changes

- Dishes is now virtualized and mounts a bounded initial/render-ahead window.
- Dish rows have a memo boundary and stable handler identities.
- Chat logical projection/unread anchoring now belongs to the room lifetime,
  not each active-tab lifetime.
- Chat initial native rows and batches were reduced.
- Completed local-read coordinator promises now release room ownership.
- Privacy-safe scalar counters now expose mounted row and cache cardinalities
  only in the explicit release-profile build.
- The runtime harness now accepts a disposable room title, per-cycle memory
  sampling, and media-exercise control for a media-free focused fixture.
- Active-only pane ownership, immediate player cleanup, one-press tab
  semantics, and room exit ownership were preserved.

## H. Correctness regression status

| Area | Result |
| --- | --- |
| Rapid send / exact client-ID reconciliation | 14/14 automated pass; micro-soak completed 20 text/reply sends |
| Replies | 10/10 micro-soak reply attempts sent |
| Rating | 10 physical ratings completed |
| One press -> one transition | 80/80 isolated presses verified |
| Chat projection reuse | zero projection spans on cached target returns |
| Query/entity stability | fixed values across 156 target samples |
| Scroll restoration / active-only pane | focused source/runtime tests pass |
| Viewer/player lifecycle | unchanged; media-free micro-soak, prior rich-media evidence remains baseline |
| Offline/reconnect and process restart | unchanged; not rerun in the focused failing phase |
| Accessibility and permission denial | unchanged focused tests pass |
| Crash/ANR/OOM | 0/0/0 |

## I. Gate results

| Gate | Result | Classification |
| --- | --- | --- |
| `npm run test:memory-rapid-send` | 14/14 pass | pass |
| `npm run test:memory-hardening` | 105/105 pass | pass |
| focused journey/release/Phase 4 set | 75/75 pass | pass |
| root `npm run typecheck` | pass | pass |
| mobile `npm run typecheck` | pass | pass |
| `npm run lint -- --quiet` | pass | pass |
| root `npm test` | 1,760/1,780 pass; 20 fail | same unrelated stale/media/profile branch assertions; no introduced Memory failure |
| standard `npx next build` | pass, 96 static pages | pass |
| signed minified Hermes APK | pass | pass |
| APK signature and privacy/secret scan | pass | pass |
| `git diff --check` | pass | pass |
| hosted DB gates | not run | no persistence/security contract changed |
| 20x Chat -> Dishes | fail | frame p95 121 ms |
| 20x transitions into Chat | fail | frame p95 77–81 ms; usable p95 202–214 ms |
| 10-minute memory micro-soak | fail | +101.9 MiB active; no stable plateau |
| full 30-minute acceptance | correctly not run | blocked by isolated frame and memory failures |

The independent `npm run build` Turbopack stall was not retested. The standard
Next production build passes, and the Turbopack issue remains a separate
environment/compiler blocker.

## J. Evidence

- Targeted JSON:
  `/private/tmp/memory-room-release-jank-after/targeted-report.json`
  (`498b3a5d...71c52ed`).
- Chat -> Dishes ATrace:
  `/private/tmp/memory-room-release-jank-after/chat-to-dishes.atrace.txt`
  (`62450e4d...5e297a6`).
- Table -> Chat ATrace:
  `/private/tmp/memory-room-release-jank-after/table-to-chat.atrace.txt`
  (`34d23c38...dafdc4c`).
- Media -> Chat ATrace:
  `/private/tmp/memory-room-release-jank-after/media-to-chat.atrace.txt`
  (`a752a19d...8b613f3`).
- Dishes -> Chat ATrace:
  `/private/tmp/memory-room-release-jank-after/dishes-to-chat.atrace.txt`
  (`5ab9a14b...f38fb9`).
- Micro-soak JSON:
  `/private/tmp/memory-room-release-jank-micro-soak/release-runtime-report.json`
  (`16672f23...3e00c`).
- Micro-soak Perfetto:
  `/private/tmp/memory-room-release-jank-micro-soak/memory-room-soak.perfetto-trace`
  (`d55b77f6...e5b62`).
- APK:
  `mobile/android/app/build/outputs/apk/release/app-release.apk`
  (`267cd6f5...99b47`).

Not captured: Java/native heap dominator dump, class-level GC-root report,
standalone React Profiler component-duration export, parsed final
Realtime/player/SQLite scalar tracks from the binary Perfetto trace, target
moto g57/lower-memory Android, or physical iOS.

## K. Production conclusion

```text
Memory Room functional acceptance:              PASS on tested Motorola scope
Memory Room rapid-chat acceptance:              PASS on preserved automated and micro-soak scope
Memory Room Android release-frame acceptance:   FAIL
Memory Room memory-boundedness acceptance:      FAIL
Memory Room resilience acceptance:              PASS WITH EXTERNAL GAPS; unchanged full baseline
Memory Room target-device acceptance:           NOT TESTED (moto g57 unavailable)
Memory Room iOS acceptance:                     NOT TESTED
Whole-application production release:           FAIL / NOT AUTHORIZED
```

Primary acceptance answer:

> No. The Memory Room is materially faster and creates substantially fewer
> Dishes native views, but it still does not remain inside the accepted memory
> budget or switch at the documented release-frame budget throughout repeated
> use. The remaining exact measured transition owner is cold native Chat
> tree creation/layout; the remaining memory owner group is native
> React Native/Fabric allocation/high-water growth. The release rejection is
> preserved.
