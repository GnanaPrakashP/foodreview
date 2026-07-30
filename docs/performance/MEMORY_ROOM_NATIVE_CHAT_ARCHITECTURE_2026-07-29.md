# Memory Room native recycled Chat architecture

Date: 2026-07-29

Status: Android Stage A rejected on the connected Motorola edge 70 fusion.
The production renderer remains the vendored React Native renderer.

## Authority boundary

```text
authenticated JS room state / SQLite / outbox / HTTP / Realtime
  -> stable, lightweight display-row projection
  -> NativeMemoryChatList bridge
  -> Android RecyclerView + ListAdapter + DiffUtil
  -> bounded view-type-specific recycled pool
  -> visible/read-ahead cells and a native viewport anchor
```

JavaScript remains authoritative for access, canonical logical identity,
ordering, optimistic lifecycle, reconciliation, reply relationships, upload
state, persistence, read position and account/room isolation. The native view
receives only stable display/interaction primitives. It receives neither the
room object nor mutation/query objects, authentication state, private Storage
paths or telemetry content.

The existing `NativeChatInput` and `KeyboardInsetView` remain separate native
siblings. The list does not own the draft, submission, IME or durable state.

## Android Stage 1

The profile-only Android module renders incoming/outgoing text, reply text,
date markers, unread markers, system rows and delivery state. It uses stable
64-bit IDs, fingerprint-based `DiffUtil`, explicit cell view types, a disabled
item animator, a four-cell item cache and bounded per-type pools. Each message
holder resets body, sender, timestamp, reply, delivery, selection,
accessibility and gesture state before reuse.

Initial latest/unread positioning is applied only after rows and final native
dimensions are available. The RecyclerView remains transparent until that
anchor layout completes, preventing a visible latest-then-unread correction.
Insertions away from latest capture and restore the first visible stable key
and decorated top. Insertions while following latest stay bottom anchored.

The candidate emits content-free trace spans/counters for row-update dispatch,
native layout, total rows, attached cells, created cells, rebound rows,
recycled cells and pooled cells.

Rich media, audio and dish rows deliberately fall back to the existing
renderer. They do not participate until the text/unread stages pass.

## Unread and read-position contract

The first unread lookup is bounded:

```text
indexed owner-scoped SQLite lookup
  -> bounded rows before/after first unread
  -> member-scoped bounded server reconciliation when local data is insufficient
```

Opening a native room does not mark the latest message read. While Chat is
active, native visibility reports the highest rendered message timestamp.
JavaScript batches that position, persists a remaining-unread count locally
and calls a membership-aware server RPC. The database clamps future input and
uses `greatest(existing, requested)`, so concurrent devices cannot move the
read position backward. Room exit flushes the newest pending visible position.

## Production and fallback rules

- `vendor` remains the default in every environment.
- `native-recycler` is accepted only with the internal performance profile.
- Production configuration rejects renderer overrides.
- Missing Android native registration, anchor failure or unsupported rich rows
  selects the vendored renderer.
- The renderer choice is fixed by build/profile configuration and never
  changes in the middle of a room.
- No migration or candidate deployment is authorized by this experiment.

## iOS parity plan

iOS must use the same platform-independent row projection, logical IDs,
anchor/read commands, unread policy and bounded pagination payload. The native
host should use `UICollectionView` with a diffable data source (or an
equivalent reusable `UITableView` implementation), typed reusable cells and a
bounded prefetch window.

Required iOS cell types and reset rules match Android. The collection view
must apply latest/first-unread anchoring before first exposure, preserve a
stable visible item and offset across older/newer inserts, and expose
visibility, selection, reply and accessibility events through the same JS
contract. Composer/keyboard ownership remains in the existing native input
host. Media players remain screen-level/lazy and never belong to every
reusable cell.

iOS is not implemented or physically accepted by the Android Stage 1 work.
It cannot inherit an Android acceptance result; it requires its own signed
build, VoiceOver, frame, memory, restart, offline and unread matrices.

## Rollout gates

Stage A is the only physical gate permitted initially: an isolated cached
50-text-message room versus the reviewed vendored control. If it does not
materially improve Chat frame results while keeping active PSS growth within
40 MiB, the candidate is rejected and later stages stop.

