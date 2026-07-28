# Memory Room Chat renderer experiment — 2026-07-28

## A. Result

**FAIL**

The Chat tree was materially flattened behind a non-production profile
selector and three list paths were compared with the same 50-message,
plain-text cached room on one authenticated physical Motorola edge 70 fusion.
All three candidates missed the reviewed 20 ms frame-p95 gate:

| Candidate | Table -> Chat frame p95 | Active PSS delta | Result |
| --- | ---: | ---: | --- |
| Vendored AnimatedFlatList | 77 ms | +30.1 MiB | reject: frame |
| Lightweight direct FlatList | 46 ms | +65.5 MiB | reject: frame and memory |
| Lightweight FlashList | 73 ms | +35.1 MiB | reject: frame and one ignored exit press |

The direct FlatList cut Chat-entry native-view creation from 289 to 127 and
the FlashList cut it to 115. That is a real tree reduction, but it did not make
the first Chat frame smooth. FlashList also ignored one physical Chat -> Table
press in its first block; a clean retry then completed 50/50.

Stage A therefore failed. Per the experiment order, replies/delivery expansion,
media/audio rows, stable-host selection, three-block plateau, ten-minute soak
and full acceptance were not run. Production remains on the cold, active-only
vendored renderer. The selector is ignored without
`EXPO_PUBLIC_PERFORMANCE_PROFILE=1` and rejected for production configuration.

Primary acceptance answer: **No.** The prototype proves that ordinary rows can
be much smaller, but no React Native candidate yet combines smooth activation,
bounded memory and reliable one-press switching.

## B. Original tree versus redesigned tree

### Original production tree

The actual list is the vendored Chat `AnimatedFlatList`, backed by React
Native `FlatList`. A common plain row follows this path:

```text
MemoryChatMainSurface
└── native keyboard-inset host
    ├── messages layer
    │   └── Chat
    │       └── MessagesContainer
    │           └── AnimatedFlatList
    │               └── Item (memo)
    │                   ├── day wrapper
    │                   └── MemoryChatPlacementRow
    │                       ├── diagnostic probe
    │                       └── Message
    │                           ├── full-width reply GestureDetector
    │                           ├── Reanimated swipe content
    │                           └── row-position container
    │                               └── Bubble
    │                                   └── ReactionsBubble
    │                                       ├── scale shared value/state
    │                                       ├── animated container
    │                                       ├── Pressable
    │                                       ├── animated scale wrapper
    │                                       └── bubble wrapper
    │                                           ├── optional tail/sender
    │                                           ├── custom message text
    │                                           │   ├── body Text
    │                                           │   ├── inline spacer
    │                                           │   └── pinned timestamp Text
    │                                           └── vendor bottom metadata
    │                                               ├── Time View/Text
    │                                               └── optional tick View/Text
    └── active-only native composer/input
```

The action menu is rendered by one screen-level host, but each vendored row
still creates the reaction/action publisher component, state, refs, callbacks,
shared scale value, swipe shared value, animated style and gesture definition.
The custom inline timestamp does not prevent the hidden vendor bottom
Time/status subtree from mounting.

Source-derived ordinary-row lower bounds are 19 native View/Text hosts for a
grouped incoming row and 21 for a sent outgoing row. A sender/tail group start
adds up to five SVG/View/Text hosts. Android can flatten some layout-only Views,
so these are topology counts, not a claim that every React host survives native
flattening. The physical whole-Chat measurement is definitive: a 29-row window
changed the activity from 986 to 1,530 Views and created 289 native views at
Chat activation.

### Lightweight prototype tree

```text
MemoryChatMainSurface
└── messages layer
    └── direct FlatList or FlashList
        └── LiteChatTextRow (memo)
            ├── diagnostic probe (no native host)
            ├── one reply GestureDetector
            └── one Pressable bubble
                ├── optional tail
                ├── optional sender Text
                ├── optional bounded reply preview
                └── one body Text
                    └── inline timestamp/delivery Text span

screen root
└── one lazy action-menu host
```

A grouped ordinary prototype row has three principal native hosts; a
sender/tail group start has up to five. It has one gesture owner, no per-row
menu, no Reanimated row wrapper/shared value, no hidden vendor Time/tick tree
and no full domain message prop. Physical Chat activation created 127 native
views for direct FlatList and 115 for FlashList.

### Variant inventory

