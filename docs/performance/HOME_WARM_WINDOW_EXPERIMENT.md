# Home Warm-Window Experiment

Follow-up to [HOME_POSTCARD_SCROLL_MOUNT_FINDINGS.md](./HOME_POSTCARD_SCROLL_MOUNT_FINDINGS.md). Tests the single warm-window lever: give the production `FlatList` a wider render window so complete PostCards mount before the gesture reaches them, and measure whether any full-row mounts still land inside a drag or momentum phase.

## What this mode changes — and what it does not

Enabled, the Home feed runs with exactly one production difference: `windowSize` rises from 5 to the configured value (default 9; FlatList measures this in viewport lengths, centered on the visible region, so 9 ≈ four viewports warmed each side). Everything else is production-identical:

- normal `FlatList`, complete real `PostCard` rows — no shells, no premount, no recycling;
- one canonical data array, exact item geometry, no spacers;
- `initialNumToRender: 4`, `maxToRenderPerBatch: 4`, `updateCellsBatchingPeriod: 50` unchanged, so batch amplitude is not inflated;
- pagination, refresh, and the media priority/prefetch lifecycle untouched.

Instrumentation adds no views to the row tree; it rides the existing `PostFeedRow` mount effect.

## How to run

```bash
EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC=warm-window npx expo start
# optional window sweep (integer 5–21, default 9):
EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC=warm-window EXPO_PUBLIC_HOME_WARM_WINDOW_SIZE=7 npx expo start
```

Dev builds only (`__DEV__`-gated). Run on a physical device.

## What is measured

Every logical row mount/unmount is tagged with the scroll phase at that instant — `drag`, `momentum`, or `idle` (programmatic scroll-to-top counts as momentum). Log channels:

- `CB_HOME_WARM_WINDOW_BEGIN` — active list config.
- `CB_HOME_WARM_WINDOW_ROW_MOUNT` — postId, phase, running per-phase counters, `sinceFeedMountMs` (startup fill timeline).
- `CB_HOME_WARM_WINDOW_ROW_UNMOUNT` — postId, phase, `unmountsDuringGesture` (reverse-scroll eviction signal).
- `CB_HOME_WARM_WINDOW_SCROLL_BEGIN` / `CB_HOME_WARM_WINDOW_SCROLL_SETTLED` — per-gesture summary: direction, `gestureMountsThisScroll`, cumulative counters, live row count.

The on-screen badge shows `WARM w<N> · IDLE <idle mounts> · GESTURE <drag+momentum mounts>` and turns green while the gesture-mount count is zero. The badge only updates while idle or at settle, so the observer adds no JS work inside the gesture being measured.

## Protocol

1. Cold start; let the feed load and sit idle a few seconds (window fill happens here — watch `sinceFeedMountMs`).
2. Slow forward scroll through the first page at normal browse cadence.
3. Reverse scroll back to top.
4. Fast fling forward across at least one pagination boundary.
5. Reverse fling to top; scroll-to-top via tab press.
6. Record: perceptible bump (yes/no), gesture-mount counts per scroll, frame stats from the existing measurement harness, `feed.first_content` startup sample, device memory after multiple pages (Xcode Instruments / Perfetto).
7. Sweep `windowSize` 7 / 9 / 13 if the default is ambiguous.

## Decision rule

- **Pass** (no perceptible bump; warmed-range rows mount only while idle at normal cadence; startup and memory acceptable): the minimal production solution is a windowSize change plus whatever bounds validation demands — no second lever needed.
- **Fail** (complete rows still mount during drag/momentum at normal cadence and the bump persists): run selective deferred mounting as a separate second experiment. Do not combine the two changes in one run; attribution is the point.

Known limits going in: FlatList has no idle-only mount gate, so flings can always force some mid-gesture mounts — the phase tags exist to show whether those occur at normal cadence or only under deliberate abuse; and the window is symmetric, so forward warming cannot be biased without custom virtualization (the behind-viewport retention this buys is what the reverse-scroll steps evaluate).

## Run 1 — 2026-07-20, Android device ZA223JVWG7, windowSize 9

User-perceived result: bump still present. Phase-tagged logs from the run (partial; logcat buffer rotated before full capture — pipe `adb logcat | grep CB_HOME_WARM_WINDOW` to a file on future runs):

- **Idle warming worked, but only to the window's forward reach.** At scroll begin, 5 rows were live, all idle-mounted — exactly visible + ~4 forward viewports, the most a centered windowSize 9 can warm at the top of the list.
- **Zero mounts during finger-down drag** across the captured run (`mountsDuringDrag: 0`).
- **A forward fling defeated the window.** One gesture produced 5 full-PostCard momentum-phase mounts and 7 momentum-phase unmounts. Worse, the same posts churned at the window boundary: post `8b72b3e6…` mounted at ~13.9s, unmounted at ~14.6s, re-mounted at ~14.8s within the same gesture; post `35ed6844…` likewise unmounted then re-mounted seconds later. This matches VirtualizedList's velocity-based render-ahead shrink: during fast scroll it contracts the effective window, evicting boundary rows, then re-expands — so a wider window not only fails to prevent fling mounts, it pays some full-card mounts twice plus mid-gesture teardown work.

