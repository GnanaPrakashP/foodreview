# Memory Room release performance, soak, and resilience acceptance

Date: 2026-07-28
Implementation commit: `059215408e56a1ba2157a2e54031e98f31181be9`
Branch: `release/mvp-candidate`

## A. Overall result

**FAIL**

The production-like Android artifact remained functionally usable through the
completed directed transition matrix, a 31-minute mixed journey, three real
disconnect/reconnect cycles, and three process-kill recovery cases. There were
zero crashes, ANRs, or OOMs. This is not sufficient for release acceptance:

- active-soak PSS grew from 451,906 KB to 545,109 KB (+93,203 KB / 91.0 MiB)
  without a demonstrated plateau;
- PSS remained 492,663 KB 60 seconds after final exit (+40,757 KB / 39.8 MiB);
- the soak FrameTimeline p95 was 30.14 ms and 34.57% of frames were classified
  as jank;
- `Chat -> Dishes` reported 100% diagnostic jank in all ten repetitions;
- moderate/poor shaped-network runs, pending image/video process-kill recovery,
  the requested moto g57 power, a slower/lower-memory comparison Android
  device, and physical iOS were unavailable;
- per-surface scrolling percentiles and cold/re-entry/room-switch entry
  percentiles were not captured to acceptance quality;
- the Turbopack production build still stalls independently.

The honest answer to the primary acceptance question is therefore **No, not
yet proven smooth and memory-bounded for production**.

## B. Build and device configuration

| Item | Measured configuration |
| --- | --- |
| Source | implementation commit `059215408e56a1ba2157a2e54031e98f31181be9`; physical measurements were made from the identical pre-commit tree based on `e520d04664c3bd6f2b26d6d4f61f26ace4d1d2de` |
| Artifact | signed, minified Android release/profile APK; Hermes; R8/release optimizations; development checks, overlays, journey diagnostics, and remote JS debugging off |
| Safe instrumentation | `EXPO_PUBLIC_PERFORMANCE_PROFILE=1`; content-free Android trace sections and aggregate counters only |
| Package | `com.circlebites.mobile.dev` |
| APK | 138,439,118 bytes; SHA-256 `a9f0b5569547d742e3eb44dd2ef5eed7bdae7cc030793645a2b896f6b9e39329` |
| Signing certificate | `CN=CircleBites Local Performance`; SHA-256 `d534872a4714c00142ede6b5e273995ebd381b21e49ef1767294a1f0a0339bde` |
| Device | physical Motorola Edge 70 Fusion (`ZA223JVWG7`) |
| Target mismatch | requested Motorola moto g57 power was unavailable; the Edge 70 Fusion is a comparison device, not a substitute for the target-device claim |
| Android | 16 |
| Screen | 1272 x 2772 at 90 Hz |
| RAM | 7,649,704 KB (~7.3 GiB), so this is not the required lower-memory comparison |
| Keyboard | Gboard (`com.google.android.inputmethod.latin`) |
| Network | USB reverse to local API/Supabase for normal runs; reverse ports removed and radios disabled for the corrected intermittent-network run |
| Thermal/battery | powered; 30–33 C; Android reported no thermal throttling |
| Missing devices | no slower/lower-memory Android and no physical iOS |

The final APK passed `scripts/scan-release-artifact.mjs`; no forbidden release
configuration or secret pattern was found.

## C. Entry results

One warm room-card entry series was captured after a discarded warm-up:

| Scenario | Samples | First/usable p50 | p90 | p95 | max | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Warm card tap to usable cached Table, native trace | 5 | 158.32 ms | 204.49 ms | 204.49 ms | 204.49 ms | measured |
| Same path measured by host UIAutomator | 5 | 3,111.19 ms | 3,521.58 ms | 3,521.58 ms | 3,521.58 ms | invalid for app latency; includes hierarchy polling |
| Cold launch/auth/Profile/Memories/room | 0 acceptance-quality series | — | — | — | — | **gap** |
| Immediate same-room re-entry | 0 separately classified series | — | — | — | — | **gap** |
| Room A/B/A switching entry | exercised in soak, not separately timed | — | — | — | — | **gap** |
| Server-reconciled state and request/subscription deltas | markers/counters added, distribution not retained | — | — | — | — | **gap** |

