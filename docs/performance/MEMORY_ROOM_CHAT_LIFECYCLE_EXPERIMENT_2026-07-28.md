# Memory Room Chat lifecycle and native-memory experiment — 2026-07-28

## A. Result

**FAIL**

Four production-like, profile-only Chat lifecycle candidates were implemented
and compared on the same authenticated physical Android device. All four
completed the required Stage A matrix with one accepted press per transition
and no fatal crash, but every candidate missed both the provisional room-frame
budget and the repeated-flow active-PSS budget:

| Candidate | Stage A active PSS growth | Worst frame p95 bucket | Result |
| --- | ---: | ---: | --- |
| A — active-only cold mount | 99.3 MiB | 93 ms | reject |
| B — retained content-free shell | 152.8 MiB | 101 ms | reject |
| C — bounded warm Chat tree | 110.9 MiB | 117 ms | reject |
| D — press-down precreate/coordinated teardown | 133.6 MiB | 89 ms | reject |

The required budgets are active PSS growth `<= 40 MiB`, a stable repeated-block
plateau, and the existing provisional room-frame budget `<= 20 ms`. No
candidate passed Stage A, so selecting a candidate and continuing to Stage B,
the three 50-transition blocks, the ten-minute micro-soak, or the full
30-minute release matrix would have violated the experiment's gate order.

The store-production lifecycle therefore remains the accepted active-only cold
mount. The selector works only when `EXPO_PUBLIC_PERFORMANCE_PROFILE=1`, and
mobile configuration rejects the selector and profiling flag for the
production environment.

Primary acceptance answer: **No.** Candidate C substantially reduced cold
Chat Fabric creation, but neither it nor the other candidates produced smooth
Chat-involved switching within a bounded native-memory result. The remaining
measured owner group is repeated React Native/Fabric native
view/text/layout/gesture/composer construction plus allocator high-water
growth. A class-level retained leak was not proven.

## B. Candidate comparison

### Architecture and retained ownership

| Candidate | Architecture | Inactive ownership | Whole-screen views, inactive -> Chat | Resource proof | Decision |
| --- | --- | --- | ---: | --- | --- |
| A — `cold` | Unmount the complete Chat surface while inactive and create it on selection | No retained Chat host, input, content, player, or focus | 1,055 -> 1,390 representative views | Host/input each remained 0–1; one Realtime channel | baseline; reject |
| B — `retained-shell` | Keep a content-free wallpaper/layout shell; attach rows and input on activation | One shell, no message content, input, keyboard focus, gesture action, player, or accessibility exposure | 1,057 -> 1,164 | Shell/host/input each remained 0–1; one Realtime channel | less Chat Fabric work, worst memory; reject |
| C — `warm-bounded` | Keep one frozen, bounded Chat host and first-window projection; disable pointer/accessibility/input ownership while inactive | One host and one blurred input, no off-screen history, player, second subscription, live gestures, or inactive reconciliation | 1,173 -> 1,152 | Host/input min=max=1; one Realtime channel; no player marker | best Chat entry work, memory/frame failure; reject |
| D — `precreate` | On tab press, prepare destination, commit it visible, then defer source teardown through a generation-guarded coordinator | Normally active-only; at most two mounted during preparation, never two interactive | 1,055 -> 1,164 | Host/input each remained 0–1; stale work cancelled; one Realtime channel | slower and memory-heavy; reject |

The whole-screen view counts include the route, header, navigation and source
pane; they are not counts attributable only to the retained Chat surface.
Candidate C's inactive view count is the only directly observed retained-tree
cost. Fresh-run inactive PSS was 257–259 MiB for A–C and 259 MiB for D, but
process/cache warm-up differs between installations, so this experiment does
not claim a precise isolated-MiB shell cost.

Candidate E, stable Fabric host reuse, was investigated but not implemented.
The current Chat list, native composer, keyboard-inset surface and gesture
wrappers are one React-owned subtree. Reusing only the host while replacing
content reproduces C; keeping the complete vendor-backed tree would retain
heavy content; lower-level view reuse would require a risky list/input rewrite.
There was no supported distinct E candidate that preserved the task's
correctness boundary.

### Stage A summary

Each row contains 20 accepted physical repetitions. First-frame and usable
values are p95. Fabric values are p95 instructions/native views per
transition.

