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

Content-free evidence is stored outside the repository at:

```text
/private/tmp/memory-room-visible-stage-a-vendor/targeted-report.json
/private/tmp/memory-room-visible-stage-a-vendor/table-to-chat-visible.png
/private/tmp/memory-room-visible-stage-a-native/targeted-report.json
/private/tmp/memory-room-visible-stage-a-native/table-to-chat-visible.png
```