No blank or wrong-room frame was accepted by the harness. The harness now
fails closed if the foreground hierarchy belongs to another package.

## D. Complete directed tab matrix

Each directed pair has ten release-profile repetitions. Values written
`a/b/c/d` are p50/p90/p95/max. `Frame p95` is the distribution of the
per-repetition p95 frame bucket; `max frame` is the largest reported frame
bucket. These per-pair frame figures are Android graphics diagnostics paired
with native trace markers, not standalone FrameTimeline acceptance evidence.
The provisional room gate is p95 frame <=20 ms with no sustained high jank.

| Pair | First correct frame ms | Usable ms | Settled ms | Jank % | Frame p95 ms | Max frame ms | Blank/mismatch | Request delta | Mount delta | PSS delta KB | Result |
| --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | ---: | --- |
| Table -> Chat | 189.93/200.32/285.86/285.86 | 343.67/386.77/429.45/429.45 | 189.98/200.37/285.92/285.92 | 21.43/28.57/28.57/28.57 | 53/57/57/57 | 57 | 0/0 | not retained | active-only traced | -25,010 | **FAIL** |
| Table -> Media | 62.14/73.55/85.79/85.79 | 87.12/92.75/126.79/126.79 | 62.19/73.58/85.87/85.87 | 6.25/11.76/15.38/15.38 | 36/40/46/46 | 46 | 0/0 | not retained | active-only traced | -2,453 | **FAIL** |
| Table -> Dishes | 190.02/196.19/210.72/210.72 | 247.50/251.37/261.97/261.97 | 190.03/196.25/210.79/210.79 | 14.29/20/25/25 | 150/150/150/150 | 150 | 0/0 | not retained | active-only traced | +25,495 | **FAIL** |
| Chat -> Table | 111.49/124.37/126.92/126.92 | 111.72/125.17/127.58/127.58 | 111.54/124.42/126.98/126.98 | 5.88/5.88/5.88/5.88 | 46/57/77/77 | 77 | 0/0 | not retained | active-only traced | -11,978 | **FAIL** |
| Chat -> Media | 101.90/107.14/126.02/126.02 | 102.54/107.84/126.71/126.71 | 101.95/107.20/126.07/126.07 | 5.88/11.76/11.76/11.76 | 34/34/46/46 | 46 | 0/0 | not retained | active-only traced | -5,078 | **FAIL** |
| Chat -> Dishes | 232.43/298.78/305.91/305.91 | 232.75/299.12/306.22/306.22 | 232.48/298.84/305.97/305.97 | 100/100/100/100 | 200/200/250/250 | 250 | 0/0 | not retained | active-only traced | +7,935 | **FAIL** |
| Media -> Table | 74.03/86.79/95.57/95.57 | 104.65/113.80/114.16/114.16 | 74.09/86.88/95.63/95.63 | 5.88/6.25/6.67/6.67 | 48/53/57/57 | 57 | 0/0 | not retained | active-only traced | -6,382 | **FAIL** |
| Media -> Chat | 201.72/217.62/348.56/348.56 | 342.00/491.63/496.46/496.46 | 201.78/217.67/348.60/348.60 | 23.08/28.57/28.57/28.57 | 53/57/65/65 | 65 | 0/0 | not retained | active-only traced | -27,070 | **FAIL** |
| Media -> Dishes | 191.17/202.56/343.48/343.48 | 192.35/248.02/343.89/343.89 | 191.23/202.62/343.53/343.53 | 14.29/20/33.33/33.33 | 150/150/150/150 | 150 | 0/0 | not retained | active-only traced | +33,295 | **FAIL** |
| Dishes -> Table | 85.09/91.85/109.37/109.37 | 109.67/119.76/129.18/129.18 | 85.13/91.91/109.45/109.45 | 6.25/6.67/6.67/6.67 | 57/61/69/69 | 69 | 0/0 | not retained | active-only traced | -18,017 | **FAIL** |
| Dishes -> Chat | 215.51/225.35/288.87/288.87 | 362.19/486.93/490.97/490.97 | 215.56/225.39/318.92/318.92 | 21.43/26.67/27.27/27.27 | 57/65/73/73 | 73 | 0/0 | not retained | active-only traced | -9,691 | **FAIL** |
| Dishes -> Media | 74.17/82.37/226.32/226.32 | 94.28/100.86/253.06/253.06 | 74.22/82.43/226.36/226.36 | 6.25/11.76/11.76/11.76 | 40/44/46/46 | 46 | 0/0 | not retained | active-only traced | +15,253 | **FAIL** |