The table describes source topology. Only the plain-text rows were physically
accepted in Stage A.

| Row | Original incremental machinery | Lightweight status |
| --- | --- | --- |
| Incoming text | base tree; optional sender/tail | implemented; 3–5 principal hosts |
| Outgoing text | base tree plus hidden vendor tick subtree | implemented; delivery mark is inline |
| Reply | base tree plus reply View, two Text nodes and optional Image | bounded preview model implemented; prototype render supported |
| Multiline | same hosts; extra text-layout lines and measurement callbacks | same fast row; wrapping visually verified only in unit/source gates |
| Image | base tree plus Pressable/preview/Image | explicit `visual-media` model; renderer intentionally falls back |
| Video | base tree plus cached poster/preview | explicit `visual-media` model; renderer intentionally falls back |
| Voice | base tree plus an eagerly created visible-row audio player and controls | explicit `audio` model; renderer intentionally falls back |
| Failed/pending | base row; failed row adds retry/cancel controls | inline pending/retrying marker; failed-only controls implemented |
| Selected | selection style on outer row; per-row action machinery still present | outer selected style only; screen owns selection/action state |

React-component and host-node counts for rich variants were not promoted to
physical results because Stage A failed before those variants were enabled.
No Reanimated or gesture class-heap dominator result is claimed.

## C. List-engine comparison

All paths were inverted, retained canonical keys, restored captured offsets,
used `maintainVisibleContentPosition`, kept the existing composer/keyboard
boundary and read the same room-owned projection.

| Property | Vendored current | Direct FlatList | FlashList |
| --- | --- | --- | --- |
| Engine | Animated RN FlatList | RN FlatList | FlashList recycler |
| Initial/batch/window | 8 / 6 / 3 | 10 / 6 / 3 | 720 px draw distance |
| Android clipping | yes | yes | recycler-owned |
| Stable item types | no | key only | explicit `getItemType` |
| Native row recycling | unmount/recreate | unmount/recreate | compatible-cell recycling |
| Mounted text rows max | 29 | 29 | 39 |
| Native views before -> Chat | 986 -> 1,530 | 986 -> 1,139 | 986 -> 1,187 |
| Fabric insert p95 | 277 | 68 | 103 |
| Fabric layout p95 | 284 | 71 | 0 observed mount instructions |
| Native views created p95 | 289 | 127 | 115 |
| First-frame p95 | 171.62 ms | 98.59 ms | 182.23 ms |
| Composer-usable p95 | 384.31 ms | 170.04 ms | 183.87 ms |
| Frame p50 / p90 / p95 / max | 53 / 65 / 77 / 81 ms | 40 / 44 / 46 / 61 ms | 46 / 69 / 73 / 73 ms |
| Jank p95 | 23.53% | 33.33% | 23.08% |
| Table-before -> Chat-after PSS | +30.1 MiB | +65.5 MiB | +35.1 MiB |
| Native-heap delta | +18.3 MiB | +43.3 MiB | +18.5 MiB |
| One-press result | 50/50 | 50/50 | one failed block, then 50/50 |
| Decision | production control; reject | reject | reject |

Direct FlatList is the best frame candidate and materially reduces Fabric
work, but its repeated block grows primarily in native heap. FlashList is the
best memory/lightest-view candidate, but it creates a larger 39-row render
window, has slower first-frame results and produced the one ignored exit.

A native recycler was considered but not implemented: Stage A proves the RN
row can be reduced, while the task requires exhausting the simplified RN
paths before accepting native list ownership. It remains the next escalation,
not an unmeasured claim.

## D. Row-type architecture

The room-owned `MemoryChatRowModelStore` projects these stable item types:

```text
incoming-text
outgoing-text
incoming-reply-text
outgoing-reply-text
visual-media
audio
dish
date
unread
system
```

Each view model contains canonical key/logical identity, direction, flattened
body, preformatted timestamp, delivery state, bounded reply/media metadata and
grouping flags. It contains no room object, mutation/query object, complete
referenced message or render-time user/reply lookup.

The cache returns the same object for every unchanged row. Delivery changes
replace one row; an incoming insertion preserves existing identities and may
change only grouping neighbours. Dates and display labels are projected before
row render.

The profile prototype renders text/reply/date/unread/system rows. It detects
media/audio/dish rows and falls back to the production renderer. This
fail-closed boundary is intentional because Stage A did not authorize Stage C.