| Candidate | Pair | First frame | Usable | Frame p95 | Jank p95 | Fabric insert / remove / layout / native views |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| A | Table -> Chat | 156.94 ms | 173.52 ms | 93 ms | 18.18% | 277 / 39 / 280 / 291 |
| A | Media -> Chat | 163.97 ms | 192.50 ms | 93 ms | 18.18% | 278 / 125 / 279 / 292 |
| A | Dishes -> Chat | 140.80 ms | 164.59 ms | 85 ms | 18.18% | 278 / 347 / 279 / 292 |
| A | Chat -> Dishes | 86.73 ms | 126.97 ms | 93 ms | 27.27% | 157 / 374 / 158 / 176 |
| B | Table -> Chat | 143.25 ms | 162.64 ms | 53 ms | 6.67% | 122 / 40 / 127 / 120 |
| B | Media -> Chat | 114.67 ms | 154.77 ms | 48 ms | 12.50% | 123 / 126 / 125 / 121 |
| B | Dishes -> Chat | 152.03 ms | 173.47 ms | 48 ms | 12.50% | 123 / 348 / 125 / 121 |
| B | Chat -> Dishes | 87.12 ms | 127.21 ms | 101 ms | 27.27% | 158 / 123 / 160 / 191 |
| C | Table -> Chat | 112.58 ms | 112.75 ms | 48 ms | 5.88% | 90 / 111 / 93 / 88 |
| C | Media -> Chat | 81.45 ms | 108.38 ms | 53 ms | 5.88% | 91 / 197 / 91 / 89 |
| C | Dishes -> Chat | 148.49 ms | 152.46 ms | 53 ms | 5.88% | 91 / 419 / 91 / 89 |
| C | Chat -> Dishes | 107.44 ms | 154.48 ms | 117 ms | 33.33% | 229 / 91 / 229 / 273 |
| D | Table -> Chat | 196.35 ms | 196.36 ms | 61 ms | 30.77% | 196 / 75 / 203 / 193 |
| D | Media -> Chat | 228.13 ms | 225.28 ms | 44 ms | 27.27% | 105 / 0 / 106 / 193 |
| D | Dishes -> Chat | 174.46 ms | 174.46 ms | 48 ms | 30.00% | 105 / 0 / 106 / 193 |
| D | Chat -> Dishes | 223.97 ms | 223.96 ms | 89 ms | 40.00% | 227 / 88 / 227 / 379 |

Candidate C cut Chat-entry native view creation from 291–292 to 88–89 and
Fabric insert/layout work from about 278/280 to about 91/93. It still missed
the frame gate, made Chat -> Dishes worse, and grew active PSS by 110.9 MiB.
It is therefore useful attribution evidence, not a selectable architecture.

## C. Selected architecture

No experimental lifecycle was selected. Production remains:

```text
room entry
-> active Table mounts
-> Chat remains fully absent while inactive
-> Chat tab press selects Chat
-> full bounded Chat surface mounts
-> first correct frame and functional composer become usable
-> leaving Chat blurs input and releases Chat-native ownership
-> destination becomes active
-> room exit synchronously cancels work and destroys all pane ownership
```

The profile-only D coordinator remains available for controlled analysis:

```text
TAB_PRESS
-> invalidate the prior transition generation
-> disable outgoing interaction
-> mount/prepare the destination
-> commit only the destination interactive
-> defer non-critical source destruction
-> cancel stale deferred work on another press, background, room change or exit
```

The production default does not use this coordinator because D failed. The
coordinator's state machine and the C ownership boundary remain covered by
tests so a future experiment cannot expose two interactive panes, reuse a host
across room/account ownership, retain keyboard focus, or allow stale teardown
to remove the new destination.

One real Stage A defect was found: after 60 transitions in the first C run,
Chat -> Dishes was ignored because the event handler compared against a stale
rendered mode. The request guard now reads and updates an immediate ref. The
failing trace is retained separately; the fix then passed a 5-transition smoke
and all 80 official C transitions. D also passed all 80 with the same guard.

## D. Native-memory attribution

### Measured heap split

| Candidate | PSS delta | Native heap delta | Java heap delta | Graphics delta |
| --- | ---: | ---: | ---: | ---: |
| A | +101,672 KB | +63,028 KB | -3,660 KB | +4,864 KB |
| B | +156,459 KB | +104,316 KB | -2,332 KB | +4,400 KB |
| C | +113,618 KB | +86,060 KB | -1,648 KB | +4,020 KB |
| D | +136,781 KB | +98,288 KB | -2,872 KB | +4,692 KB |