The final harness observed no ignored app presses. Two apparent misses were
attributed to UIAutomator accessibility teardown; a 125 ms measurement guard
was added. Raw 20-cycle Table/Dishes and Chat/Dishes traces then produced all
20 app spans in both directions. An earlier matrix attempt was excluded when
Instagram took the foreground; the retained XML contains only
`com.instagram.android`.

## E. Chat activation breakdown

Aggregate results:

| Pair | First-frame p50/p95 | Composer-usable p50/p95 | Main finding |
| --- | --- | --- | --- |
| Table -> Chat | 189.93/285.86 ms | 343.67/429.45 ms | first frame is delayed; usable completion adds ~154 ms at p50 |
| Media -> Chat | 201.72/348.56 ms | 342.00/496.46 ms | largest p95 usable delay |
| Dishes -> Chat | 215.51/288.87 ms | 362.19/490.97 ms | inactive Dishes teardown overlaps Chat activation |

For a representative Dishes -> Chat trace:

```text
0 ms       tab transition begins
24–26 ms   cached message selection completes (~2 ms section)
202 ms     inactive Dishes unmount marker
204 ms     Chat mount marker
224 ms     first Chat list frame
229 ms     composer-ready point
378 ms     Chat mount/usable transition completes
```

This attributes the dominant delay to the transition/layout window and
inactive-pane teardown overlapping the active mount. Cached message selection
is short, no SQLite/bootstrap marker appears in the sampled activation, and
the composer-ready marker follows the first layout by only a few milliseconds.
The evidence does not identify wallpaper decode, network, or SQLite as the
owner. A React profiler capture was not retained, so row remount/resort cost
remains an instrumentation gap. The correction keeps inactive panes unmounted,
adds bounded logical scroll state, and adds lifecycle/native markers; it does
not hide the delay by retaining all four panes.

## F. Scrolling results

| Surface | Physical behavior seen | Quantitative acceptance |
| --- | --- | --- |
| Table | forward/reverse movement and tab return remained usable; offset restoration implemented | independent slow/fling/reverse FrameTimeline percentiles not retained: **gap** |
| Media | mixed grid, viewer open/close, image swipes, and video sessions completed | cold/warm decode and pagination hitch distributions not retained: **gap** |
| Dishes | scrolling and ten ratings completed during soak | rating-while-fling distribution not retained; transition into Dishes is janky: **FAIL/gap** |
| Chat | recent/history movement, 41 sends, 10 replies, incoming reconciliation, and return from viewer completed | independent older-pagination/keyboard/list-moving frame distributions not retained: **gap** |
| Viewer | ten image opens and five video sessions completed; no crash | open/close latency and graphics-recovery series not retained: **gap** |
| Pagination | fixture supplied 85 messages and 32 images in Room A | separate pagination hitch/request report not retained: **gap** |

The soak-wide Perfetto evidence reports 4,608 FrameTimeline frames, 1,593 jank
frames (34.57%), p50 14.66 ms, p90 23.60 ms, p95 30.14 ms, p99 37.60 ms, and
maximum 209.69 ms. Principal classifications were no jank 65.43%, buffer
stuffing 24.74%, app deadline missed 7.01%, and prediction error 1.17%.
Because per-surface FrameTimeline slices were not retained, no surface receives
a scrolling PASS.

## G. Thirty-minute soak

The continuous run lasted 1,868,872 ms (31.15 minutes):

| Action | Count |
| --- | ---: |
| Room entries / exits | 31 / 32 |
| Tab transitions | 134 |
| Chat sends / replies | 41 / 10 |
| Image viewer opens | 10 |
| Video / audio playback sessions | 5 / 5 |
| Dish ratings | 10 |
| Background/foreground | 10 |
| Valid image/video upload completions | 0 |
| Claimed disconnect/reconnect in original run | 5, excluded because reverse routes remained active |

One synthetic upload reached intent/finalize polling but could not complete
because the local media processor was unavailable. The required five upload
operations therefore remain a blocker.