Only a passing Stage A may proceed to unread anchoring, then rapid
send/replies, three-block plateau, ten-minute soak and finally rich cells.

## Physical Stage A result

The first native Stage A report is invalid performance evidence. Its bridge
reported 50 adapter rows, but the `RecyclerView` remained at alpha zero because
the reveal callback could run before the post-anchor layout completed. Those
timings measured an invisible native surface and must not be used as a
baseline, comparison or release decision.

The corrected signed, minified Hermes preview candidate installs a
generation-scoped pre-draw listener before requesting layout. It reveals only
after the expected adapter row count, non-zero viewport bounds, attached
message cells, a valid visible range and the requested latest/unread anchor
are all proven in the same generation. A bounded four-frame fallback evaluates
the same predicate; exhaustion leaves alpha at zero, emits a content-free
failure event and selects the existing vendored fallback. Detach and stale
generation callbacks cannot reveal the view.

The corrected candidate and a newly built vendored control were exercised on
the same connected Motorola edge 70 fusion, signer, preview API, account and
cached 50-text-message room. Each renderer completed 30 `Table -> Chat` and 30
`Chat -> Table` transitions. The harness accepted a Chat entry only after
proving actual visible rows. For native it required alpha one, exactly 50
logical rows, attached visible cells, non-zero bounds and the requested anchor
inside the visible range. For vendor it required accessible message nodes
inside the Chat viewport.

```text
                                    vendor         native-recycler
Table -> Chat frame p95:            109 ms         61 ms
Table -> Chat first-frame p95:      186.990 ms     104.648 ms
Table -> Chat fully-usable p95:     271.024 ms     104.697 ms
Table -> Chat PSS delta:            +126,878 KiB   +74,818 KiB
Chat -> Table frame p95:            40 ms          18 ms
Chat -> Table PSS delta:            -2,210 KiB     +61,210 KiB
whole-run active PSS growth:        +159,437 KiB   +142,648 KiB
verified Chat entries:              30 / 30        30 / 30
native logical rows:                n/a            50 / 50
native visible rows per check:      n/a            15
native reveal failures:             n/a            0
fatal runtime errors:               0              0
```

The corrected native renderer is materially faster than the visible vendored
control, and its alpha/row/cell/anchor contract passed every measured Chat
entry. It nevertheless misses the unchanged 20 ms frame budget by 41 ms and
exceeds the 40 MiB PSS-growth budget in both measured transition blocks. The
process view count also grew from 670 to 10,125 during the two-block native
run. Stage A therefore rejects the candidate. Per the stop rule, unread,
rapid-send/reply, plateau, soak and rich/media-cell physical stages were not
started.

The trace still creates at most 17 native cells for 50 logical rows, but
leaving Chat destroys the native host and later entries recreate those cells;
cross-activation pooled/recycled counters remain zero. Production continues
to select the vendored renderer.

## Retained host + recycled rows (prototype, 2026-07-30)

The zero cross-activation counters above are not a property of recycling; they
are a property of measuring recycling inside a host that was destroyed on every
exit. Stage A ran `native-recycler` against the production `cold` lifecycle, and
the lifecycle experiment ran `warm-bounded` against the vendored renderer. The
combination — a host that survives the tab switch, holding a pool that is
therefore still warm when Chat is re-entered — was never built or measured.

It is now selectable by setting both profile selectors:

```text
EXPO_PUBLIC_PERFORMANCE_PROFILE=1
EXPO_PUBLIC_MEMORY_ROOM_CHAT_LIFECYCLE=warm-bounded
EXPO_PUBLIC_MEMORY_ROOM_CHAT_RENDERER=native-recycler
```

`MEMORY_ROOM_CHAT_RETAINED_NATIVE_HOST` is the conjunction of the two, so each
selector alone keeps exactly the behaviour it was previously measured with.
Neither can leave a profile build, so production remains `cold` + `vendor`.

What the combination changes:

- **Deactivation hides, it does not dismantle.** `setActive(false)` drops the
  RecyclerView to alpha zero and leaves it attached and laying out. `GONE` or a
  detach would discard the measured tree that retention exists to keep.