The dominant measured growth is native, not Java. Graphics growth is modest
and Java finishes lower for every candidate. Fabric traces show deterministic
view creation, insertion, removal and layout work at every activation.
Candidate C proves that reducing Chat creation alone is insufficient: it
creates only 88–89 native views on Chat entry but still adds 84.0 MiB native
heap over Stage A, and Chat -> Dishes creates 273 native views.

The profile traces also show:

- exactly one active room Realtime channel;
- at most one Chat host and one native input;
- one bounded retained shell only for B;
- one fixed host/input throughout C;
- no active media-player transition marker;
- stable representative cache cardinality: 28 queries, 23 observers, 1
  mutation, 3 current-room queries, 50 Chat entities, 16 Dishes entities and
  30 Media entities.

Attribution limits:

- No Java/Kotlin heap dump or dominator report was captured, so no Java class
  is named as a dominator.
- No successful `heapprofd` native allocation profile was retained, so Fabric,
  Yoga, text layout, gesture, Reanimated, Hermes/JSI, IME and allocator arenas
  cannot be separated by allocation category.
- Hermes was production-mode and minified, but its individual contribution was
  not isolated.
- No repeated-block candidate qualified to distinguish a true retained leak
  from bounded allocator high-water reuse. The observed run is therefore
  classified as **native allocator/Fabric high-water growth without a proven
  plateau**, not as a proven leak.
- Framework caches may account for part of the retained high-water mark, but
  the experiment did not establish their exact bound or lower-memory-device
  headroom.

The earlier room-request promise retention and repeated Chat projection work
remain removed. Stable query/entity/cardinality counters provide no evidence
of per-transition React Query growth. The unexplained remainder is native
framework/allocator memory below the available `dumpsys meminfo` and Fabric
trace granularity.

## E. Transition results

Candidate A is the controlled before/baseline. B–D are profile-only after
architectures. Full first-frame and usable distributions follow.

| Candidate/pair | First frame p50 / p90 / p95 / max | Usable p50 / p90 / p95 / max | Settled p95 | Frame p95 / max | Jank p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| A Table -> Chat | 125.07 / 142.59 / 156.94 / 180.53 | 135.49 / 165.50 / 173.52 / 188.41 | 156.99 | 93 / 93 | 18.18% |
| A Media -> Chat | 128.58 / 132.81 / 163.97 / 190.64 | 149.95 / 160.75 / 192.50 / 204.88 | 164.02 | 93 / 93 | 18.18% |
| A Dishes -> Chat | 130.92 / 140.00 / 140.80 / 141.06 | 157.51 / 160.62 / 164.59 / 169.73 | 140.85 | 85 / 93 | 18.18% |
| A Chat -> Dishes | 83.19 / 86.26 / 86.73 / 90.00 | 124.61 / 126.92 / 126.97 / 170.62 | 86.77 | 93 / 101 | 27.27% |
| B Table -> Chat | 89.85 / 96.04 / 143.25 / 143.43 | 106.22 / 125.04 / 162.64 / 165.70 | 143.32 | 53 / 57 | 6.67% |
| B Media -> Chat | 92.40 / 95.91 / 114.67 / 139.51 | 103.83 / 117.41 / 154.77 / 162.42 | 138.58 | 48 / 53 | 12.50% |
| B Dishes -> Chat | 95.97 / 102.20 / 152.03 / 184.65 | 116.19 / 123.29 / 173.47 / 194.37 | 152.07 | 48 / 48 | 12.50% |
| B Chat -> Dishes | 78.17 / 85.27 / 87.12 / 144.84 | 118.42 / 124.60 / 127.21 / 187.12 | 87.17 | 101 / 101 | 27.27% |
| C Table -> Chat | 75.20 / 79.14 / 112.58 / 137.44 | 96.50 / 102.15 / 112.75 / 137.64 | 112.66 | 48 / 48 | 5.88% |
| C Media -> Chat | 77.89 / 81.19 / 81.45 / 91.17 | 79.99 / 97.26 / 108.38 / 108.92 | 81.49 | 53 / 53 | 5.88% |
| C Dishes -> Chat | 82.75 / 88.33 / 148.49 / 156.14 | 108.97 / 114.85 / 152.46 / 156.35 | 148.59 | 53 / 53 | 5.88% |
| C Chat -> Dishes | 100.57 / 104.63 / 107.44 / 172.02 | 144.23 / 151.59 / 154.48 / 210.52 | 107.48 | 117 / 117 | 33.33% |
| D Table -> Chat | 153.21 / 180.02 / 196.35 / 214.76 | 152.62 / 177.22 / 196.36 / 214.77 | 196.37 | 61 / 69 | 30.77% |
| D Media -> Chat | 181.59 / 197.99 / 228.13 / 250.20 | 180.16 / 198.00 / 225.28 / 250.20 | 228.18 | 44 / 44 | 27.27% |
| D Dishes -> Chat | 159.23 / 171.63 / 174.46 / 174.80 | 159.23 / 171.64 / 174.46 / 174.81 | 174.49 | 48 / 53 | 30.00% |
| D Chat -> Dishes | 180.90 / 190.45 / 223.97 / 224.24 | 180.89 / 190.45 / 223.96 / 224.29 | 224.01 | 89 / 105 | 40.00% |