| Checkpoint | Total PSS KB | Java KB | Native KB | Graphics KB |
| --- | ---: | ---: | ---: | ---: |
| Start | 451,906 | 25,360 | 185,772 | 81,412 |
| Cycle 5 | 481,858 | 36,000 | 195,092 | 77,748 |
| Cycle 10 | 497,757 | 41,240 | 192,440 | 76,252 |
| Cycle 15 | 493,874 | 32,484 | 193,328 | 77,172 |
| Cycle 20 | 527,127 | 42,952 | 209,920 | 76,940 |
| Cycle 25 | 530,390 | 39,788 | 210,808 | 76,560 |
| Cycle 30 | 545,109 | 43,320 | 216,220 | 75,944 |
| Final exit | 508,803 | 36,604 | 183,060 | 77,436 |
| Exit +30 s | 494,723 | 29,772 | 176,024 | 77,436 |
| Exit +60 s | 492,663 | 28,052 | 175,996 | 77,436 |

Active growth was 91.0 MiB, over twice the existing <=40 MiB repeated-flow
budget. Retained growth at 60 seconds was 39.8 MiB, at the budget edge, and the
settled-cycle series did not demonstrate a plateau. Native heap rose during
the active series; graphics memory did not accumulate with viewer use.

There were zero crashes, ANRs, and OOMs. Safe counters showed active players
between zero and three and returned to zero in the captured samples. The
truncated Perfetto window ended mid-room with one Realtime channel, so it
cannot prove the final channel value; source ownership tests cover balanced
cleanup but do not replace physical trace evidence. SQLite queue depth peaked
at seven and returned to zero. Observed maximum durations included write
1,034.68 ms, reconciliation write 1,024.58 ms, local snapshot 437.26 ms, and
server reconcile 1,618.82 ms.

The Perfetto file hit its 512 MiB in-memory cap after approximately 427.56
seconds; the saved compressed trace is 315 MiB with SHA-256
`6537c3b3ec66f9944cc9374ac9d7a6d84bbbf9c93e74a4ffadc81ca7eaa969e5`.
The first-five versus last-five latency comparison, complete request-category
counts, GC trend, decoder ownership timeline, and Hermes-specific heap were
not retained. Soak conclusion: **FAIL — memory plateau and smoothness not
proven**.

## H. Slow-network results

| Mode | Result |
| --- | --- |
| Moderate (about 150 ms / 3–5 Mbps / 1 Mbps) | **not run — blocker** |
| Poor (about 400–600 ms / 0.5–1 Mbps / 0.25–0.5 Mbps) | **not run — blocker** |
| Intermittent/true offline | three cycles passed with reverse routes removed and Wi-Fi/mobile data disabled |
| Reconnect | routes/radios restored; cached tabs and exit remained usable; 18 transitions, 6 sends, 3 replies, 3 ratings, 2 image, 2 video, and 2 audio sessions; zero crash/ANR/OOM |

The corrected offline run proves basic cached continuity and idempotent
recovery on this topology. It does not prove bandwidth-shaped behavior,
request retry/concurrency budgets, pending upload recovery, or the absence of
a reconnect request storm because those aggregates were not retained.

## I. Process-kill recovery

| Case | Result |
| --- | --- |
| Pending text | **PASS**: offline row existed before force-stop; recovery produced exactly one database row |
| Pending reply | **PASS**: exactly one row and reply relationship preserved |
| Ambiguous server success | **PASS**: server row committed before recovery; reconciliation produced one row without duplication |
| Pending image | **not run — blocker** |
| Pending video | **not run — blocker** |
| Account switch while pending | **not run physically — blocker** |

All three completed cases used actual Android force-stop/relaunch and reported
zero fatal process errors.

## J. Accessibility and permissions

TalkBack was enabled on the physical device. A single accessibility
focus-and-double-tap activated Chat once, selected state was exposed, the
composer/recorder remained visible, and the tab bounds measured 147 px at
450 dpi (52.27 dp). Room card labels were distinct:
`Open Release acceptance A room` and `Open Release acceptance B room`.
No duplicate navigation or trapped focus was observed in the exercised path.