## E. Chat activation results

The controlled fixture had exactly 50 cached single-line messages and no
table, dish, media, audio or reply data. Each candidate used a signed, minified
Hermes release/profile APK and performed 50 accepted Table -> Chat activations.

The settled FlashList viewport was visually full with messages 39–50 and the
composer; no empty batch gap was visible. A frame-by-frame recording was not
captured, so first-usable-frame completeness is not promoted to a pass.

Media -> Chat and Dishes -> Chat were not run. Stage A failed on the isolated
plain-text Table -> Chat path, and continuing to the broader matrix would have
violated the explicit stop gate.

React commit and cached-return network deltas were not separately instrumented
in this Stage A harness. Fabric instructions, native views, app-scoped trace
markers, `gfxinfo`, resource counters and `dumpsys meminfo` were captured.

## F. Chat exit results

Each successful 50-activation block also required 50 physical returns to
Table. Vendored and direct FlatList completed all returns with one press.
FlashList failed one Chat -> Table selected-state assertion in its first block;
after discarding the incomplete trace it completed a clean 50/50 retry.

Chat -> Media and Chat -> Dishes were not run because the candidate gate had
already failed. Room-exit +10/+30/+60-second recovery and the six-pair
30-repetition matrix are later-stage evidence and are intentionally absent.

## G. Memory attribution

The 50-cycle comparison identifies different failure owners:

| Candidate | Measured owner |
| --- | --- |
| Vendored | 289 created native views and 277/284 insert/layout instructions from the wrapper/action/gesture/text-metadata tree |
| Direct FlatList | +43.3 MiB native heap across Table-before -> Chat-after despite only 127 created native views; native allocator/Fabric row churn dominates |
| FlashList | 39 mounted rows, 115 created native views and a 201-View active-tree delta; active graphics/render backing remains large |

A matched, post-run FlashList Table -> Chat checkpoint showed:

| Category | Table | Chat | Delta |
| --- | ---: | ---: | ---: |
| Total PSS | 321,338 KB | 351,355 KB | +30,017 KB |
| Native Heap PSS | 119,769 KB | 123,861 KB | +4,092 KB |
| Java Heap PSS | 25,368 KB | 31,956 KB | +6,588 KB |
| Graphics PSS | 60,944 KB | 80,624 KB | +19,680 KB |
| Views | 986 | 1,187 | +201 |
| Native bitmap allocation total | 36,763 KB | 49,831 KB | +13,068 KB |

This single checkpoint is active ownership, not leak growth. Across 50
activations, FlashList's Table-before -> Chat-after native heap grew 18.5 MiB.
FlatList's corresponding 43.3 MiB native-heap growth is the clearest failed
allocator high-water result.

The app trace retained all entries without wrap:

```text
vendor          262,368 / 262,368
lite-flatlist   169,154 / 169,154
lite-flashlist  199,070 / 199,070
```

No extra player or Realtime owner was present. Java class dominators,
`heapprofd` native call stacks, Yoga/text/gesture class dominators and Hermes
heap dominators were not collected after the Stage A rejection, so the report
does not claim a class-level retained leak. The evidence supports cold
Fabric/text/gesture/composer construction plus graphics/native allocator
high-water; it does not prove that every byte is permanently retained.

## H. Memory plateau

**Not run — Stage A failed.**

There is no three-block plateau, +60-second block recovery, ten-minute
micro-soak or full 30-minute result for a selected renderer. Running those
after all candidates missed the frame gate would contradict the required gate
order. Native-view/text-row maxima were bounded inside each completed Stage A
block, but that is not a plateau pass.

## I. Correctness regression status

| Invariant | Evidence/status |
| --- | --- |
| Stable canonical keys and row identity | automated projection tests pass |
| One-row delivery update | automated identity test passes |
| Incoming insertion/group neighbour stability | automated identity test passes |
| Bounded reply preview/no full message | automated test passes |
| Rapid A–E, identical messages, reconciliation | 14/14 automated rapid-send gate passes |
| Offline/outbox, stale refresh, room isolation | hardening/journey gates pass |
| One input/host/channel | profile/resource tests and traces pass |
| Full visible settled viewport | physically observed on FlashList |
| One press -> one transition | vendor/FlatList pass; FlashList has one rejected exit block |
| Physical rapid send on lightweight renderer | not run; Stage A failed |
| Reply/edit/delete/selection physical behaviour | not run on prototype |
| Media/audio/pagination physical behaviour | not run on prototype |
| Scroll/keyboard/multiline physical matrix | not run on prototype |
| Authentication/RLS/private media/rate limits | unchanged; 105/105 hardening gate passes |