`settled` currently closes with the destination's first-frame marker, while
`usable` includes composer readiness where applicable. React commit durations
were not exported as a separate profile, so no React-commit number is claimed;
Fabric instructions and app-side first-frame/usable spans are the retained
native scheduling evidence.

All 320 official Stage A target presses selected the destination exactly once.
No accepted run contained a blank/mismatched selected pane, crash, ANR or OOM.
The external Google Messages interruption and C's pre-fix ignored press are
retained outside the official result directories rather than silently counted
as performance samples.

## F. Memory results

### Stage A

| Candidate | Start PSS | End PSS | Growth | Start/end whole-screen views | `<= 40 MiB` |
| --- | ---: | ---: | ---: | ---: | --- |
| A | 265,485 KB | 367,157 KB | 101,672 KB / 99.3 MiB | 1,059 / 1,055 | fail |
| B | 262,683 KB | 419,142 KB | 156,459 KB / 152.8 MiB | 1,057 / 1,057 | fail |
| C | 263,918 KB | 377,536 KB | 113,618 KB / 110.9 MiB | 1,173 / 1,173 | fail |
| D | 265,218 KB | 401,999 KB | 136,781 KB / 133.6 MiB | 1,055 / 1,055 | fail |

### Focused room-exit recovery

One focused exit was captured for each candidate. `App exit` is the app trace
span. The 2.8–3.3 second automation value includes UIAutomator dump/polling and
is not presented as user-visible navigation latency.

| Candidate | App exit | Before | Immediate | +10 s | +30 s | +60 s | Before -> +60 s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 93.10 ms | 279,354 KB | 262,846 KB | 259,965 KB | 257,103 KB | 256,923 KB | -22,431 KB |
| B | 94.80 ms | 271,522 KB | 253,886 KB | 250,005 KB | 247,741 KB | 247,305 KB | -24,217 KB |
| C | 91.63 ms | 272,925 KB | 257,523 KB | 254,483 KB | 252,469 KB | 252,077 KB | -20,848 KB |
| D | 74.95 ms | 397,370 KB | 378,026 KB | 375,137 KB | 374,602 KB | 374,200 KB | -23,170 KB |

At +60 seconds the native heap had fallen 15.6–16.2 MiB and Java heap
5.4–7.1 MiB depending on candidate. Exit destroys the retained route tree
(A/D 1,164 -> 938 views; B/C 1,152 -> 926), but this focused recovery does not
erase the much larger Stage A growth or prove a repeated-flow plateau.

Three-block result: **not run — Stage A frame and PSS gates failed.**

Ten-minute micro-soak: **not run — three-block gate was not reached.**

Full 30-minute release matrix: **not run — micro-soak gate was not reached.**

The prior accepted release run remains the broader resilience baseline; this
task intentionally did not repeat that audit.

## G. Correctness regressions

Tested scoped invariants remain green:

- rapid-send reducer/native-composer contract: 14/14, including all 120 A–E
  acknowledgement orders, reverse confirmation, duplicates, identical text,
  stale snapshots, failure/retry, mixed media/text, restart and deletion;
- Memory journey/performance/release-profile tests: 79/79;
- complete Memory hardening suite: 105/105;
- physical one-press selection: 320/320 official Stage A transitions, plus
  C's 5/5 post-fix smoke;
- retained/warm ownership tests cover one host/input, inactive
  pointer/accessibility/focus removal, no inactive player or duplicate
  Realtime owner, room/account boundary reset and exit destruction;