- **Re-entry resumes.** `nativeMemoryChatResumeDecision` admits a host that has
  revealed at least once, is still attached, and whose adapter matches the row
  count JavaScript believes it is showing. Such a host reveals with one alpha
  write — no layout request, no anchor, no pre-draw handshake. Anything less
  takes the ordinary cold reveal path.
- **The entry anchor becomes one-shot.** Previously `currentAnchor` persisted
  and every reveal cycle re-applied it. On a retained host that would drag the
  user back to an unread divider they had already scrolled past, so a consumed
  anchor now holds the current viewport instead.
- **Updates that land while Chat is inactive follow the ordinary position
  policy** rather than the cold reveal path, so a message arriving on another
  tab is already in place — and already measured — on return.
- **A detach still invalidates.** Route teardown is the one event that genuinely
  discards the layout, so the next activation earns its reveal again.
- **The first entry is warmed during idle.** The layout/anchor half of the
  reveal needs an attached view, not a visible one, so with `warmWhileInactive`
  it runs while Chat is still inactive and stops one step short of flipping
  alpha, emitting `NATIVE_CHAT_PREPARED`. The host is then measured, anchored
  and cell-attached before the tab is ever tapped, so entry 1 resumes exactly
  like entry 2. The resume precondition is named `hasSettledLayout`, not
  "revealed", precisely because a warmed host qualifies without ever having
  been seen.

`NATIVE_CHAT_PREPARED` is deliberately not a transition: nothing was entered, so
it does not close the Chat transition spans the way `NATIVE_CHAT_REVEALED` and
`NATIVE_CHAT_RESUMED` do. Visibility reporting stays gated on the pane actually
being active, so warming cannot mark a room read — the "opening a native room
does not mark the latest message read" contract above is unchanged.

Warming is opt-in and tied to the retained host. On a host that is destroyed on
exit the warmed layout is thrown away on the way out and paid for again on the
way in, so it is only enabled when both selectors are set. The trade-off to
watch on device is room open: this moves a real layout and one viewport of cell
creation into the room's idle window, which already carries the Chat pane mount
behind `runAfterInteractions` plus `MEMORY_ROOM_CHAT_WARM_DELAY_MS` (450 ms).
The standing tension from the lifecycle work applies unchanged — panes existing
buys instant switching, panes not existing buys fast open and exit — and this
prototype spends further on the first side. Room-open and room-exit timings are
therefore part of its acceptance, not just Chat entry.

The decisive counter is `MemoryRoomNativeChatCreatedCellsThisActivation`,
reported per activation alongside `MemoryRoomNativeChatActivations` and mirrored
onto the JS trace through `recordMemoryRoomNativeChatMetrics`. A destroyed host
creates a fresh viewport of cells on every entry; a retained one should report
zero from the first entry onward, because warming built that viewport during
idle before any activation was counted — with `pooledCells`/`recycledCells`
non-zero across the switch. If that number does not fall, retention and
recycling did not compose and the prototype has failed regardless of what the
frame timings say.

Status: **implemented, not yet measured.** No physical run has been performed,
so no frame, PSS or Stage-A claim is made or implied here. The Kotlin has not
been compiled — the authoring machine has no JDK — so a build is the first
gate. The prior Stage A rejection stands until this configuration is run
against a freshly built vendored control on the same device and account.

One measurement note carried over from the earlier reports: Stage A rejected
every candidate against absolute budgets (`<= 20 ms` frames, `<= 40 MiB` active
PSS growth) that the shipping `cold` baseline also misses, at 93 ms and
99.3 MiB. Those gates cannot separate candidates while the baseline fails them.
This prototype should be scored against a concurrently built control, not
against the absolute bar alone.

Content-free evidence is stored outside the repository at:

```text
/private/tmp/memory-room-visible-stage-a-vendor/targeted-report.json
/private/tmp/memory-room-visible-stage-a-vendor/table-to-chat-visible.png
/private/tmp/memory-room-visible-stage-a-native/targeted-report.json
/private/tmp/memory-room-visible-stage-a-native/table-to-chat-visible.png
```