This is a partial TalkBack pass, not the complete requested traversal. Large
font, reduced motion, every dish/rating control, every message/reply action,
error announcements, and viewer focus restoration were not exhaustively
recorded.

| Permission case | Physical outcome |
| --- | --- |
| Camera denied | explanation shown; Try again, Open settings, and Choose from gallery available; gallery opened Android Photo Picker |
| Microphone denied | explanation shown; Not now and Open settings available |
| Gallery denied/limited | system Photo Picker remained available without broad library permission; limited-library state not separately run |
| Permanently denied / returned from Settings / revoked after install | Open settings path present; full grant-return-revoke matrix not completed |

No crash or retained camera/recorder owner was observed. TalkBack and temporary
permission state were restored after the pass.

## K. Scroll-position policy

The product policy is **bounded room-session restoration without retaining
inactive native pane trees**:

| Pane | Policy |
| --- | --- |
| Table | preserve one finite content offset |
| Media | preserve one finite grid offset |
| Dishes | preserve one finite list offset |
| Chat | preserve one finite list offset while retaining existing latest/history behavior |

Exactly four numbers are retained per room session. Restoration occurs through
the remounted list's initial offset; no rendered rows, media, players, or
native panes are retained. Non-finite/negative offsets are clamped, and a new
room receives a separate state so Room A cannot affect Room B. Automated tests
cover all four panes and room isolation. Forward/reverse physical returns were
exercised, but a dedicated before/after pixel/index report was not retained;
that is a P3 evidence gap rather than permission to claim a complete physical
scroll-policy PASS.

## L. Findings

### P1 — repeated-flow memory does not plateau

- Symptom: PSS rose 91.0 MiB during the soak and remained 39.8 MiB above the
  start 60 seconds after exit.
- Root cause: not yet isolated; native heap and long-lived warm process state
  contribute, while graphics memory is not the accumulating owner.
- Trigger: repeated Room A/B entry, all four tabs, viewers/players, sends,
  ratings, and background/foreground.
- Trace evidence: soak memory timeline and capped Perfetto trace.
- Affected files: ownership/instrumentation is now visible through
  `mobile/src/performance/memoryRoomReleaseProfile.ts`,
  `mobile/src/hooks/useMemories.ts`, and room player/recorder hooks in
  `mobile/app/memories/[id].tsx`.
- Implemented correction: aggregate player, recorder, Realtime, SQLite, entry,
  transition, viewer, and exit markers; inactive panes remain released.
- Regression test: `tests/memory-room-release-profile.test.mjs`.
- Physical retest: counters are bounded, but PSS still fails; unresolved.

### P2 — Dishes rendering and Chat activation are visibly janky

- Symptom: Chat -> Dishes has 100% diagnostic jank and 200–250 ms frame
  buckets; transitions into Chat have 342–491 ms usable p50/p95 bands.
- Root cause: trace ordering shows inactive-pane teardown/layout overlaps the
  active mount; cached Chat selection is ~2 ms and not the dominant owner.
  Dishes-specific render attribution still needs a focused FrameTimeline/React
  profile.
- Trigger: Chat -> Dishes and Table/Media/Dishes -> Chat.
- Trace evidence: all 12 directed ATrace files and the soak FrameTimeline
  summary.
- Affected files: `mobile/app/memories/[id].tsx` and
  `mobile/src/performance/memoryRoomReleaseProfile.ts`.
- Implemented correction: safe native spans, active-only lifecycle markers,
  correct first-frame/usable/settled points, and UIAutomator-free measurement
  windows.
- Regression test: directed-pair and one-press checks in
  `tests/memory-room-release-profile.test.mjs`.
- Physical retest: all presses transition exactly once, but frame gate still
  fails; unresolved.

### P2 — target/device/network/recovery coverage is incomplete

- Symptom: no moto g57 power, lower-memory Android, iOS, moderate/poor shaping,
  or pending image/video kill result.
- Root cause: unavailable hardware/network shaping and unavailable local media
  processor for completed upload operations.
- Trigger: release matrix requirements.
- Trace evidence: absent required reports; corrected intermittent report is
  retained separately.
- Affected files: physical harnesses under `tests/mobile-memory-room-*`.
- Implemented correction: reproducible fixture, disconnect, matrix checkpoint,
  and process-kill harnesses.
- Regression test: harness structure is statically covered by the release
  profile suite.