- coordinator tests cover destination-first commit, generation supersession,
  rapid A -> B -> C, exit/background reset and never two interactive panes;
- Dishes remains a bounded clipped `FlatList` with memoized rows and stable
  handlers; no eager `ScrollView` regression;
- the native composer exposes an explicit native blur path, preserves the
  atomic rapid-send capture path, and has one input owner;
- no database schema, persistence, RLS, Storage, authentication, private-media
  or rate-limit contract changed.

The broad functional, offline/outbox, media-viewer and resilience audit was not
repeated because the task explicitly limited physical work to the isolated
performance blockers. Their automated contracts remain green.

## H. Files changed

| File | Purpose |
| --- | --- |
| `mobile/.env.example` | Documents profile-only lifecycle selector values. |
| `mobile/android/app/build.gradle` | Allows shell profiling only in non-production profile builds. |
| `mobile/android/app/src/main/AndroidManifest.xml` | Adds the manifest-placeholder-controlled `profileable` element. |
| `mobile/app.config.js` | Validates lifecycle values and rejects profiling/selector use in production. |
| `mobile/app/memories/[id].tsx` | Implements A–D lifecycle rendering, bounded warm content, transition coordination, immediate request guard, room/account/background/exit cleanup and profile markers. |
| `mobile/modules/keyboard-inset/android/src/main/java/expo/modules/keyboardinset/KeyboardInsetModule.kt` | Exposes native composer blur to JavaScript. |
| `mobile/modules/keyboard-inset/android/src/main/java/expo/modules/keyboardinset/NativeChatInputView.kt` | Clears focus and hides IME ownership on blur. |
| `mobile/src/components/chat/NativeChatInput.tsx` | Adds the typed `blur()` handle. |
| `mobile/src/hooks/useSlideOverScreen.ts` | Keeps reduced-motion transitions at zero duration. |
| `mobile/src/performance/memoryRoomChatLifecycle.ts` | Defines the profile-only selector and generation-safe coordinator state machine. |
| `mobile/src/performance/memoryRoomReleaseProfile.ts` | Adds lifecycle, host/input/shell and room-exit trace markers. |
| `tests/memory-room-release-profile.test.mjs` | Covers selectors, ownership, coordinator cancellation and tree bounds. |
| `tests/mobile-memory-room-jank-memory-validation.mjs` | Captures Fabric work, lifecycle counters, transition distributions and exit +10/+30/+60 memory. |
| `tests/mobile-memory-room-release-fixture.mjs` | Creates/removes a hosted owner-safe rich-room fixture without deleting an existing account. |
| `tests/mobile-performance-phase6.test.mjs` | Enforces profile-gated lifecycle and production cold default. |
| `tests/native-release-phase8.test.mjs` | Enforces the profileable manifest boundary. |
| `tests/shared-memory-phase4-mobile-performance.test.mjs` | Updates active-only/default and profile-candidate ownership contracts. |
| `docs/performance/MEMORY_ROOM_CHAT_LIFECYCLE_EXPERIMENT_2026-07-28.md` | Consolidates implementation and physical evidence. |
| `docs/security/CHAT_PRODUCTION_STATUS.md` | Records the unchanged release rejection and security boundary. |

## I. Gate results

| Gate | Result | Classification |
| --- | --- | --- |
| `npm run test:memory-rapid-send` | 14/14 | pass |
| `npm run test:memory-hardening` | 105/105 | pass |
| `tests/memory-room-journey.test.mjs` | 15/15 | pass |
| `tests/shared-memory-phase4-mobile-performance.test.mjs` | 50/50 | pass |
| `tests/memory-room-release-profile.test.mjs` | 14/14 | pass |
| Root typecheck | pass | pass |
| Mobile typecheck | pass | pass |
| `npm run lint -- --quiet` | pass, zero errors | pass |
| Full `npm test` | 1,765/1,784 | 19 existing non-Memory media-worker/profile/layout contract failures; no focused regression |
| Standard `npx next build` | pass, 96/96 static pages | pass |
| Turbopack build | not rerun | independent environment/compiler blocker, unchanged |
| `git diff --check` | pass | pass |
| Signed minified Hermes APK | four candidates built; R8 map 51,244,900 bytes | pass |
| APK v2 signature verification | all four true; same local performance certificate | pass |
| APK privacy/secret scan | all four passed | pass |
| Physical Stage A | 320/320 accepted presses; zero fatal crash | correctness pass, performance fail |
| Transition-frame budget | every candidate has a 44–117 ms p95 bucket | fail |
| Active-PSS budget | every candidate grows 99.3–152.8 MiB | fail |
| Stage B / three-block / micro-soak / full soak | not run after Stage A failure | correctly gated |
| Hosted fixture cleanup | `CLEANUP_PASS` | pass; room, media and three synthetic users removed |
| Database migration | none | not needed |
| Deployment | none | forbidden while acceptance remains failed |