Structural conclusions (now evidence, not speculation): on stock FlatList the warm window is centered (forward reach is half the configured size), fill is reactive rather than idle-scheduled, and the velocity-dependent window contraction is internal with no public knob. A `windowSize` increase alone therefore cannot deliver "no full-card mounts during momentum" for flings, and adds boundary churn.

Open before final verdict on this lever: whether slow, normal-cadence scrolling (scroll–dwell–scroll, no fling) is bump-free — drag-phase mounts were zero, so the lever may still hold at browsing cadence and fail only under flings. That distinction decides whether windowSize stays as a component of the fix while the second experiment (selective deferred mounting) addresses the fling path.

**Run 1 user verdict:** slow scrolling was smooth; the bump occurred only when flinging. windowSize 9 survives as a component. The remaining problem is momentum-phase full-card mounts, addressed by experiment 2 below.

## Experiment 2 — deferred chrome for momentum mounts (`warm-window-deferred`)

Layered on the w9 warm window so the delta against Run 1 is attributable to exactly one new variable: **rows that mount mid-gesture render cheap exact-geometry chrome and hydrate after the scroll settles.** Rows that mount while idle render the full card, unchanged.

Mechanics:

- The mount-time decision is made once per row: gesture-phase mount → deferred profile; idle mount → full card. This also makes Run 1's boundary-churn remounts cheap.
- Deferred sections reuse the recycling diagnostic's exact-geometry placeholders (real container styles, fixed `HOME_MEDIA_ASPECT_RATIO` media frame). Content (caption/dishes/tags) is **never** deferred — it drives row height. Feedback is never deferred on private posts, where the real section renders nothing.
- Profiles via `EXPO_PUBLIC_HOME_DEFER_PROFILE`: `chrome` (actions + feedback) and `chrome-header` (actions + feedback + header). The real media subtree is always mounted; deferring it produced a visible card-colour surface until the idle hydration queue ran.
- Hydration: after settle, one row per 120 ms, most recently mounted first (nearest the stopping point), only while idle; a new gesture cancels the chain and the next settle restarts it.

Run with:

```bash
EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC=warm-window-deferred npx expo start
# optional: EXPO_PUBLIC_HOME_DEFER_PROFILE=chrome | chrome-header
```

New log channels: `CB_HOME_WARM_DEFER_ROW_MOUNT` (postId, phase, running counts) and `CB_HOME_WARM_DEFER_HYDRATE` (postId, msSinceMount, phase — must always be `idle`, pending count). `CB_HOME_WARM_WINDOW_SCROLL_SETTLED` now includes `deferredMounts`, `deferredPending`, `hydratedRows`. Badge: `WARM w9 · FULL@GESTURE n · DEF d · HYD h · PEND p` — green while no *full* card has mounted inside a gesture.

Decision rule: pass = fling with no perceptible bump, `FULL@GESTURE` stays 0, hydrations all idle-phase, and the placeholder-to-real swap is not visually jarring at the stopping row. Watch specifically for: hydration popping (priced-in cost — judge severity on device), scroll-position shifts at hydration (would indicate a geometry mismatch in a placeholder), and re-bump at settle (hydration burst too aggressive — the 120 ms stagger may need widening).

## Run 2 — 2026-07-20, device ZA223JVWG7, w9 + chrome-media deferral

User-perceived result: **markedly less bump than warm-window alone.** Full session log captured (229 lines).

The mechanism worked without a single miss:

- 41 gesture-phase row mounts across the session — **all 41 deferred** (`FULL@GESTURE` = 0 the whole run, including one fling that forced 11 mounts in a single gesture).
- 11 hydrations — **all idle-phase**; the chain never fired inside a gesture. Time-as-placeholder ranged 0.8 s to 14 s during heavy fling sequences.
- 30 deferred rows were evicted before ever hydrating: Run 1's boundary-churn rows now mount cheap and unmount cheap, exactly as intended.
- Drag-phase mounts: 0 (consistent with Run 1).

Notably, this run's flings were harder than Run 1's (up to 11 gesture mounts per fling vs 5) yet felt better — the per-mount cost, not the mount count, was the lever.

Residual bump attribution in that historical run: under the then-active `chrome-media` profile, a mid-fling mount still paid for the **real header** (avatar image, author/timestamp text, request button) and the **real content block** (caption/dishes/tags — Fabric text layout), plus mid-gesture teardown of evicted rows (40 unmounts during gestures). The follow-up originally used `chrome-media-header`.

```bash
EXPO_PUBLIC_HOME_DEFER_PROFILE=chrome-media-header
```

That follow-up exposed an unacceptable media-readiness failure: visible rows could remain a plain card-colour placeholder until idle hydration. The media-deferring profiles are therefore retired. The replacement `chrome-header` profile keeps the real media subtree mounted while still deferring header, actions and feedback; content text remains the other real mid-fling mount.