- Physical retest: intermittent and text/reply/ambiguous cases pass; remaining
  cases are blockers.

### P3 — UIAutomator teardown can manufacture a dropped injected tap

- Symptom: a hierarchy dump followed immediately by `adb input tap` could
  appear as a missed transition.
- Root cause: UIAutomator briefly owns the Android accessibility connection.
- Trigger: automated measurement only, not raw user/app presses.
- Trace evidence: two diagnostic misses versus complete raw 20-cycle traces.
- Affected file: `tests/mobile-memory-room-release-runtime-validation.mjs`.
- Implemented correction: 125 ms teardown guard outside the measured window,
  selected-tab assertion, and per-pair checkpoints.
- Regression test: one press/one transition and foreground-package checks.
- Physical retest: final 120 transitions completed with no ignored press.

### P3 — permission and accessibility recovery labels were incomplete

- Symptom: camera denial lacked a gallery escape, microphone denial lacked
  explicit defer/settings actions, room card labels were ambiguous, and
  physical tab height was initially clipped.
- Root cause: missing recovery actions and insufficient expanded-header height.
- Trigger: denied permission and TalkBack traversal.
- Trace evidence: final UI hierarchy XMLs.
- Affected files: `mobile/src/components/memories/camera/CameraScreen.tsx`,
  `mobile/app/memories/[id].tsx`, and `mobile/app/(tabs)/profile.tsx`.
- Implemented correction: gallery/settings/defer paths, room-specific labels,
  52 dp tab controls, and a 190 dp expanded header.
- Regression test: accessibility/permission assertions in
  `tests/memory-room-release-profile.test.mjs`.
- Physical retest: exercised paths pass.

### P3 — Turbopack build worker stalls

- Symptom: `npm run build` remained at “Creating an optimized production
  build ...” for over six minutes in the repository and for more than one/two
  minutes in isolated Node 26/Node 20 clean-cache reproductions, with no
  further compiler output.
- Root cause classification: reproducible environment/compiler worker wait;
  not tied to Memory Room runtime. The first repository run overlapped a Next
  dev server sharing `.next`, which contaminated that run, but a detached
  worktree with copied dependencies and a fresh `.next` reproduced the wait.
  Switching Node 26.0.0 to Node 20.20.2 did not resolve it. Exact upstream
  cause remains unresolved.
- Trigger: Next 15.5.20 `next build --turbopack` on macOS 26.4.1 with Node
  26.0.0 or Node 20.20.2.
- Trace evidence: process tree showed parent and worker at 0% CPU; worker RSS
  ~944–977 MB; sample showed Node event loop, libuv workers, and all
  next-swc/Tokio workers waiting; log remained 229 bytes.
- Affected command: package `build` script; no Memory Room file was identified
  as the cause.
- Implemented correction: none; the stalled process was terminated after
  evidence capture.
- Regression test: standard `npx next build` passes; isolated clean-cache
  Turbopack reproduces on both available Node runtimes.
- Physical retest: not applicable; Turbopack remains blocked.

## M. Gate results

| Gate | Result | Classification |
| --- | --- | --- |
| `npm run test:memory-rapid-send` | 14/14 pass | pass |
| `npm run test:memory-hardening` | 105/105 pass after updating the intentional 183 -> 190 header assertion | introduced stale assertion fixed |
| `node --test tests/memory-room-journey.test.mjs` | 15/15 pass | pass |
| `node --test tests/shared-memory-phase4-mobile-performance.test.mjs` | 50/50 pass | pass |
| release-profile + cache/durable focused set | 27/27 pass | pass |
| root `npm run typecheck` | pass | pass |
| mobile `npm run typecheck` | pass | pass |
| `npm run lint -- --quiet` | pass | pass |
| signed Android release/profile APK | pass | pass |
| APK privacy/secret scan | pass, 138,439,118 bytes, expected SHA-256 | pass |
| local Supabase `db push --local` | `Local database is up to date.` | pass; no new persistence migration |
| `npm test` | 1,754/1,774 pass; 20 fail | 20 real pre-existing/stale branch defects; two profiler mock regressions from the first run were fixed and the complete-suite rerun confirms they are green |
| `npx next build` | pass, 96 static pages generated | pass |
| `npm run build` | stalls with idle Turbopack worker | environment/compiler blocker |
| `git diff --check` | pass | pass |