The 19 full-suite failures are the same branch-level media pipeline,
media-worker, Explore/Profile slide-over/error/layout and review-upload source
contracts present outside this change. The previously stale Memory lifecycle
expectation was updated and now passes.

## J. Evidence

### Candidate reports and Perfetto/atrace

```text
/private/tmp/memory-room-candidates/cold/stage-a/targeted-report.json
/private/tmp/memory-room-candidates/retained-shell/stage-a/targeted-report.json
/private/tmp/memory-room-candidates/warm-bounded/stage-a/targeted-report.json
/private/tmp/memory-room-candidates/precreate/stage-a/targeted-report.json

/private/tmp/memory-room-candidates/<candidate>/stage-a/table-to-chat.atrace.txt
/private/tmp/memory-room-candidates/<candidate>/stage-a/media-to-chat.atrace.txt
/private/tmp/memory-room-candidates/<candidate>/stage-a/dishes-to-chat.atrace.txt
/private/tmp/memory-room-candidates/<candidate>/stage-a/chat-to-dishes.atrace.txt

/private/tmp/memory-room-candidates/<candidate>/exit/targeted-report.json
/private/tmp/memory-room-candidates/<candidate>/exit/room-exit.atrace.txt
```

The pre-fix C failure and excluded external-app interruption are retained under
`warm-bounded/stage-a-stale-guard-failure` and
`warm-bounded/stage-a-interrupted`. The post-fix smoke is under
`warm-bounded/stale-guard-smoke`.

### APKs

| Candidate | Bytes | SHA-256 |
| --- | ---: | --- |
| A | 138,309,116 | `150aeb64062a60c74e22acc5582441672ec657d2063e16cdb0e536de9df1d2cf` |
| B | 138,309,120 | `c87cee11fd038fcafff5be36086a47e43892c30fa59806357a274cc89c4b27ca` |
| C | 138,309,184 | `fdd6ec3aa2754711e73c176f7df3a262a2645ef3eeee11ec934a19884a332220` |
| D | 138,309,184 | `3270f611872209f326492b8f9d09239de5592d91d360a93f55e7765785d3cf54` |

All APKs are minified Hermes releases and pass the repository artifact scan.
All verify with APK Signature Scheme v2 and the local performance certificate
SHA-256
`d534872a4714c00142ede6b5e273995ebd381b21e49ef1767294a1f0a0339bde`.
The profile APK manifest has `profileable android:shell="true"` and is bound to
the non-production `com.circlebites.mobile.dev` identity. Device-upgrade copies
were locally re-signed only to retain the existing authenticated test account.

No heap profile, class dominator report, standalone React profile, or physical
video is claimed because none was successfully retained. `dumpsys meminfo`,
Fabric trace sections, scalar resource/cache counters, signed APKs and raw
transition/exit traces are the available evidence.

Physical target: Motorola edge 70 fusion, Android 16, serial
`ZA223JVWG7`, 1272x2772 at 90 Hz, authenticated as `@phantom`. The requested
lower-memory/moto g57 class and physical iOS target were unavailable.

## K. Production conclusion

```text
Memory Room functional acceptance:              PASS for preserved automated/scoped physical invariants
Memory Room rapid-chat acceptance:              PASS (14/14 focused contract; no regression)
Memory Room Android transition-frame acceptance: FAIL
Memory Room native-memory acceptance:           FAIL
Memory Room resilience acceptance:              NOT ADVANCED; prior broader FAIL remains
Memory Room target-device acceptance:           PARTIAL (connected edge 70 fusion only)
Memory Room iOS acceptance:                     NOT TESTED
Whole-application production release:           FAIL
```

Do not deploy, flip the production selector, or infer beta/production
readiness. The next useful investigation needs class/category native
allocation evidence and a lifecycle design that controls both the source-pane
teardown and the retained/created native tree. It must demonstrate the
three-block plateau and `<= 40 MiB` growth before any broader soak is resumed.