Production behavior is unchanged because the vendored renderer remains the
default. No schema, migration, RLS, Storage, authentication, private-media,
rate-limit, outbox or persistence contract changed.

## J. Files changed

| File | Purpose |
| --- | --- |
| `mobile/src/features/memories/chat/memoryChatRowModel.ts` | stable, lightweight room-owned row projection |
| `mobile/src/performance/memoryRoomChatRenderer.ts` | profile-only renderer selector with vendored default |
| `mobile/app/memories/[id].tsx` | plain-text fast row, lazy actions, direct FlatList/FlashList candidates and counters |
| `mobile/src/performance/memoryRoomReleaseProfile.ts` | renderer and row/gesture resource counters |
| `mobile/app.config.js` | selector validation and production rejection |
| `mobile/.env.example` | documented profile selector |
| `tests/memory-room-release-profile.test.mjs` | row identity/tree/list/selector contracts |
| `tests/shared-memory-phase4-mobile-performance.test.mjs` | production fallback topology contract |
| `tests/mobile-memory-room-jank-memory-validation.mjs` | candidate labels, row counters and bounded app-scoped 50-cycle tracing |
| `tests/mobile-memory-room-release-fixture.mjs` | exact 50-message plain-text fixture profile |
| `docs/performance/memory-room-chat-renderer-stage-a-2026-07-28.json` | machine-readable Stage A evidence |
| `docs/performance/MEMORY_ROOM_CHAT_RENDERER_EXPERIMENT_2026-07-28.md` | this report |
| `docs/security/CHAT_PRODUCTION_STATUS.md` | release/security status update |

## K. Gate results

| Gate | Result |
| --- | --- |
| `npm run test:memory-rapid-send` | 14/14 pass |
| `npm run test:memory-hardening` | 105/105 pass |
| `node --test tests/memory-room-journey.test.mjs` | 15/15 pass |
| `node --test tests/shared-memory-phase4-mobile-performance.test.mjs` | 50/50 pass |
| `node --test tests/memory-room-release-profile.test.mjs` | 20/20 pass |
| root typecheck | pass |
| mobile typecheck | pass |
| `npm run lint -- --quiet` | pass |
| `npx next build` | pass |
| signed minified Hermes profile APKs | 3/3 build pass |
| release artifact privacy/secret scan | 3/3 pass |
| APK signature verification | pass; local performance certificate |
| `git diff --check` | pass |
| full `npm test` | 1,771/1,790 pass; 19 existing non-Chat branch failures |

The 19 full-suite failures are in pre-existing post-media worker/contracts,
profile/safe-area UI contracts and review-media production-hardening checks.
No Memory Room/Chat-focused test fails. They remain whole-application release
blockers and were not rewritten as part of this experiment.

The three archived performance APK SHA-256 values and exact physical metrics
are in `memory-room-chat-renderer-stage-a-2026-07-28.json`. All used certificate
SHA-256
`d534872a4714c00142ede6b5e273995ebd381b21e49ef1767294a1f0a0339bde`.

## L. Production conclusion

```text
Memory Room functional acceptance:            PASS for unchanged production path
Memory Room rapid-chat acceptance:            PASS automated; prototype physical matrix not run
Memory Room Chat transition acceptance:       FAIL
Memory Room native-memory acceptance:         FAIL (no selected candidate/plateau)
Memory Room resilience acceptance:            FAIL (FlashList ignored one exit press; later stages not run)
Memory Room target-device acceptance:         FAIL on Motorola edge 70 fusion
Memory Room iOS acceptance:                   NOT TESTED
Whole-application production release:         FAIL
```

The next justified experiment is narrower than another lifecycle toggle:

1. reduce the first FlashList window/draw distance without showing batch fill;
2. remove or consolidate more text/layout hosts in the shared shell/composer;
3. profile the direct FlatList native-heap call stacks with `heapprofd`;
4. if RN still cannot reach the frame gate, implement a small native recycler
   host while retaining the proven native composer and canonical JS row store.

No deployment or Supabase migration is warranted from this failed experiment.