The 20 remaining root-suite failures cover pre-existing media worker/import
harness drift and stale route/UI source assertions already present on the
branch. They were not edited because the requested policy forbids changing
unrelated assertions merely to make totals green. There are no known
introduced test failures after the two SQLite profiler mocks were added.

External validation gaps: requested Android target, lower-memory comparison,
physical iOS, bandwidth-shaped network, pending-media kill recovery, completed
soak uploads, full TalkBack/large-font/reduced-motion matrix, and hosted/CI
Turbopack reproduction.

## N. Evidence

Primary local evidence:

- final matrix/report:
  `/private/tmp/memory-room-release-final-matrix-rerun/release-runtime-report.json`
- all 12 ATrace files:
  `/private/tmp/memory-room-release-final-matrix-rerun/directed-tab-*.atrace.txt`
- raw 20-cycle controls:
  `/private/tmp/memory-room-release-final-matrix-rerun/manual-table-dishes-20-corrected.atrace.txt`
  and
  `/private/tmp/memory-room-release-final-matrix-rerun/manual-chat-dishes-20.atrace.txt`
- excluded external foreground:
  `/private/tmp/memory-room-release-final-matrix/failure-media-to-table.xml`
- soak report:
  `/private/tmp/memory-room-release-acceptance/release-runtime-report.json`
- soak trace:
  `/private/tmp/memory-room-release-acceptance/memory-room-soak.perfetto-trace`
- corrected intermittent-network report:
  `/private/tmp/memory-room-release-resilience/release-runtime-report.json`
- process-kill report:
  `/private/tmp/memory-room-release-process-kill/process-kill-report.json`
- final room/TalkBack hierarchies:
  `/private/tmp/memory-room-release-acceptance/accessibility-permissions/final190-room.xml`
  and
  `/private/tmp/memory-room-release-acceptance/accessibility-permissions/final190-talkback-chat2.xml`
- permission hierarchies:
  `/private/tmp/memory-room-release-acceptance/accessibility-permissions/final-camera-denied.xml`,
  `/private/tmp/memory-room-release-acceptance/accessibility-permissions/final-gallery-picker.xml`,
  and
  `/private/tmp/memory-room-release-acceptance/accessibility-permissions/final-mic-denied.xml`
- build logs:
  `/private/tmp/foodreview-next-default-build.log`,
  `/private/tmp/foodreview-turbopack-build.log`, and
  `/private/tmp/foodreview-turbopack-clean-build.log`,
  `/private/tmp/foodreview-turbopack-node20-build.log`, and
  `/private/tmp/foodreview-npm-test-final.log`
- Turbopack process sample:
  `/tmp/node_2026-07-28_035811_A8LH.sample.txt`

No broad screen recording or contact sheet was retained. UI XML, aggregate
reports, and trace marker names contain no message bodies, room/user IDs,
tokens, signed URLs, or media paths. Disposable Supabase fixture rows and the
five synthetic device images were removed after validation.

## O. Production conclusion

```text
Memory Room functional acceptance: PASS on the previously committed complete
journey baseline; the scoped rapid-send/journey regressions remain green.

Memory Room Android release-performance acceptance: FAIL. Production-like
artifact and all 12 directed pairs were measured, but frame/jank gates fail and
the requested target/lower-memory devices are missing.

Memory Room memory-boundedness acceptance: FAIL. Active PSS grew 91.0 MiB and
did not demonstrate a stable warm-cache plateau.

Memory Room slow-network/recovery acceptance: PASS WITH BLOCKERS. Three real
offline/reconnect cycles and text/reply/ambiguous process kills pass; shaped
moderate/poor networks and pending image/video recovery are missing.

Memory Room accessibility acceptance: PASS WITH BLOCKERS. The exercised
TalkBack activation, target sizing, labels, and camera/microphone denial paths
pass; the complete accessibility/large-font/reduced-motion matrix is missing.

Memory Room iOS acceptance: NOT TESTED / BLOCKED.

Whole-application production release: FAIL. Runtime memory/jank, missing
device/network/media-recovery evidence, 20 pre-existing root-suite failures,
and the independent Turbopack stall remain open.
```
