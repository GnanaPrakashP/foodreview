# Chat Production Status

Current phase: Production Hardening Phase 9 — load, soak, fanout, failure recovery and capacity proof

Production-hardening program phase: Phase 9 — production-rejecting hosted load harness, deterministic synthetic data, authenticated mobile API traffic, Realtime and private-media fanout, failure recovery, reconciliation, external evidence binding and an explicit capacity gate

Phase 8 implementation status: PASS locally on `hardening/10-native-release`. Production configuration rejects missing, placeholder, localhost/LAN, development-channel and privileged-public values; production identity is CircleBites with `com.circlebites.mobile` and `circlebites://`; OTA is disabled; Android release signing fails closed and production manifest/backup/permission policy is hardened; generated iOS production policy, usage strings and privacy manifests are validated; Google OAuth callbacks are environment-bound and replay-safe; owner-scoped post drafts survive termination and join account cleanup; release/store/device documentation and manual release CI are present.

Phase 8 release verification status: BLOCKED. The local Android APK/AAB use an explicitly disposable non-debug validation key, not the production upload key; Apple distribution signing/archive/IPA, production APNs, real OAuth/provider credentials, protected EAS production variables, physical Android/iOS installs/upgrades, two-account private-media/upload/push/auth/accessibility matrices, hosted staging, live Sentry symbolication, legal approval, store-console declarations/review and Phase 9 capacity testing remain external gates. PH-001, PH-002 and PH-003 are not hidden or declared resolved.

Local evidence includes Android APK/AAB release builds with R8/resource shrinking, mapping/native symbols/Hermes maps, signature/package/version/merged-manifest inspection and artifact scans; an arm64 generic-iPhone Release compile with privacy manifest, minimal generated Info.plist, dSYM and Hermes map; environment/EAS inventory validation; clean root production dependency audit; mobile audit with 18 moderate and no high/critical advisories; passing Phase 8 and Phase 1A–7 focused regressions; root/mobile typechecks; zero-error lint; Memory hardening; canonical database reset/policies/upgrades/drift; and Next production build. Exact command totals and hashes are recorded in `docs/production-hardening/PHASE_8_NATIVE_RELEASE.md`.

Next required work: execute the Phase 8 external release gates and the checked-in Phase 9 hosted/physical matrix on disposable production-like staging.

Required sequence: assign PH-001 credential ownership and rotate if privileged; adjudicate PH-002 and the PH-003 Expo advisory chain; configure protected staging/EAS/Apple/Google/APNs/OAuth/Sentry/load credentials; deploy canonical disposable staging; build production-signed candidates; execute the documented physical-device, two-account, install/upgrade, push, auth, media, deletion and accessibility matrices; obtain legal/store declaration approval; execute Phase 7 hosted drills; then run the Phase 9 launch, stress, soak, recovery, restore and physical-device evidence matrix. Do not publish automatically.

## Memory Room Chat entry: viewport completeness and first-unread anchor (2026-07-30)

Status: **PASS locally for the scoped corrections; NOT physically verified.** No
Android device was connected for this change, so no frame, PSS, first-frame or
usable timing is claimed and none of the rejected Stage A results are superseded.
Every claim below is source- and test-level only.

Four production defects on the vendored renderer were corrected.

The vendored bubble built its bottom metadata row on every mounted message and
then clipped it to height zero: two wrapper Views, `Time`'s View/Text plus a
`dayjs` format per render, and the delivery-tick View/Texts. This surface has
rendered its own pinned timestamp inside the message text since the timestamp
work, so none of it was ever visible. `renderBubble` now passes
`renderTime`/`renderTicks` that return null, and the vendored `Bubble` omits the
container entirely when nothing renders into it. The former hidden
`bottomContainerStyle` was removed rather than kept, so any future bottom content
fails visibly instead of silently.

The long-press action menu was moved off the vendored reactions wrapper. Emoji
reactions are disabled (`MEMORY_REACTIONS_ENABLED` is false), but
`reactions.isEnabled` was held true by a separate "message options" flag purely
to obtain a long-press handler, which mounted the wrapper on every row: a
`useState` for picker visibility, a second `useState` for the anchor, a
`useSharedValue`, an `useAnimatedStyle`, an extra Reanimated view and a per-row
menu publisher. The vendored bubble's default path already exposes
`onLongPressMessage`; it now also measures and reports the bubble's window
geometry, so the room opens its own menu from there. `reactions.isEnabled` is
gated on emoji reactions alone and the redundant options flag was deleted.
Hold time is preserved by matching the wrapper's 350 ms `delayLongPress`, and
the default path now renders `renderReactionsDisplay()` so an already-reacted
message cannot lose its pills. The one intended behaviour change is that
long-press no longer scales the bubble.

`CHAT_MAIN_INITIAL_RENDER_COUNT` moved from 8 to 14. The previous value encoded
an assumption that a phone viewport holds about eight compact rows, which three
retained physical measurements contradict: the vendored list settles at 29
mounted rows with `windowSize` 3, the FlashList Stage A viewport was visually
full with 12 rows, and the native recycler reported 15 visible rows per check.
Rendering below one viewport is what made the first Chat frame arrive
structurally incomplete and then fill in `maxToRenderPerBatch` steps at least
`updateCellsBatchingPeriod` apart. The two changes are one unit for measurement
purposes: the larger first window is affordable only because the row no longer
builds the invisible bottom subtree.

Opening Chat no longer marks the whole room read. That rule computed an unread
anchor and then erased it before it could ever be shown, because this renderer
never actually moved the viewport to the anchor. The read position now advances
from the reported visible range through the existing monotonic, debounced,
membership-aware path that was previously reachable only from the native
renderer; reaching the newest message still marks the room fully read. The
first-unread anchor is applied once per room visit, bounded to
`CHAT_MAIN_ANCHOR_MAX_INITIAL_RENDER_COUNT` rows, behind a bounded four-frame
reveal gate that mirrors the reviewed native contract, and degrades to the
existing newest-first placement whenever the anchor cannot be resolved. The
anchor is consumed once so a later re-entry keeps its restored scroll offset.

The jump-to-latest control on the production renderer was the vendored library's
unstyled fallback: a 40x40 white circle containing the literal glyph `V`. The
room now owns the control, shows the unread count when the room has unread, and
supplies the `onJumpToLatest` handler that `UnreadDivider` has always accepted
and never been given.

Focused verification: memory chat/room suites 86/86, Memory hardening 105/105,
root suite 1,806/1,816 with the same ten pre-existing unrelated Review, Profile,
Explore and post-media contract failures (confirmed identical on a clean tree),
both typechecks, zero-error lint and `git diff --check`. Five contract tests were
updated rather than removed, because each pinned a value or shape this change
deliberately alters; the invariants they existed to protect — no second
placement of an already visible row, a bounded initial window, one messages
layer, monotonic reads, no mark-on-open — are all still asserted, and in the
read-position case the assertion now covers both renderers instead of one.

Security conclusion: no authentication, membership, RLS, private Storage, API,
database, rate-limit, offline/outbox or logging contract changed. The read RPC,
its clamping and its membership checks are untouched.

Required next step: physical A/B on the connected Android device — the row-cost
and initial-window pair as one variable, then the unread anchor's `viewPosition`
placement and reveal gate — before any of this is described as a performance
improvement.

## Memory Room bounded chat-history retry (2026-07-30)

Status: **PASS locally for the scoped pagination correction; not a production
release PASS.** A failed or timed-out older-history request now disarms every
automatic top-edge trigger while the list remains parked at that edge. The
active vendor, FlashList and native-recycler candidates expose an explicit
generic retry control, and the member-scoped infinite query performs no hidden
React Query retry. A successful page continues through its opaque cursor and a
terminal null cursor removes the affordance. No message body, cursor, identity,
private-media reference or raw error is rendered or logged, and no API,
database, RLS or storage boundary changed.

## Memory Room Dish bubble theme parity (2026-07-30)

Status: **PASS locally for the scoped style correction; not a production
release PASS.** Dish poll cards, text bubbles, media cards and typing indicators
now resolve their sent/received backgrounds directly from the current
occasion-aware `ROOM_COLORS` passed to `createStyles`. The former mutable global
bubble colors were removed, eliminating the ordering path where styles were
created from the previous room theme and the globals were updated only
afterward. No authorization, private-media, API, database or Supabase policy
boundary changed.

## Memory Room initial Chat bottom anchor (2026-07-28)

Status: **PASS for the scoped initial-anchor correction and authenticated
physical Android matrix; not a production release PASS.** Chat now resolves one
closed-composer geometry contract synchronously from the frozen safe-area
inset, font scale, pixel ratio and platform before its first rows mount. The
initial list spacer, composer input minimum, toolbar inset and native keyboard
host consume that same result. Collapsed-toolbar `onLayout` validates the model
but cannot replace the active clearance; expanded reply/edit/selection/voice
structures still use their measured height after an explicit user action.

The second independent geometry correction removes the timestamp-width cache,
estimated width, delayed hug confirmation, negative margin and post-paint
layout decision. A deterministic non-text inline spacer, sized synchronously
from the bundled DM Sans timestamp metrics plus the established 8 px gap, now
participates in the body Text's first native line-break pass while the sole
actual timestamp remains pinned in its established position. This avoids both
Android drawing a second timestamp and the whitespace approximation adding
excess gap for two-digit hours. Message tails, received-user avatars, reply
swipe motion, bubble colors and delivery-state UI are unchanged. First-eight
coordinate sampling is development-only, generation-safe, physical-pixel
rounded, bounded to 800 ms and records no message body, URL, Storage path or
user identity. Production configuration continues to reject the diagnostics
switch.

The authenticated physical matrix passed on the connected Motorola edge 70
fusion, Android 16, Gboard, 1272x2772 display. It covered exactly 50 cached
messages and exactly 8 cached messages; short and multiline text; incoming and
outgoing rows; replies; pending-to-sent; keyboard closed and previously open;
first Chat opening; cold room entry and re-entry; warm returns from Table,
Media and Dishes. Eleven independent Chat generations sampled the same first
eight rows for at least 750 ms: **88/88 rows had zero top, bottom or height
movement in physical pixels**, every list began at inverted offset 0, and zero
programmatic Chat scroll commands, geometry mismatches or native re-anchor
corrections were observed. Native composer layout was 80.3555298 dp and the
model was 80.3555556 dp; both rounded to 226 physical pixels. The former 88 dp
guess is absent.

After the timestamp follow-up, a cold development-client remount on that same
physical device exposed 13 timestamped message rows and zero accessibility
nodes containing a repeated timestamp. The subsequent gap correction removes
timestamp text from the reservation entirely and restores the established
8 px body-to-time clearance from bundled font metrics. The corrected physical
screen was inspected with one- and two-digit hours plus multiline text; its
final accessibility hierarchy exposed 18 timestamped message descriptions,
zero repeated timestamps and zero inline-object characters in those accessible
descriptions.

The matrix ran from a signed, minified, resource-shrunk Hermes release/profile
APK using an explicitly disposable two-day validation certificate. APK
signature verification, R8 mapping presence, embedded Hermes bytecode and
privacy/server-secret scans pass. APK/Hermes sizes are
138,323,296/7,165,628 bytes with SHA-256
`3b0d97237dcac1d6aef6b37b9f242a957a20faeb44a5378d2b5dcbd9858894d9` and
`3689cd65d289338057861ba76b5913cdbd109057ed03be83f07d8d9e0966d77c`.
The complete journey recorded 1,010 frames, 96 janky frames (9.50%) and p95
34 ms. Across the eleven Chat generations, list first layout was
12.09-18.89 ms, composer first layout was 13.34-20.45 ms and first sampled row
geometry was 30.95-130.63 ms after the synchronous model event. The
diagnostic matrix began at 207,526 KB PSS/217 native views on the post-login
baseline surface and ended inside Chat after the full journey at 339,503 KB
PSS/542 views. That +131,977 KB/+325-view workload endpoint delta is retained
as evidence, not mislabelled as a before/after implementation regression or a
memory-soak result; the focused change removes visible-row measurement state,
timers and a cache, while placement diagnostics remain disabled outside the
explicit profile build. These whole-journey numbers are not a general
release-performance claim.

Physical evidence is retained under
`/private/tmp/memory-chat-anchor-final-3/`: `report.json`, `events.json`,
`journey-events.json`, `memory-chat-visual.mp4`, `contact-sheet.png`, thirteen
checkpoint screenshots, `apk-signature.txt`, `apk-verification.json` and
`profile-instrumentation-scan.json`. The instrumentation scan covered 330
allowlisted events and passed monotonic-timestamp and privacy-field checks.

Automated scoped evidence passes: initial-anchor/visual/rapid-send/Phase 4 and
release-profile selection 110/110; Memory hardening 105/105; rapid-send 14/14;
Phase 1 security 19/19; Phase 2 media security 20/20; journey/release-profile
35/35; root and mobile typechecks; zero-error lint; `git diff --check`; and the
96-page Next production build. The full repository suite is 1,779/1,798: its
19 failures are outside Memory Room Chat in existing post-media worker,
Explore/Profile layout and review-upload source contracts. They were not
weakened or changed for this correction. No API, database, Supabase migration
or deployment change was made.

## Memory Room rapid-send reconciliation (2026-07-27)

Status: **PASS for the authenticated physical rapid-send and visual-placement
scope; not a production release PASS.** The final source was rebuilt, installed
and validated on a Motorola moto g57 power running Android 16 with Gboard.
Every required outgoing text row rendered directly at its final inverted-list
index. No row first appeared below the timeline and then moved upward. The
audited A-E, numbered, identical and multiline checkpoints all retained
`contentOffset = 0`; HTTP, Realtime, SQLite and delivery-state confirmation
caused zero scroll commands, remounts or coordinate changes.

The physical matrix used an authenticated disposable Memory Room and passed:
A-E rapid send; 20 numbered messages; five identical messages; immediate
one-character send plus an accidental second tap; multiline composer collapse;
slow confirmation; Realtime-before-HTTP; stale refresh; and voice, image and
video upload overlapped with rapid text. Every accepted text send was present at
newest-first inverted-list index zero before persistence. A-E, identical,
multiline, stale-refresh and all media-overlap text rows mounted once. All 20
numbered rows also mounted once. Every audited text send issued zero
programmatic scroll commands and had zero confirmation mounts or coordinate
changes; a few rows received a same-coordinate confirmation-era `onLayout`
callback, but no text row moved. The stale-refresh case persisted exactly one
database row and retained one mount and one layout without a transient failed
state. Image and video each retained one logical media mount; their preview
dimensions changed once when processed authoritative aspect metadata replaced
the optimistic fixture, while all three overlapping text rows remained
stationary.

Physical evidence is retained under:

- `/private/tmp/memory-chat-moto-g57-final/` — final-source A-E, acknowledged
  20-message burst, identical text, one-character/double-tap, multiline,
  voice-plus-text, slow confirmation and Realtime-before-HTTP.
- `/private/tmp/memory-chat-moto-g57-stale2/` — final-source stale refresh
  during a deliberately delayed server insert.
- `/private/tmp/memory-chat-moto-g57-image/` and
  `/private/tmp/memory-chat-moto-g57-video/` — final-source synthetic local
  media upload/processing plus overlapping text.

Each directory contains `memory-chat-visual.mp4`, `events.json` and
`report.json`. All four reports are `PASS`. The traces contain only bounded
client IDs, timestamps, coordinates, dimensions, offsets, status and event
source; they exclude bodies, private URLs, Storage paths, tokens and personal
identifiers; a recursive artifact scan passes. The final run captured 36
device-observed send presses. A-E press intervals were 431-444 ms, the
acknowledged numbered sequence was 465-1,027 ms, and identical sends were
734-950 ms under verbose development instrumentation. A-E first-layout
observations were 15-29 trace-derived 60 Hz frame equivalents. These include
ADB/UIAutomator, development bundling and diagnostic logging and are not
production latency claims. Android gfx reports were 345/1,005 janky frames
(34.33%, p95 69 ms) for the full matrix, 13/82 (15.85%, p95 36 ms) for stale
refresh, 58/701 (8.27%, p95 36 ms) for image and 66/766 (8.62%, p95 36 ms) for
video. These are honest development-harness numbers, not release-performance
evidence.

Physical testing across the two connected Android targets found and fixed five
implementation defects: the text-send-to-microphone double-tap race,
overlapping voice/text SQLite transactions, a multiline pending-to-sent
wrapper-topology change that replayed native text measurement, inverted-list
visible-position retention that allowed the latest offset to grow instead of
remaining at zero, and foreground/outbox recovery replay during a stale
refresh. Foreground ownership now prevents recovery from resending a durable
outbox row while its original request is active, releases only after the
corresponding SQLite commit/failure write, and still permits recovery after the
request ends or the process restarts. The active row keeps its measured text
subtree and gesture wrapper mounted across confirmation, while reply gestures
are enabled independently. Development-only placement diagnostics, delay/stale
forcing and local synthetic media fixtures fail closed in production config.

One canonical reconciliation reducer now owns bootstrap, cursor, cache, outbox,
HTTP and Realtime merging. It matches exact client identity first, exact server
identity second, and permits the legacy author/body/time heuristic only for one
unambiguous pair with no client IDs. Ordering is stable by client timestamp,
client sequence, client order key and logical identity; confirmation never
reorders a row. Stale snapshots merge without erasing local pending rows,
explicit deletes remain targeted, and unaffected sibling object references are
preserved.

SQLite changes are additive and owner-scoped. Pending/uploading/failed messages
and media source metadata survive restart in the same logical row and are
committed by client identity. Migration
`202607270001_shared_memory_client_ordering.sql` adds validated client-order
columns, unique indexes, bounded member-scoped v2 reads and a service-only atomic
media finalize RPC without weakening existing RLS, private media, rate limits or
signing.

Focused evidence:

- Rapid-send reducer/native contract: 14/14, including all 120 A-E
  acknowledgement orders, reverse 20-message confirmation, duplicate
  HTTP/Realtime delivery, identical text, stale snapshots, targeted
  failure/retry, mixed media/text, restart serialization, explicit delete and
  reference-counted foreground send ownership.
- Visual-placement/list contract: 15/15, including final inverted index, stable
  row key/index/text/wrapper, optimistic-before-transport, zero
  confirmation-driven scroll, bounded follow ownership, serialized SQLite
  writes, stale-refresh replay exclusion and safe local media fixtures.
- New database pgTAP: 8/8; the migration manifest passes with 89 canonical
  migrations, 107 historical migrations and 2 documented conflicts. The linked
  remote database applied `202607270001_shared_memory_client_ordering.sql`; its
  post-apply ledger and schema dump match, and a final push dry run reports no
  pending migrations.
- Root and mobile typechecks pass; root lint passes with 0 errors and 81
  existing warnings; `git diff --check` passes. An isolated Node 20 standard
  Next production build passes with 96 static pages. The repository's explicit
  Turbopack build could not be certified in the shared worktree while existing
  local Next development servers were concurrently writing `.next`.
- The Kotlin keyboard module compiles, and the debug APK builds, installs and
  completes the authenticated matrix on the physical Android/Gboard target.

Broader-gate classification:

- `npm run test:memory-hardening` is 86/102 and the canonical
  `npm run verify:memory-hardening` gate stops there. Its 16 failures are two
  stale 25 MB source-contract expectations after the canonical limit became
  20 MB, plus 14 pre-existing Phase 4 source/architecture expectations. The
  Phase 4 gate is 33/47. None is introduced by rapid-send placement; several
  cover broader cache, media, pane-navigation and crash-guard behaviour and
  remain repository debt rather than being weakened to make this task pass.
- The full root suite is 1,704/1,747. Its 43 failures are the remaining baseline:
  the 16 Memory-hardening failures above, three other pre-existing Memory
  cache/private-media/read-state contracts, and 24 pre-existing repository
  media-worker, navigation, profile, accessibility, review and feed-contract
  failures. No focused rapid-send or placement test fails.
- Database contract is 224/225. The single pre-existing schema failure is the
  unvalidated `media_assets_memory_full_frame_check`; database lint separately
  reports the pre-existing ambiguous `room_id` in
  `respond_to_shared_memory_invite`. The new migration's focused pgTAP is 8/8.

Security conclusion: the rapid-send implementation is locally bounded and does
not relax authorization or media privacy. The exact authenticated physical
rapid-send/visual-placement requirement is proven and passes. The broader
release program remains conditional on its separately documented production,
hosted, signing and repository-debt gates; do not infer whole-app
beta/production readiness from this scoped PASS.

## Authentication/profile boundary hardening (2026-07-16)

Status: PASS locally; hosted deployment remains a release gate. Migration `202607160001_auth_profile_boundary_hardening.sql` gives authenticated clients profile SELECT only, removes permissive legacy profile policies, centralizes completeness in `is_profile_complete`, and restricts onboarding/edits to owner-derived RPCs. Google and email OTP are the only product auth paths. Password/recovery UI, API, callback, navigation, and client methods are removed; the Custom Access Token Hook rejects password token issuance. Local clean reset, 132 pgTAP assertions, adversarial synthetic-user validation, and root/mobile typechecks pass. The linked test project aggregate audit found one valid complete profile and no incompatible rows. Hosted migration, Auth Hook activation, same-email identity-link verification, signed-device journeys, telemetry, and minimum-version cutover remain mandatory. Full details: `docs/security/AUTH_PROFILE_BOUNDARY.md`.

## Focused installed-app authentication journey (2026-07-14)

Status: CONDITIONAL PASS locally; not a production release PASS. The mutually exclusive startup boundary remains intact. A cleared-data and actual uninstall/reinstall launch of the installed Android development client `com.circlebites.mobile.dev`, loading the current repository source on an Android 15 emulator, showed only Welcome with Google and Email entry points; no protected tab or auth runtime failure was observed. The non-secret sandbox marker was created after fresh launch and survived both Android cache-only clearing and an in-place APK install. No physical Android was connected and no physical iOS device was available, so signed-in reopen/update/cache, provider UI, two-account switching and physical reinstall claims remain external gates.

Concrete gaps closed: an ordinary-sandbox installation marker now clears surviving iOS Keychain auth/PKCE/install state and owner-scoped SecureStore state when the marker is missing; updates retain the marker, and the first marker-bearing release promotes an exact legacy active-owner match so the rollout itself does not sign out an ordinary upgrade. Corrupt/partial SecureStore chunks are deleted and fail signed-out. Email uses a six-digit OTP without a callback. Local Supabase callback allowlists cover only environment-specific Google OAuth callbacks. Google production callbacks are restricted to `circlebites://auth/callback` and reject HTTPS/Vercel callback hosts.

Focused evidence: 60/60 authentication/native/cache/API tests; mobile and root typechecks; zero-error root/mobile lint; Next production build; Memory 72/72 plus shared Memory 19/19 and 20/20; native-release validation 72 checks and 18/18 tests; Phase 4 real local Auth/API runtime 10/10; pgTAP 88/88; `git diff --check`. The full root suite is 1,158/1,178 with the same 20 classified PH-002 source-contract/UI failures; the six new journey tests pass. Hosted Supabase, Google Cloud, EAS and Vercel settings were not marked verified: Supabase CLI had no access token and EAS account access was unavailable. Production remains blocked on those console checks and the complete signed physical-device matrix.

## Production Hardening Phase 8 — Native Release Readiness (2026-07-14)

- Identity/environment: CircleBites is canonical across app, legal and public support surfaces; development, preview and production use distinct IDs/schemes and EAS environments; production config fails closed and exposes no server/worker/scheduler credential.
- Android: `com.circlebites.mobile`, version `1.0.0`/code `1`, API 24–36; cleartext and backup are disabled, risky/obsolete permissions are removed, exported components are bounded, debug signing is rejected, and APK/AAB/mapping/native symbols are locally produced and inspected.
- iOS: generated Expo prebuild is the canonical path; bundle `com.circlebites.mobile`, iOS 15.1+, iPhone-only; ATS, permission strings, required-reason APIs, URL schemes and no-tracking declaration pass a code-signing-disabled arm64 Release build. Distribution signing and IPA remain blocked externally.
- Runtime safety: production Google OAuth callbacks are scheme/environment/nonce/expiry bound; email uses OTP; password/recovery product surfaces are absent; OTA is disabled; owner-scoped durable post drafts join logout/switch/deletion cleanup; private caches remain excluded from backup.
- Compliance/accessibility: mobile/web privacy and terms plus support/deletion pages share one identity/data model; store worksheets and device matrices exist; static roles/states/live errors/reduced motion were improved without redesign. Counsel and physical assistive-technology validation remain gates.
- Supply chain/telemetry: root Next was safely patched and root production audit is clean; mobile has 18 moderate Expo-chain advisories pending owner disposition; symbols/maps are created, while protected production upload and controlled symbolication are externally blocked.
- Release process: the mandatory manual workflow validates Phase 1A–8, database and web gates, native manifests/artifacts/scans and never submits to stores. The reviewed 15-step staging/release order remains mandatory.

## Production Hardening Phase 7 — Observability and Operations (2026-07-13)

- Telemetry: Sentry covers mobile native/JavaScript crashes, NDK, ANR/app hang, watchdog, app start/native frames, API errors, and worker errors; all signals share environment/release and privacy filters.
- Logging/correlation: structured JSON is recursively redacted and fail-open; middleware/mobile/API/workers propagate bounded request/run correlation without account IDs or content.
- Operations: service-only health reports database waits/contracts plus media, deletion, moderation, push, and scheduler backlog/age/failure; final local health is 28/28 healthy.
- Push: direct Expo sending is replaced with durable deduped jobs, fenced sends, unique tickets, delayed receipts, bounded batches, backoff, invalid-token disablement, and dead letters.
- Scheduling: 16 owned schedules cover push, deletion, media, moderation, cleanup, retention, Storage reconciliation, and existing worker/GitHub responsibilities; durable runs and heartbeats detect misses.
- Response/recovery: 43 alerts link to 17 complete runbooks; rollback/roll-forward and emergency disablement are documented; the real local dump/clean-restore/schema/RLS drill passes.
- Privacy: no user identity, raw content, tokens, signed URLs, Storage paths, screenshots, view hierarchy, precise IP/location, request bodies, or provider payloads enter telemetry; retention is bounded and Phase 8 disclosure updates are flagged.
- Remaining: hosted Sentry/symbolication/alerts, production schedules, real Expo delivery, hosted PITR/Storage recovery, staging restore/canary/rollback, signed physical devices, and Phase 9 capacity evidence.

## Production Hardening Phase 6 — React Native Mobile Performance (2026-07-13)

- Tabs/startup: all four main tabs use lazy mounting; only Circle is initial, visited tabs remain retained and freeze on blur, and Profile/Memory/Explore/location/camera work is focus-gated.
- Persistence: the per-owner Query envelope persists only successful bounded first-page Circle, Explore, current Profile, Memory summaries, and unread count; it omits mutations/errors/tail pages and strips expired signed media. Expo Image caches join Phase 1C cleanup.
- Runtime: one AppState/Expo Network owner drives React Query focus/online managers and all foreground consumers. A release-only install-identity failure was fixed with Expo Crypto without adding an insecure fallback.
- Mutations: likes, bookmarks, comments, notifications, Profile edits, deletes, and Memory deltas patch exact cached entities with rollback/server correction; notification polling and immediate Memory delta reloads are removed.
- Rendering: feed lists use 4/4/5 virtualization, memoized cards, batched seen writes, feed-sized images, next-two Wi-Fi/Ethernet thumbnail prefetch, and a single viewport-owned video player. Restaurant, dish, liked, and saved surfaces now consume stable cursor pages.
- Artifacts: Android/iOS exports are 16,647,373/16,639,725 bytes; Hermes is 9,262,946/9,254,301 bytes; fonts are 2,101,500 bytes/platform; final APK is 151,601,421 bytes. All pass budgets. An isolated generated iOS arm64 simulator Release compile also succeeds; it is not signed-device evidence.
- Runtime evidence: Android 15 emulator release/profile, five samples, cold draw median 9,153 ms and warm resume median 1,463 ms. No useful-content/tab-content marks, representative player count, or valid feed-scroll frames were available because hosted `mobile_public_feed_page_v1` is missing. The partial result is not a production latency claim.
- Remaining: physical devices, hosted staging, long-session memory/media, PH-603 process-safe drafts, PH-902 module splitting, Phase 7 telemetry, Phase 8 signed/store validation, and Phase 9 capacity testing.

### Home FlashList optimized-preview candidate (2026-07-20)

Status: PASS locally; physical-device acceptance remains required before the
store-production Home default changes.

- Home list-engine selection is now independent from development diagnostics.
  `EXPO_PUBLIC_HOME_LIST_ENGINE=flashlist` is allowed in optimized builds, the
  internal EAS preview profile selects it, and invalid engine values fail mobile
  configuration. Store production still defaults to FlatList pending the
  documented device matrix.
- Recycling trace logs, staged PostCard substitutions, subtree instrumentation,
  and the `RECYCLE` overlay remain `__DEV__`-only. A non-diagnostic FlashList
  build is forced to the complete real PostCard plan.
- The settled vertical cover runway now matches the existing next-two
  Wi-Fi/Ethernet budget. Scheduler concurrency remains one active and two
  pending jobs; decoded media surfaces retain their separate bounded window.
- Verification: focused Home/native-release tests 428/428; repository tests
  1,623/1,623; Memory hardening 72/72; Phase 1/2 Memory security 39/39; root and
  mobile typechecks pass; lint passes with 83 existing warnings and zero errors;
  `git diff --check` passes.
- An Android production-mode Expo export using the preview identity and
  FlashList selector completed successfully. Its Hermes artifact contained
  FlashList while the development recycling markers, overlay label, diagnostic
  environment name, and legacy `recycling-list` selector were absent.
- Security gate: PASS for this scoped change. It changes no authentication,
  authorization, RLS, Storage policy, service-role boundary, signed-media
  delivery, notification content, or private-data logging. The export used only
  existing local client configuration; no secret value was printed or added.
- Still unverified: physical Android/iOS slow/reverse scrolling, fast flings,
  pagination, recycled-state isolation, active-player count, startup latency,
  and multi-page PSS growth. This local PASS does not promote FlashList to the
  store-production default or claim production scroll performance.
- Vercel Preview deployment now stages only Git-tracked source in an isolated
  temporary directory, replaces its root config with `vercel.preview.json`, and
  asks Vercel to perform the Preview build through `npm run deploy:preview`.
  The alternate config retains the Mumbai region but omits production cron
  registration because Preview does not execute those schedules and the linked
  Hobby project rejects sub-daily cron definitions. The production
  `vercel.json` schedule inventory is unchanged. The staging script requires a
  clean tracked worktree, reuses only the existing Vercel project link, pins the
  CLI, explicitly selects Preview, never passes `--prod`, and always removes its
  temporary source tree.
- The superseded macOS `--prebuilt` Preview reached Vercel but its Circle feed
  failed because a read-only media authorization import pulled Sharp into the
  request and the uploaded native binary did not match Vercel Linux ARM64. Home
  media delivery now imports a Sharp-free contract; the generated Circle-feed
  route and all seven of its runtime chunks contain no Sharp runtime import.
  Source staging also lets Vercel install the correct native dependencies for
  processing routes. Focused media/deployment tests pass 53/53 and the local
  Preview build passes. A new remote Preview and authenticated media smoke are
  still required external evidence.

### Home cover-thumbnail continuity follow-up (2026-07-21)

Status: PASS locally; connected physical-device frame, memory and slow-network
acceptance remains required before claiming placeholder-free production scroll.

- The initial Circle response remains cover-only plus `mediaCount`. It now
  includes one separately authorized private thumbnail only for media position
  zero; additional carousel media remains behind the existing settled or
  interactive endpoint and current-plus-next preparation window.
- Cover thumbnails use the existing processed derivative and the same batched
  authorization/signing boundary as the feed image. No source Storage path,
  original upload or public-bucket downgrade was introduced. Signed thumbnail
  URLs are removed from owner-persisted query state with the other bearer URLs.
- The first two cover thumbnails are prepared to native disk cache before the
  cold feed replaces its loading shell, with a 1.5-second fail-open ceiling.
  The remaining first-page covers prepare in disk-only pairs. Thumbnail
  surfaces decode only for mounted rows and unmount when the feed-sized cover
  becomes ready; full cover preparation remains next-two and carousel media is
  unchanged.
- The former peach last-resort media surface is now near-black. Processed image
  covers show their real thumbnail over the existing BlurHash until the larger
  derivative is ready. Home media has no dish or utensils fallback: only the
  selected carousel page can show a rotating indicator while it is actively
  waiting for metadata or delivery; inactive pages remain near-black or show
  their BlurHash without animation, and permanent failures keep media-local
  Retry.
- Verification: focused Home tests 206/206; repository tests 1,627/1,627;
  Memory hardening 72/72; Phase 1/2 Memory security 39/39; root and mobile
  typechecks pass; the production Next build passes; changed-file lint and
  `git diff --check` pass. Repository-wide `npm run lint` scanned generated
  `.vercel/output` after the build and failed on generated bundle diagnostics;
  no changed source file has a lint finding.
- Security gate: PASS for this scoped implementation. It changes no auth,
  authorization decision, RLS, Storage policy, service-role boundary,
  notification data or private logging. Hosted deployment and physical-device
  performance are not claimed by this local gate.

### Home post-actions popover follow-up (2026-07-21)

Status: PASS locally; connected physical-device visual and touch-target
acceptance remains required.

- The three-dot action menu is now a screen-level anchored modal. Tapping the
  dimmed area outside it, using Android Back, or issuing the accessibility
  escape action closes it. Recycled posts clear both visibility and anchor
  state, and only the currently open post mounts a modal.
- Ownership and mutation boundaries are unchanged: owners see only Delete;
  other viewers see Report post, Report profile, and Block. Pending mutations
  remain guarded, report and block traffic continues through authenticated API
  routes, and each action closes the popover before its confirmation or reason
  flow.
- The destructive Block row now has a separated danger treatment, the explicit
  `Block user` action label, and a secondary single-line `@username`, with the
  target identity also present in its accessibility label and confirmation.
- Verification: focused Home/action tests 40/40; repository tests 1,628/1,628;
  Memory hardening 72/72; Phase 1/2 Memory security 39/39; root and mobile
  typechecks pass; changed-file lint and `git diff --check` pass.
- Security gate: PASS for this scoped UI change. It does not alter authenticated
  actor resolution, authorization, RLS, Storage policy, service-role access,
  report/block API contracts, notification content, or private-data logging.

### Mobile notification actor-avatar follow-up (2026-07-21)

Status: PASS locally; hosted payload and connected-device visual validation
remain required.

- The authenticated, recipient-scoped notification page now batches each
  already-selected actor's existing public profile avatar URL with its display
  name. The existing string-valued `profileMap` contract remains unchanged for
  the web client; mobile consumes a separate backward-compatible `avatarMap`.
- Notification rows render initials immediately, use the actor URL as the
  Expo Image cache/recycling identity, and retain the initials fallback when
  the URL is missing or image delivery fails. No per-row profile or media
  request was introduced.
- Only bounded HTTP(S) public avatar URLs are returned. No private post/Memory
  media, signed URL, Storage path, source upload, service-role credential,
  notification preview, or additional recipient data is exposed.
- Verification: focused notification/Home tests 66/66; repository tests
  1,629/1,629; Memory hardening 72/72; Phase 1/2 Memory security 39/39; root and
  mobile typechecks pass; changed-file lint and `git diff --check` pass.
- Security gate: PASS for this scoped response enrichment. Authentication,
  recipient ownership, notification validity filtering, cursor bounds, RLS,
  Storage policy, and existing web payload compatibility remain unchanged.

### Mobile notification pagination follow-up (2026-07-21)

Status: PASS locally; hosted pagination and connected-device scroll validation
remain required.

- The mobile notification inbox now explicitly requests 12 rows per page while
  the shared API and web fallback remain at 30. The exact unread aggregate is
  unchanged and remains independent from the page size.
- Pagination begins half a viewport before the end, giving the next 12-row page
  time to arrive before an ordinary phone viewport exhausts its visible rows.
- If validity cleanup removes every row from a page, the screen automatically
  follows at most two older cursors. This prevents the normal empty-page trap
  without allowing an unbounded request chain. A discoverable `Load older
  activity` action remains when additional cursor pages exist after that bound.
- Verification: focused notification tests 15/15; repository tests
  1,629/1,629; Memory hardening 72/72; Phase 1/2 Memory security 39/39; root and
  mobile typechecks pass; changed-file lint and `git diff --check` pass.
- Security gate: PASS for this scoped client pagination change. The API remains
  authenticated, recipient-scoped, cursor-bounded and capped at 50; no RLS,
  Storage, service-role, private-media, notification-content or logging
  boundary changed.

### Home refresh correctness and notification seen-state follow-up (2026-07-21)

Status: PASS locally and on the linked hosted database; hosted API behavior and
connected-device interaction still require deployment validation.

- An explicit pull or active-tab refresh now compares a deterministic
  fingerprint of the first ten visible posts after optimistic engagement
  reconciliation. Post order, copy, author/avatar identity, restaurant data,
  dishes, reactions, counts, media identity/revision/geometry, status, and the
  server revision participate. Merely renewing an expiring signed URL does not
  count as visible change. `You're up to date` appears only after successful
  explicit refresh when those visible fingerprints match.
- `reviews.updated_at` is now a server-owned revision. Direct review updates
  and insert/update/delete changes to ordered `review_photos` advance it, so
  cover-only Home responses can detect metadata and carousel membership
  changes without loading all carousel media.
- Notification inbox visibility is now separate from per-row read state.
  Opening Notifications records a monotonic server timestamp and clears the
  badge, but rows remain unread until opened individually or `Mark all` is
  used. A newer unread notification restores the badge, including across
  devices.
- The inbox timestamp table has RLS enabled and no direct anonymous or
  authenticated grants. Both RPCs derive the owner from `auth.uid()`, require
  an active profile, use an empty search path, and expose no caller-selected
  user or username. The seen mutation is authenticated and rate-limited at the
  API boundary; database errors are not returned to the client.
- Notifications retain the 12-row cursor page. The screen is the sole focus
  freshness owner: the normal first load remains one request, cached data is
  refetched once only when older than 30 seconds, and React Query mount,
  reconnect, and window-focus refetches are disabled for this list. Empty
  validity-filtered pages remain bounded to two automatic cursor advances plus
  a manual fallback.
- Migrations: `202607210001_notification_inbox_seen_state.sql`,
  `202607210002_review_visible_content_revision.sql`, and
  `202607210003_review_media_refresh_revision.sql`, plus the bounded unseen
  lookup indexes in `202607210004_notification_unseen_indexes.sql`.
- Verification: focused Home/notification tests 152/152; repository tests
  1,633/1,633; pgTAP 186/186 on a clean local reset; Supabase database lint has
  no schema errors; Memory hardening 72/72; Phase 1/2 Memory security 39/39;
  mobile API security 11/11 and the 81-route/117-operation inventory pass;
  root/mobile typechecks, changed-file lint, `git diff --check`, and the
  production Next build pass.
- Hosted database apply: the linked push applied exactly migrations
  `202607210001` through `202607210004`. A second linked dry run reports the
  remote database is up to date; linked database lint reports no schema errors;
  the explicit read-only hosted drift audit reports 81/81 canonical migrations,
  99/99 tracked manifest entries, no missing/extra/divergent versions, and no
  critical schema or policy drift. A read-only hosted smoke confirms the inbox
  state table and review revision are available to trusted server access while
  anonymous table and unseen-RPC access remain denied.
- Security gate: PASS for the local implementation and hosted database step.
  Authenticated multi-device badge smoke, 12-row pagination smoke, refresh
  copy/media-change smoke, deployed server/API, a new mobile build, and
  connected-device performance remain required. The database step is complete;
  deploy the server/API before the mobile build.

### Home neutral media-transition follow-up (2026-07-21)

Status: PASS locally; connected-device transition retest remains required.

- The Home fallback remains fixed near-black `#111111`. Source-colored
  BlurHash previews now retain their low-cost spatial hint behind a fixed
  82%-black scrim, preventing bright food-image hashes from presenting as a
  peach loading surface before the thumbnail is painted.
- Cover and carousel progress indicators are now explicitly limited to an
  active media surface with neither a usable thumbnail nor BlurHash preview.
  A thumbnail URL or BlurHash suppresses the spinner; a genuinely unresolved
  selected carousel page retains near-black plus the rotating indicator.
- Thumbnail preparation remains disk-only, first-page bounded and batched.
  The vertical decoded-media window, FlashList retention, scheduler concurrency,
  carousel current-plus-next preparation, geometry and video ownership are
  unchanged, so the visual correction does not broaden memory residency or
  network concurrency.
- Before this correction, the connected physical Android FlashList/Preview
  smoke reported scrolling, reverse scrolling, pagination, carousel gestures,
  refresh, post actions and notification interactions as acceptable; the
  remaining observation was the warm BlurHash transition. That physical result
  is useful smoke evidence, not measured frame/PSS or iOS acceptance. The new
  neutral transition still requires the same-device cold-cache and fast-fling
  retest.
- Verification: focused Home tests 135/135; repository tests 1,634/1,634;
  Memory hardening 72/72; Phase 1/2 Memory security 39/39; root and mobile
  typechecks pass; changed-file lint, the production Next build and
  `git diff --check` pass.
- Security gate: PASS for this scoped client presentation change. It changes no
  authentication, authorization, RLS, Storage path, signed-media delivery,
  persistence, prefetch ownership, service-role boundary or private logging.

## Production Hardening Phase 5 — Backend, Database, and Feed Performance (2026-07-13)

- Inventory/budgets: 16 primary mobile reads, one primary mobile request each, maximum six application-data statements, pages capped at 50, payload budgets capped at 256 KiB, and one named cache owner per first page.
- Feeds: Circle uses `circle_feed_page_v2`; public/restaurant/dish/Profile/detail use `/api/mobile/feed` plus `mobile_public_feed_page_v1`; engagement/profile/media enrichment is batched; mounted feed cards perform zero independent Taste/Trust requests.
- Explore/Profile: `explore_discovery_canonical_v3` is mandatory and fails visibly when absent. Profile shell omits posts and aggregate stats replace the 1,000-row fallback; Profile posts have one infinite-query owner.
- Social reads: comments and notifications use stable opaque `(created_at,id)` cursors and exact aggregate/head counts; identity enrichment is batched. Notification sparse-recipient plans use the stable recipient index.
- Memory: room list has no per-room query loop; bootstrap/chat/media each use one authenticated API request. RPC payloads omit private Storage paths and stored URLs; the server resolves authorized photo IDs and signs paths in one batch.
- Database: migration `202607130009_backend_feed_performance.sql`; 66 canonical migrations/84 manifest entries; pgTAP 57/57. Four harmful/redundant chronological indexes are replaced by stable Circle/public/recipient/Memory cursor indexes.
- Local plan fixture: 10,000 reviews, 2,000 comments, 5,000 notifications, 5,000 Memory messages; all four critical plans use their intended indexes, the representative payload is 17,092 bytes, and concurrent insertion yields zero cursor overlap.
- Local database execution measurements are not Next API p50/p95 or capacity evidence. Hosted staging, connection-pool/Storage latency, concurrency, soak/failure testing, and production capacity remain unverified and belong to the documented staging matrix/Phase 9.

## Production Hardening Phase 4 — Mobile API Security (2026-07-13)

- Inventory: 69 API route files and 93 operations; 62 traced active-mobile operations, nine internal operations, two retired legacy moderation bypasses, and 60 explicitly shared-rate-limited operations. Every traced active-mobile mutation has a policy.
- Identity: active mobile APIs use the memoized canonical Auth UUID/profile resolver; client viewer/actor/owner/recipient/device values do not establish authority. Public feed viewer override was removed.
- Auth: public Auth directory scanning was removed. Existing/missing email OTP requests return identical generic responses with body/rate bounds. OAuth uses PKCE/state. Password/recovery product routes are removed and password token issuance is rejected by the hosted hook.
- Abuse: PostgreSQL atomically applies HMAC-keyed user/IP/install/subject/cost policies across replicas, fails closed, returns Retry-After, and has bounded service-only cleanup. A real 20-request concurrent test admitted exactly five at limit five.
- Notifications/push: token owner is derived from `auth.uid()`, installation is required, cross-account reassignment is rejected, frozen users are denied, recipients are derived, and spam/idempotency/block/preferences are enforced.
- Providers/moderation: Places is authenticated, bounded, weighted, timed out, and sanitized. Generic media remains pending/unclaimable/unpublishable until audited approval; review/avatar image moderation fails closed. Old caller-selected moderation routes return 410.
- Database: canonical migration `202607130008_mobile_api_security.sql`; 65 canonical migrations/83 manifest entries; two Phase 4 state/audit tables plus limiter/idempotency tables are RLS/service-only; Phase 4 extends the service schema contract.
- Local behavior: Phase 4 static/database/HTTP gates pass 10/10, 9/9, and 10/10; pgTAP passes 35/35; upgrades pass 7/7; real Phase 3 policies pass 10/10; drift is zero; and the clean runtime report has no security backlog or privileged grant drift. Phase 1A, 1B, 1C, and Phase 2 regressions pass 13/13, 9/9, 8/8, and 11/11 + 14/14 + 10/10. Root/mobile typecheck, zero-error lint, Next build, Android/iOS exports, Android Gradle release, and secret scans pass. Root tests are 1,077/1,097 with the same 20 PH-002 names as the 1,067/1,087 Phase 3 baseline; Memory remains 71/72 with the same PH-002 assertion.
- Manual release blockers remain exactly those listed above. Local passing tests are not hosted, real-provider, real-device, or 1,000-user capacity evidence.

## Production Hardening Phase 3 — Canonical Supabase Migrations (2026-07-13)

- Selected `supabase/migrations` and root `supabase/config.toml` as the sole executable database authority; retired the mobile config and executable SQL behind a sentinel README.
- Inventoried 29 original root files and 49 mobile files: 16 identical versions, 11 root-only, 31 mobile-only, and two byte-conflicting versions. All 78 original file hashes, categories, dependency hints, and dispositions are locked in `docs/database/migration-history-manifest.json`.
- Promoted 31 unique mobile versions mechanically without editing historical SQL. Preserved both conflicting mobile variants outside CLI discovery; their executable SQL is equivalent to the selected root versions and differs only in comments.
- Added a service-only read-only schema/RLS/Storage/grant contract, real pgTAP, and real Auth/PostgREST/Storage policy actors. The merged chain exposed and additively corrected anonymous public-review denial, missing API table grants on promoted RLS tables, and the older Profile path guard's incompatibility with same-owner Phase 1A private derivatives.
- Added supported historical upgrade fixtures, explicit detection of the incomplete mobile-only state, a read-only local/explicit-hosted drift report, canonical `npm run db:*` commands pinned to Supabase CLI 2.109.1, and independent CI enforcement.
- Final local evidence passes: manifest 64 migrations/82 entries/two conflicts; upgrades 7/7; two resets; pgTAP 21/21; real policies 10/10; drift zero; Profile production/runtime 6/6 and 17/17; Phase 1A runtime 13/13; root/mobile typecheck, zero-error lint, Next build, and Android/iOS exports. The full root suite is 1,067/1,087 with the same 20 PH-002 failures, and Memory remains 71/72 with the same PH-002 failure.
- Hosted history, hosted drift, staged upgrades, Storage/CDN behavior, and backup/PITR are not yet verified. See `docs/production-hardening/PHASE_3_CANONICAL_MIGRATIONS.md` and `docs/database/MIGRATIONS.md`.

## Production Hardening Phase 2 — Production-Reliable Media Processing (2026-07-13)

- Added a canonical job state machine with service-only atomic `SKIP LOCKED` claims, database lease expiry, worker identity, heartbeat, generation/token fencing, deterministic ordering, capped attempts, and reclaim of crashed `running` jobs.
- Added sanitized retry/permanent classification, capped exponential jitter, `rejected`, `dead_letter`, audited eligible requeue, idempotent cancel, and a service-only event stream. Stale workers cannot finalise after reclaim or account freeze.
- Made uploaded-asset job creation atomic through a database trigger. Image/video derivatives use server-derived asset paths and Storage/metadata upserts; the completion transaction verifies the current lease, active account, authoritative visibility/bucket/path, and full derivative set.
- Preserved Phase 1A private post derivatives with no permanent public URL, Phase 1B freeze/deletion fencing and inventory, and Phase 1C account-scoped local files/generation guards. Mobile now persists bounded owner-only upload states and resumes intent, upload, finalisation, and status reconciliation after same-account restart/foreground.
- Added leased cleanup for expired intents, terminal failures, consumed sources after 24 hours, and unattached ready assets after seven days. Cleanup is resumable, path-derived, bounded, idempotent, and account deletion can override retention.
- Added a dry-run-first reconciliation/operator CLI with job/asset/user/global filters, stale/dead-letter/partial/cleanup reporting, an explicit bounded Storage scan for missing/orphaned objects, and confirmation-gated requeue/cancel/cleanup.
- Added a pinned Node 20.19.4 Bookworm Docker worker with ffmpeg/ffprobe, UID 10001, private localhost server, readiness/health, fail-fast configuration, bounded concurrency/temp/timeouts, structured logs, and graceful shutdown. The image built and runtime checks passed locally; it was not deployed.
- Phase 2 tests pass 11/11. Real local database leasing/fencing/retry/freeze/cleanup behavior passes 14/14. Real local JPEG/H.264/invalid-file/Storage/cleanup/reconciliation behavior passes 10/10. Root/mobile typecheck, zero-error lint, Next build, Android/iOS exports, Docker runtime, clean root reset, SQL lint, and artifact scans pass.
- Full root tests move from 1,050/1,070 to 1,061/1,081 only through eleven new passing tests; the same 20 PH-002 failures remain. Memory remains 71/72 with the same PH-002 failure.
- Hosted worker scheduling, two-replica process kills, real infrastructure interruptions, alerts/dashboards, physical mobile restart matrix, source-growth monitoring, dependency-advisory review, and capacity/load validation remain release blockers. See `docs/production-hardening/PHASE_2_MEDIA_WORKER.md`.

## Production Hardening Phase 1C — Account-Isolated Mobile Caches (2026-07-13)

- Added a UUID-owned auth/cache boundary that withholds the authenticated React/navigation tree until session identity, cleanup recovery, legacy deletion, account status, and matching owner hydration are resolved.
- Replaced the global QueryClient/MMKV cache with per-owner v2 Query envelopes and fresh Query clients. Only the existing successful Memory query policy remains persisted.
- Moved Memory SQLite, staged camera/picker/voice/upload media, generated crops/transcodes/thumbnails, Query MMKV and the cleanup journal into account-aware/cache-safe locations. Legacy global Query, SQLite and location data are deleted, never assigned.
- Added a central local-first coordinator and minimal MMKV journal covering logout, switching, invalid/expired sessions, account freeze/deletion, owner mismatch and startup recovery. The active generation is revoked before async cleanup, and corrupt/exhausted state fails closed.
- Added signed-URL expiry metadata and offline stripping, realtime generation guards, recipient-bound push routing, draft/buffer resets, media viewer release, navigation reset, bounded local sign-out, foreground account-status validation and a foreground token-expiry timer.
- Added Android backup/data-extraction XML excluding SecureStore, MMKV and databases while leaving backup enabled for harmless data. The release APK compiled the resources and merged references. iOS account caches use `cacheDirectory`; no native iOS project is checked in.
- Phase 1C behavior tests pass 8/8; Phase 1A and Phase 1B focused tests each remain 6/6; changed Memory security/operations tests pass 25/25; root/mobile typecheck, zero-error lint, Next build, Android/iOS production exports, Android release build, and an isolated generated iOS arm64 device Release build pass.
- The full suite moves from 1042/1062 to 1050/1070 only because eight new Phase 1C tests pass; the same 20 PH-002 failures remain. Memory remains at the existing 71/72 baseline.
- Two-account native runtime, native backup/restore, authenticated iOS runtime, real process-kill injection, framework cache byte inspection and hosted freeze/deletion validation remain unverified release gates. See `docs/production-hardening/PHASE_1C_CACHE_ISOLATION.md`.

## Production Hardening Phase 1B — Complete Account Deletion (2026-07-13)

- Replaced synchronous Auth-first deletion with an owner-only atomic freeze and service-only durable state machine: inventory, verified Storage cleanup, database cleanup, Auth deletion last, completion, and bounded retention purge.
- Added coverage for generic Phase 1A sources/derivatives/privacy-migration variants, review/avatar final and quarantine media, Memory objects/intents, legacy cleanup arrays/stories, and owner-prefix orphans across six buckets. Client paths are never trusted.
- Added immediate discovery/write/upload/fresh-signed-URL suppression for frozen accounts and removed the service-role actor reconstruction bypass caused by Auth metadata fallback.
- Implemented shared Memory ownership semantics: sole rooms are deleted; shared rooms and another member's content remain; deleted-member attribution/content is removed.
- Added moderation retention with reporter/moderator/target anonymization, generic error metadata, hashed ambiguity references, 30-day completed-job retention, and a bounded service-only purge.
- Added a protected worker, lease recovery, bounded retries, dry-run reconciliation with opt-in one-step apply, and scheduler tooling. The legacy `delete_current_account()` now fails closed.
- Clean root reset and SQL lint pass. Real local lifecycle validation passes 9/9, focused changed/security tests pass 35/35, Phase 1A remains 6/6, root/mobile typecheck and Next build pass, and Android/iOS Expo production exports are clean of privileged/development worker names.
- Repository baselines improve from 1030/1051 to 1042/1062 because new Phase 1B tests pass and one changed stale assertion was corrected; the remaining 20 full-suite failures are pre-existing PH-002 UI/architecture assertions. Memory remains at its existing 71/72 baseline.
- Phase 3 retired the mobile migration root and preserved its missing-`post_views` failure as unsupported-history evidence. Hosted Storage/CDN, production-like scale, worker scheduling/alerts, failure injection, and operator recovery remain unverified. See `docs/production-hardening/PHASE_1B_ACCOUNT_DELETION.md`.

## Production Hardening Phase 1A — Visibility-Aware Post Media (2026-07-13)

- Selected private canonical post media with current-authorized, five-minute signed delivery. Public, circle, and me posts now use explicit access classes while post derivatives remain in `media-private`; avatar and Memory behavior retain their existing classifications.
- Added owner-bound visibility-aware upload intents, exact post-creation attachment validation, batched mobile access, web authorization redirects, fail-closed suppression/block/membership checks, and a service-role-only atomic visibility transition RPC.
- Originally added byte-identical root/mobile migrations and an operator-run, paginated, durable, retryable legacy backfill. Phase 3 now retains only the root migration as executable and locks the retired hash. Public post objects must be removed only after private replacement verification.
- Updated active public/Circle/Profile/Explore/detail consumers to use canonical authorized media DTOs. Status/access responses expose no raw Storage path.
- Added Expo configuration containment that rejects public privileged Supabase names and production/EAS development auto-login variables. The ignored forbidden Supabase entry and local auto-login entries were removed without reading or printing values. An Android release scan found the auto-login exposure before containment; the rebuilt Android asset and production Android/iOS exports are clean. Credential-owner assessment and possible cloud rotation remain mandatory because Phase 1A does not rotate credentials automatically.
- Added a repeatable real local validator using four Auth users, actual RLS/Storage objects, active Next routes, and the operator backfill. It passes 13/13, including private direct-read denial, all six visibility transitions, membership/block/suppression/deletion revocation, interrupted-state recovery/idempotency, and exact 300-second URL expiry.
- A clean canonical Supabase reset through Phase 1A and Phase 3 passes. The former mobile history's `post_views` failure remains locked as reconciliation evidence; current runtime gates use the complete canonical chain without a compatibility fixture.
- Physical Android native development-client login/feed/Profile validation passes, the Android Gradle release APK builds, and production Android/iOS Expo exports pass. An isolated temporary iOS prebuild also resolves Nitro/MMKV, builds and locally signs the arm64 Release simulator app, passes the forbidden-name scan, installs, and cold-launches on an iPhone 17 simulator. Authenticated iOS media/revocation validation remains blocked because there is no checked-in native iOS project or staging configuration; Expo Go is not a valid substitute.
- Focused Phase 1A tests pass 6/6; root/mobile typecheck, zero-error lint, and Next production build pass. Existing suite baselines remain `npm test` 1030/1051 and Memory 71/72. Production remains blocked on hosted Storage/CDN and production-like backfill, credential assessment, hosted Phase 3 audit, and native iOS; the five-minute previously-issued URL window is intentional.
- The hosted matrix was not run because this checkout has no Supabase CLI access token or linked staging session; no hosted project was mutated.

## Production Hardening Phase 0 Baseline (2026-07-12)

- Created parent branch `production-hardening` and bounded branch `hardening/00-baseline` from commit `18b608bbfe77ffd10bc31b903b00048e1e64cef1`.
- Added canonical issue register `docs/production-hardening/issues.json` and validation command `npm run validate:hardening-register`.
- Added application-wide, non-path-filtered CI at `.github/workflows/application-ci.yml` for register validation, root/mobile lint, root/mobile typecheck, Memory tests, full tests, Next production build, and Expo Android production export.
- Root lint now excludes generated `mobile/dist`, generated `mobile/.expo`, and the explicitly vendored `mobile/src/vendor` tree. First-party/test warnings remain visible; the scoped result is 94 warnings and zero errors.
- Recorded the reproducible command matrix and failure classification in `docs/production-hardening/PHASE_0_BASELINE.md`.
- No runtime, API, migration, RLS, Storage, media, authentication, navigation, or product-test behaviour was changed.
- Security observation: local Expo environment loading reported `EXPO_PUBLIC_SUPABASE_SERVICE_KEY`. The value was not inspected, no tracked reference or exported variable name was found, and bundle exposure was not proven. `PH-001` blocks production until the unsafe public configuration is removed and any privileged value is rotated.
- Current baseline remains red by design: `npm test` is 998/1044 and `npm run test:memory-hardening` is 71/72. Phase 0 categorizes these failures and does not weaken or rewrite tests to hide them.

## Profile Hardening Blocker Fixes

Status: Ready for staging validation, not production-ready.

The Profile-tab validation blockers found after commit `af8cbdcbf748c35a89e706a48f6b39e0c40d2019` were addressed in the repository:

- Renamed the untracked Profile migration to `202606250001_profile_media_username_hardening.sql`.
- Replaced pending review/avatar uploads to the public `review-photos` bucket with a private `review-media-quarantine` bucket.
- Kept `review-photos` public only for finalized objects written by trusted server code.
- Added Sharp-based server image decode, metadata stripping, orientation normalization, and JPEG re-encoding for review/avatar images.
- Added durable account media cleanup jobs with `pending/running/succeeded/failed`, retry timestamps, attempts, and a protected worker route at `/api/internal/account-media-cleanup`.
- Updated account deletion and post deletion to delete owner-scoped Storage paths first and return `cleanupPending` when durable retry is required.
- Added paginated Storage enumeration for owner-prefixed review/avatar/quarantine paths.
- Refactored the mobile Profile tab so posts and memories render through a primary vertical `FlatList` instead of an outer `ScrollView` wrapping disabled nested lists.

Latest Profile blocker-fix verification:

- `npm test`: 798/798.
- `npm run test:coverage`: 798/798; Node coverage smoke reported 100.00% lines, 77.78% branches, 100.00% functions for the instrumented setup file.
- `npm run lint`: passed with 76 warnings. The previous baseline was 75; the additional warning is from ignored generated file `mobile/.expo/types/router.d.ts`, not a tracked commit candidate.
- `npm run typecheck`: passed.
- `cd mobile && npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run test:memory-hardening`: 63/63.
- `node --test tests/shared-memory-phase1-security.test.mjs`: 19/19.
- `node --test tests/shared-memory-phase2-media-security.test.mjs`: 19/19.
- `node --test tests/mobile-explore-parity.test.mjs`: 18/18.
- `node --test tests/profile-production-hardening.test.mjs`: 12/12.
- `node --test tests/reviews-route.test.mjs tests/review-crud.test.mjs`: 59/59.
- `node --test tests/delete-account-route.test.mjs`: 4/4.
- `node --test tests/review-media-image-validation.test.mjs tests/account-media-cleanup-worker.test.mjs`: covered image decode/re-encode, spoof/corrupt/zero-byte/large-dimension rejection, HEIC rejection, cleanup path ownership, paginated Storage enumeration, and cleanup job owner filtering.

Supabase migration-chain validation status (superseded by Phase 3):

- Supabase CLI compatibility is pinned/documented at 2.109.1; PostgreSQL is 17.
- `supabase/config.toml` and `supabase/migrations` are the only active project/history, and commands run from the repository root through `npm run db:*`.
- The zero-test pgTAP state is closed by a committed contract under `supabase/tests`; CI fails on contract, RLS, Storage, grant, upgrade, or drift errors.
- The former mobile config/history and compatibility-fixture workflow are retired. Historical hashes and conflicts remain in the locked manifest/archive.
- The Profile runtime and production-gate scripts now target the root local stack.

Supabase validation still incomplete before production:

- Local existing-data migration validation now passes with representative legacy media, case-insensitive duplicate preflight, malformed usernames, rollback injection, durable deletion acceptance, cleanup retry, and 0/24/25/500-post pagination. The focused real local Auth/RLS/Storage and HTTP route validator also passes 17/17.
- The same exhaustive matrix still needs to run in disposable production-like staging against the reviewed hosted history and Storage configuration; local success is not hosted evidence.
- Native mobile iOS/Android Profile validation must still run on simulator/emulator/device before production.

## Verified Result

Status: Partial

The repository implementation for phases 1-6 has been audited and final repo-level blockers found during the audit were fixed. Automated repo checks now pass, including the hardening suite, root tests, coverage smoke, lint, root typecheck, production build, and mobile typecheck.

The final audit migration is now visible in the configured Supabase project. This is still not production-ready until real authenticated staging users verify RLS, Storage read/write paths, upload/finalize, cleanup, blocked-user behavior, and seeded-account E2E smoke tests.

## Final Audit Fixes Applied

- Added final migration `202606180007_shared_memory_final_audit_hardening.sql`.
- Added DB-level blocked-user membership and read hardening:
  - `shared_memory_user_pair_blocked(text, text)`
  - stricter `can_read_shared_memory(uuid)`
  - `validate_shared_memory_member_write()`
  - restrictive `shared_memory_members` insert policy
  - updated `create_shared_memory_room()` blocked participant filtering
- Added service-role-only atomic media finalization:
  - `finalize_shared_memory_upload_intent(...)`
  - intent finalization and `shared_memory_photos` insert now commit or roll back together.
- Updated `app/api/mobile/memories/finalize-upload/route.ts` to use the atomic RPC and avoid terminalizing rejected intents before Storage deletion succeeds.
- Updated `app/api/mobile/memories/[roomId]/participants/route.ts` to check blocked relationships before member/invite writes, use generic invite notification text, and emit sanitized memory operation logs.
- Updated account deletion:
  - `app/api/delete-account/route.ts` removes DB-backed memory Storage paths through the service-role helper before calling `delete_current_account`.
  - `mobile/src/services/settings.ts` now calls the server route instead of calling the DB account-delete RPC directly.
- Updated `shared_memory_account_media_paths(uuid)` to include DB-backed legacy username paths only while the profile still exists.
- Updated room list scalability:
  - `shared_memory_room_summaries()` now pages rooms before per-room summary count work.
  - `mobile/src/services/memories.ts` pages through summary RPC results instead of stopping at the first 100 rooms.
- Updated chat/media pagination to use `(created_at, id)` cursor tie-breakers.
- Updated media upload behavior to upload and finalize items sequentially, reducing mobile/server memory pressure for large batches.
- Strengthened CI/local verification:
  - `npm run verify:memory-hardening` now runs hardening tests, full tests, coverage smoke, lint, root typecheck, production build, and mobile typecheck.
  - `.github/workflows/memory-hardening.yml` now includes coverage, lint, and production build.

## Post-Audit Product Changes

- Added Table Memory occasion/title support using the existing `shared_memory_rooms.title` column.
- Added migration `202606210001_shared_memory_room_occasion_title.sql` to replace `create_shared_memory_room(...)` with an optional `p_title` argument while preserving `SECURITY DEFINER`, safe `search_path`, and blocked-user participant filtering.
- Updated mobile Table Memory creation surfaces to collect an optional occasion and removed the create-form subtitle "Save the place you visited with friends."
- Added deterministic Table Memory occasion classification and dynamic occasion themes while preserving the original user-entered title.
- Added migration `202606210002_shared_memory_room_occasion_classification.sql` to store `occasion_type`, `occasion_confidence`, `occasion_confirmed_by_user`, and `theme_key`, plus a member-scoped occasion update RPC with safe `search_path` and blocked-user checks.
- Added private, user-specific local correction persistence for occasion choices. No global name-to-relationship rules or external AI calls were added.
- Updated the Table Memory occasion create fields in both the Share tab create flow and standalone create form to use a free-text room title plus an icon picker for selected occasion metadata through the existing create-room RPC. No Supabase schema, RLS, Storage, service-role, or logging changes were required.
- Removed the Share tab Table Memory place prompt from the create flow. The app now passes the existing required `restaurantName` RPC field as the internal fallback `"Table Memory"` for that flow; no schema/RLS/storage changes were made.
- Updated the mobile profile Memories tab to group memory cards by month in a timeline with orange dots and a connector line, while preserving the original stacked date block with divider, occasion title, place line, and participant, media, dish, and message counts. Dish counts are computed from `shared_memory_dishes.room_id` for already-visible room summaries only; the place line uses existing room summary `restaurantName`/`area` fields, and no dish names, message bodies, media URLs, signed URLs, or storage paths are added to the profile list.

## Memory Room Mobile Performance Blocker Fix (2026-07-12)

Status: Implemented and verified on a connected Android device. Phase 4 remains Partial because the large-media, interrupted/background upload, offline-retry, and signed-URL-expiry staging matrix is still outstanding.

- Heavy room tabs remain lazy, while Chat now background-warms after the Table entry interaction settles. Selecting an already-warmed Chat pane skips the old opacity-zero entrance delay, so the prepared list is revealed immediately without restoring the original room-entry cost.
- The room list and room detail hooks hydrate available SQLite snapshots into React Query immediately, then reconcile with Supabase in the background with a 30-second freshness window.
- Media prefetch is deferred until the Media tab becomes active and is capped to the first 12 gallery items.
- The active chat list now uses bounded initial rendering, batch size, and window size while preserving cursor-based older-message pagination.
- The food-pattern wallpaper is a repeated density-aware raster tile instead of 495 native SVG primitives. The checked-in generator keeps the raster assets reproducible.
- Chat and viewer audio use `expo-audio`; hidden `VideoView` surfaces and their continuous status-driven redraws were removed. Temporary memory-room timing logs and obsolete picture-in-picture properties were also removed.
- Text-message timestamps now reserve a conservative width on the first render and are visible in the same frame as the body. Native width measurement silently refines the reservation instead of controlling timestamp visibility.
- The deployed cursor path was exercised with a 63-message room: page 1 returned 50 with `hasNext=true`; page 2 returned 13 with `hasNext=false`.

Connected Android measurements on `com.circlebites.mobile`:

- Before the fix, a room-open sample rendered 222 frames with 218 janky frames (98.2%), a 40 ms median, 57 ms p90, and frames in the 900-950 ms buckets.
- After lazy mounting and rasterizing the wallpaper, repeated room-open samples rendered the Table surface within 0.5-1.0 seconds with 8.57-13.79% janky frames, 5-23 ms median frame time, and no 900-950 ms frames.
- Media activation showed content within 0.75 seconds and measured 1/32 janky frames (3.12%).
- Chat content and the composer were visible within one second. After settling, a five-second idle sample rendered 0 frames with 0 jank and 0 slow UI/draw events, confirming the former audio-player redraw loop is gone.
- Chat warm-up/timestamp follow-up: after freshly re-entering the room and letting Table settle, the first post-input device capture at 300 ms showed the complete chat list, composer, message bodies, and timestamps together. A 150 ms capture was still on Table because Android had not dispatched the tab selection; no selected-Chat text-only intermediate frame was observed.

Latest scoped verification:

- `npm run test:memory-hardening`: 72/72.
- `node --test tests/shared-memory-phase1-security.test.mjs`: 19/19.
- `node --test tests/shared-memory-phase2-media-security.test.mjs`: 20/20.
- `node --test tests/shared-memory-phase4-mobile-performance.test.mjs`: 17/17.
- `npm run typecheck`: passed.
- `cd mobile && npm run typecheck`: passed.
- `git diff --check`: passed.
- Security gate: passed for this patch. It changes no RLS, Storage policy, service-role boundary, signed-URL behavior, or private-data logging.
- Repository-wide `npm test` remains red on the current dirty branch because unrelated route test harnesses do not mock the new `@/lib/server/media-pipeline` dependency, several unrelated static UI assertions no longer match the branch, and a Profile layout test references a missing file. Repository-wide lint also remains red on existing vendored chat `@ts-nocheck` files and unrelated warnings. These failures are not introduced by the scoped memory-room performance patch; the scoped hardening/security/typecheck gates above pass.

## Automated Verification

Passed:

- `npm run test:memory-hardening`: 55/55.
- `npm test`: 742/742.
- `npm run test:coverage`: 742/742 with Node built-in coverage smoke.
- `npm run lint`: passed with warnings only.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `cd mobile && npm run typecheck`: passed.
- `npm run verify:memory-hardening`: passed end to end.
- `npm run test:e2e`: passed command with 6 public smoke tests passing and 50 seeded-account tests skipped by the suite.

E2E limitation:

- The full account-dependent browser/mobile smoke suite did not run because this checkout does not have `.env.e2e` seeded-account configuration. The Playwright browser runtime was installed and public smoke tests passed.

Latest product-change verification for Table Memory occasion support:

- `npm run test:memory-hardening`: 63/63.
- `node --test tests/occasion-classification.test.mjs`: passed.
- `node --test tests/shared-memory-phase1-security.test.mjs tests/shared-memory-phase2-media-security.test.mjs`: passed.
- `node --test tests/mobile-explore-parity.test.mjs tests/shared-memory-phase1-security.test.mjs`: passed.
- `npm test`: 774/774.
- `npm run lint`: passed with existing warnings only.
- `npm run typecheck`: passed.
- `cd mobile && npm run typecheck`: passed.

Latest product-change verification for Table Memory occasion picker:

- `npm run test:memory-hardening`: 63/63.
- `node --test tests/shared-memory-phase1-security.test.mjs`: 19/19.
- `node --test tests/shared-memory-phase2-media-security.test.mjs`: 19/19.
- `node --test tests/mobile-explore-parity.test.mjs`: 18/18.
- `npm test`: 774/774.
- `npm run typecheck`: passed.
- `cd mobile && npm run typecheck`: passed.
- Expo web smoke reached the authenticated login gate at `http://localhost:8082/memories/create`; visual create-page verification still requires a logged-in session.

Latest product-change verification for profile Memories summary card:

- `npm run test:memory-hardening`: 63/63.
- `node --test tests/shared-memory-phase1-security.test.mjs`: 19/19.
- `node --test tests/shared-memory-phase2-media-security.test.mjs`: 19/19.
- `npm run typecheck`: passed.
- `cd mobile && npm run typecheck`: passed.
- `npm test`: failed in `tests/mobile-explore-parity.test.mjs` on four existing static assertions unrelated to the profile Memories card (`useSlideOverScreen`, Share memory title placeholder, memory header date, dynamic occasion mutation pattern). No DB/Supabase checks were run.
- Stacked-date/divider follow-up: `npm run test:memory-hardening` passed 63/63, `npm run typecheck` passed, and `cd mobile && npm run typecheck` passed.
- Place-line follow-up: `npm run test:memory-hardening` passed 63/63, `npm run typecheck` passed, and `cd mobile && npm run typecheck` passed.
- Place-label trim/empty-state follow-up: whitespace is collapsed before rendering place fields, empty place state now renders `No places added`, `npm run test:memory-hardening` passed 63/63, `npm run typecheck` passed, and `cd mobile && npm run typecheck` passed.
- Month timeline follow-up: cards are grouped by `visitDate ?? createdAt` month and rendered with a fixed orange-dot timeline rail; `npm run test:memory-hardening` passed 63/63, `npm run typecheck` passed, and `cd mobile && npm run typecheck` passed.
- Card-divider brightness follow-up: the vertical divider inside each memory card now uses a higher-contrast muted neutral at partial opacity for better visibility; `npm run test:memory-hardening` passed 63/63, `npm run typecheck` passed, and `cd mobile && npm run typecheck` passed.
- Card-content spacing follow-up: the occasion, place, and stat-icon content now has extra left spacing after the internal divider while preserving date/divider alignment; `npm run test:memory-hardening` passed 63/63, `npm run typecheck` passed, and `cd mobile && npm run typecheck` passed.
- Timeline marker spacing follow-up: the orange timeline dots now use a slightly larger background ring so the connector line has more visible separation around each marker; `npm run test:memory-hardening` passed 63/63, `npm run typecheck` passed, and `cd mobile && npm run typecheck` passed.

## Profile Media Staging Validation Follow-up

- Review/avatar image uploads remain routed through private `review-media-quarantine`, trusted Sharp decode/re-encode, and finalized public `review-photos` objects.
- New review/post video uploads are disabled until a trusted server-side transcode, metadata-stripping, duration, codec, and malformed-file validation pipeline exists. Existing legacy video display data is not migrated or deleted by this change.
- `review-media-quarantine` and `review-photos` MIME allowlists for the Profile hardening migration now allow only `image/jpeg`, `image/png`, and `image/webp` for new review/avatar media.
- Targeted real local Supabase Auth/RLS/Storage validation passed for the Profile media hardening path on the mobile Supabase project. Native iOS/Android Profile validation and production-like existing-data migration validation are still required before production.

## Profile Production Gate Validation

- Real local Supabase validation now runs from the mobile Supabase project with CLI `2.108.0`.
- Clean migration from zero through `202606250001_profile_media_username_hardening.sql` passed with `npx supabase db reset`.
- Existing-data migration validation passed with seeded duplicate case-insensitive usernames, malformed/null username checks, legacy avatar/review/video paths, orphaned owner-prefixed objects, users with 0/24/25/500 posts, private/deleted/hidden posts, identical timestamps, and more than one Storage page of objects.
- Runtime Auth/RLS/Storage gates passed for upload intent, private quarantine upload/read denial, finalization, finalized public reads, overwrite/delete denial, post creation/deletion, username RPC, profile stats RPC, account deletion, cleanup worker retry, and legacy video retention.
- Supabase `db lint` passed with no schema errors; `supabase test db` ran successfully but the project currently has no pgTAP files.
- Native iOS and Android Profile validation is still not complete in this workstation because `simctl`, Android `emulator`, and `adb` were unavailable. Production release remains blocked on real-device or simulator/emulator validation.

## Supabase Verification

Available checks:

- `supabase --version`: failed, CLI is not installed on PATH.
- `mobile/supabase/config.toml`: absent.
- `supabase/config.toml`: absent.
- `.env.e2e`: absent.
- `.env.local`: present and git-ignored.

Live Supabase checks through the configured `.env.local` project:

- `memory-media` bucket exists through the Storage API.
- `memory-media` bucket is private.
- `memory-media` bucket metadata was readable; the current Storage API response did not include file-size or MIME allowlist fields.
- Current sampled `shared_memory_photos` rows: 3/3 passed storage path/public URL/duplicate invariant checks.
- `cleanup_shared_memory_media()` executed with service role and returned zero rows for an empty request.
- `cleanup_shared_memory_media()` was denied for anon with `42501`.
- `finalize_shared_memory_upload_intent(...)` executed with service role and returned `23503 shared_memory_upload_intent_not_found` for a fake intent, confirming the RPC is deployed and reachable.
- `finalize_shared_memory_upload_intent(...)` was denied for anon with `42501`.

Not verified:

- Supabase CLI migration apply/reset.
- Applying `202606210001_shared_memory_room_occasion_title.sql` to staging/production Supabase and creating a real memory room with an occasion title.
- Applying `202606210002_shared_memory_room_occasion_classification.sql` to staging/production Supabase and verifying create/update occasion metadata with authenticated members, non-members, and blocked users.
- Real authenticated RLS direct-insert tests with seeded member, non-member, and blocked users.
- Storage read/write tests with real member and non-member users.
- Deployed staging API smoke with production-like cleanup secret.
- Real push notification device delivery/receipt checks.
- Monitoring-provider alert delivery.
- Backup/restore drill.
- Load/performance testing with large rooms and many-room users.

## Phase Gate Table

| Phase | Status | Implemented Evidence | Tests/Verification | Remaining Gaps |
|-------|--------|----------------------|--------------------|----------------|
| Phase 1: Critical Security Fixes | Pass | DB triggers/RLS for message length, blocked send/upload/notify, media path integrity, same-room message binding, private notifications. Final audit adds blocked read/member insert hardening. | Hardening tests pass; live photo invariant sample passes; final audit RPCs are visible live. | Rerun RLS checks with real member, non-member, and blocked users. |
| Phase 1.1: Final Critical Security Cleanup | Pass | Preflight checks, same-room replies, public URL constraint/null-safe behavior. | Static tests pass; live photo public URL mismatch count is 0 for sampled rows. | Production preflight must be repeated before applying migrations in production. |
| Phase 2: Media Upload and Storage Hardening | Partial | Upload intent/finalize flow, private bucket, MIME/extension/size/magic-byte checks, pending visibility, signed URLs, cleanup RPCs. | Static tests pass; live bucket is private; finalize and cleanup RPC role gates pass. | Image dimensions/video duration remain client-enforced only; full staging user-path media tests still required. |
| Phase 2.1/2.2: Trust Boundary and Cleanup | Partial | Client direct media-row insert removed; one-use intent/path indexes; cleanup skips valid media; final audit adds atomic finalize and account media sweep usage. | Hardening tests pass; cleanup and finalize RPC role gates pass live. | Run direct insert/replay/pending visibility/cleanup safety SQL tests with real authenticated staging users. |
| Phase 3: Database and Scalability Fixes | Partial | Indexes, bounded summary RPC, mobile room-list paging, `(created_at,id)` chat/media cursors. | Static tests and typechecks pass. | Need `EXPLAIN`/load verification with large room and many-room data after migrations are deployed; durable message idempotency/rate quotas remain future work. |
| Phase 4: Mobile Performance Fixes | Partial | Lazy room panes, cache-first SQLite hydration, bounded chat/media render windows, activation-scoped media prefetch, raster wallpaper, disk cache hints, audio-only playback surfaces, sequential upload/finalize, and compression/size guards. | Hardening/performance tests and root/mobile typechecks pass; connected Android room, Chat, Media, idle-redraw, audio playback, and 63-message pagination smokes pass. | Needs real-device large-media memory test, interrupted/background upload test, offline retry validation, and signed-URL expiry smoke. |
| Phase 5: Monitoring and Operations | Partial | Sanitized `recordMemoryOperation`, no raw memory notification/participant error logs, cleanup/account-delete count-only logs, docs for metrics/alerts. | Static tests and lint pass. | No real metrics sink, crash reporting, alert policy, notification receipt monitoring, backup/restore drill, or scheduled cleanup proof. |
| Phase 6: Tests and CI/CD | Partial | Hardening workflow, expanded verify script, static regression tests, build/lint/typecheck coverage. | `npm run verify:memory-hardening` passes; `npm run test:e2e` passes 6 public tests with 50 skipped. | CI run status not verified from GitHub; Supabase CLI/staging DB tests unavailable; account-dependent E2E skipped without `.env.e2e`. |

## Required Before Beta

- Rerun README manual SQL/RLS checks with seeded authenticated users for direct media insert rejection, duplicate intent/path rejection, pending visibility, blocked member/read behavior, atomic finalize, account media path helper, and cleanup safety.
- Run `npm run test:e2e` with `.env.e2e` seeded accounts so the skipped account-dependent tests execute.
- Run a staging app smoke for text, image, video under 25 MB, blocked user send/upload/notify, participant invite blocking, account deletion media cleanup, and cleanup endpoint idempotency.

## Required Before Production

- Repeat all beta checks against a production-like staging environment.
- Run production preflight SQL for existing media rows, duplicate paths/intents, blocked relationships in existing rooms, and legacy username paths before applying migrations.
- Verify GitHub Actions `memory-hardening` passes on the PR/branch.
- Configure real monitoring/alerts for upload intent, finalize, cleanup failures, notification failures, storage growth, crash rate, and auth/RLS failures.
- Schedule cleanup endpoint execution with `MEMORY_UPLOAD_CLEANUP_SECRET`.
- Complete backup/restore and migration rollback rehearsal.

## Optional After Launch

- Add durable client idempotency keys for text/media messages.
- Add per-user/per-room quotas and rate-limit tables.
- Add server-side media probing for actual image dimensions and video duration.
- Add background upload queue and resumable uploads.
- Add load/performance tests for large rooms and many-room users.

## Phase 9 load, fanout and resilience status

Phase 9 adds a production-rejecting, staging-allowlisted Node 22 harness for authenticated HTTP/RPC, Memory Realtime fanout, private Storage/media-worker processing, deterministic synthetic seeding/cleanup, controlled failure recovery, reconciliation and capacity aggregation. Actor sessions remain isolated and in memory; results exclude tokens, content, signed URLs and private paths. RLS, private media, moderation and rate limits remain enabled during every normal workload.

The model is 1,000 registered users, 200 DAU, 100 peak concurrently active users, 30 Memory rooms and 20 concurrent uploads, with 2× stress and a four-hour soak. This is a target, not a result. No hosted staging identity/topology/release, Realtime/provider evidence, failure controller, provider restore or signed physical-device run is available in this checkout.

Security conclusion: **NOT PROVEN** for hosted capacity. Any unauthorized Realtime delivery, cross-account state, private-media access, deletion resurrection or reconciliation drift is a zero-tolerance release blocker. The allowable implementation gate is `PASS LOCALLY — HOSTED CAPACITY NOT PROVEN`; it does not authorize a 1,000-user readiness claim.

## Memory Room release performance and resilience acceptance

The 2026-07-28 production-like Android acceptance result is **FAIL**. The
signed, minified Hermes release/profile APK completed all 12 directed tab
pairs, a 31-minute authenticated soak, three true offline/reconnect cycles, and
pending text/reply/ambiguous-success process-kill recovery with zero
crash/ANR/OOM. The APK privacy/secret scan passed, instrumentation was disabled
by default and emitted only stable content-free marker names and aggregate
resource/SQLite counters, and disposable fixture rows/files were removed.

Release remains blocked because active-soak PSS grew 91.0 MiB without a proven
plateau, soak FrameTimeline jank was 34.57% with a 30.14 ms p95, the requested
moto g57 power/lower-memory Android and physical iOS were unavailable,
moderate/poor shaped-network and pending-media process-kill cases were not
completed, and the independent Next 15.5.20 Turbopack build still stalls with
an idle worker. The full A–O evidence and exact gate classification are in
`docs/performance/MEMORY_ROOM_RELEASE_ACCEPTANCE_2026-07-28.md`.

### Focused release-jank follow-up

The 2026-07-28 focused blocker-fix result remains **FAIL**. Dishes now uses a
bounded virtualized window, Chat projection/unread ownership now survives
active-only tab remounts, Chat initial rows are reduced, completed local-read
promises release the room graph, and explicit profile counters prove stable
query/entity cardinalities. The 20x physical series on a Motorola edge 70
fusion reduced Chat -> Dishes usable p95 from 284 ms to 140 ms and removed the
repeated 200–250 ms bucket, but frame p95 remained 121 ms. Chat-entry usable
p95 remained 202–214 ms because cold native Chat creation still inserts about
260 Fabric instructions.

The 10-minute micro-soak completed 40 tab transitions, 20 text/reply sends, 10
replies, 10 ratings, 10 entries, 11 exits and three background/foreground
cycles with zero crash/ANR/OOM. PSS nevertheless grew 101.9 MiB and resumed
growth after a brief cycle 6–8 shelf; exit +60 s retained 67.8 MiB over the
soak start. The required 30-minute run was therefore not started. RLS, private
media, authentication, rate limits and persistence contracts were unchanged.
All Memory-focused gates, typechecks, zero-error lint, signed APK build/scan,
and standard Next build pass; the full root suite retains the same 20 unrelated
branch failures. Full evidence is in
`docs/performance/MEMORY_ROOM_RELEASE_JANK_FIX_2026-07-28.md`.

A follow-up product-model correction removes the dormant dish-to-place UI
path: Table/Place cards now render stops only, Add Dish always creates a
room-level dish, and physical fixtures no longer populate legacy dish
`stop_id`. The compatibility column remains readable for old rows, but is not
written or displayed by the mobile flow. This makes the original Table ->
Chat fixture conservative rather than canonical and does not change the FAIL
classification established independently by Media/Dishes -> Chat and the
memory micro-soak.

### Chat lifecycle and native-memory candidate experiment

The 2026-07-28 controlled lifecycle result is **FAIL**. Four profile-only
candidates—active-only cold mount, content-free retained shell, bounded warm
Chat and press-down precreation—each completed 80 priority transitions on the
same authenticated Motorola edge 70 fusion. All 320 official presses selected
the destination once, host/input ownership remained at most one, the room
Realtime owner remained one, inactive candidate surfaces were
non-interactive/accessibility-hidden, and there was no fatal crash.

Candidate C reduced Chat-entry Fabric native-view creation from 291–292 to
88–89, but its frame p95 remained 48–53 ms, Chat -> Dishes reached 117 ms, and
the full Stage A run grew PSS 110.9 MiB. The other candidates grew
99.3–152.8 MiB and also missed the provisional frame budget. Native heap grew
61.6–101.9 MiB while Java heap finished lower for every candidate, isolating
the remaining measured owner group to React Native/Fabric native
view/text/layout/gesture/composer construction and allocator high-water
behaviour without a proven plateau. Focused exits released 20–24 MiB by +60
seconds, but did not erase the active-run failure.

No candidate passed Stage A, so Stage B, the three 50-transition plateau
blocks, the ten-minute micro-soak and the full 30-minute release matrix were
not run. Store production remains on the cold active-only default; the
selector and shell profiling are rejected in production configuration. No
RLS, Storage, private-media, authentication, rate-limit, schema or persistence
contract changed. Focused Memory gates pass 198/198 (14 rapid-send, 105
hardening and 79 journey/performance/profile); both typechecks, zero-error
lint, the standard Next build, all signed APK scans and signatures also pass.
The full root suite remains 1,765/1,784 with 19 unrelated existing failures.
Full evidence:
`docs/performance/MEMORY_ROOM_CHAT_LIFECYCLE_EXPERIMENT_2026-07-28.md`.

### Chat row/list renderer experiment

The 2026-07-28 renderer result is **FAIL**. A stable lightweight row store,
plain-text fast row, lazy screen-level actions and direct FlatList/FlashList
paths were implemented behind a non-production profile selector. On the same
authenticated Motorola edge 70 fusion and an isolated cached 50-message room,
the lightweight paths reduced Chat-entry native-view creation from 289 to
127/115. They did not meet the 20 ms frame-p95 gate: vendored, FlatList and
FlashList measured 77, 46 and 73 ms respectively. Direct FlatList grew active
PSS 65.5 MiB; FlashList stayed at 35.1 MiB but ignored one Chat -> Table press
before a successful 50-cycle retry.

No candidate passed Stage A, so reply/media expansion, stable-host selection,
three-block plateau, micro-soak and full acceptance were not run. Production
continues to resolve to the vendored cold active-only renderer; configuration
rejects profiling/render selectors in production. RLS, private Storage/media,
authentication, rate limits, offline/outbox behavior and persistence contracts
are unchanged. Rapid-send is 14/14, Memory hardening 105/105, journey 15/15,
Phase 4 50/50 and renderer/profile 20/20; both typechecks, zero-error lint,
standard Next build, three signed APK scans and signatures pass. The full root
suite remains 1,771/1,790 with 19 unrelated existing failures.

Full evidence:
`docs/performance/MEMORY_ROOM_CHAT_RENDERER_EXPERIMENT_2026-07-28.md`.

### Native recycled Chat implementation

The 2026-07-30 Android native-recycler work is **NOT ACCEPTED — PHYSICAL
STAGE A FAILED**. A profile-only Expo Android module now gives a native
`RecyclerView` ownership of Stage 1 text/reply/date/unread rows, native
anchoring, stable-ID diffing and a bounded view-type-specific recycled pool.
JavaScript remains authoritative for authentication, canonical messages,
optimistic/outbox state, HTTP/Realtime reconciliation, SQLite, pagination and
monotonic read position. The existing native composer and keyboard-inset host
are unchanged. Unsupported rich rows and missing/failed native registration
fall back to the vendored renderer; production still rejects the selector and
defaults to the vendored cold active-only path.

Unread lookup is bounded locally around the first indexed incoming row and by
a member-scoped server anchor page. Opening native Chat no longer marks all
messages read. Visibility advances a debounced local/server position through
`mark_shared_memory_read_v1`, whose local pgTAP matrix passes 8/8 and proves
authenticated-only execution, membership-aware state, monotonic multi-device
merge and future-time clamping. All 90 migrations reset locally and the
manifest validates 90 canonical/108 historical entries. The repository-wide
pgTAP result remains 224/225 solely because the pre-existing
`media_assets_memory_full_frame_check` constraint is intentionally
unvalidated.

The linked Supabase project applied
`202607290001_shared_memory_monotonic_reads.sql` on 2026-07-31. The post-apply
remote ledger matches all 90 local migrations through `202607290001`, and a
second linked `db push --dry-run` reports the database is up to date with zero
pending migrations. This closes only the migration-deployment item; it does
not change the rejected native-renderer result or the broader production
release blockers.

The initial native physical timing is invalid performance evidence. Although
its metadata reported 50 rows, the `RecyclerView` remained at alpha zero
because reveal could race the post-anchor layout. The corrected native module
installs a generation-scoped pre-draw listener before `requestLayout`, and
requires the expected row count, non-zero bounds, attached visible message
cells, a valid visible range and a visible latest/unread anchor before setting
alpha to one. A bounded four-frame fallback uses the same predicate. Stale or
detached callbacks cannot reveal; exhaustion keeps the view transparent,
emits a content-free failure event and safely selects the vendored renderer.

Focused verification passes: native renderer/reveal source tests 10/10,
debug/release Kotlin module tests including adapter/layout ordering, once-only
generation reveal, empty-room handling, stale generations and failure paths;
rapid send 14/14; Memory hardening 105/105; combined journey/Phase
4/release-profile checks 124/124; both typechecks; zero-error lint; signed
Android release assembly; both standard and Turbopack Next production builds;
and `git diff --check`. The full dirty-branch repository result is
1,803/1,813; the same ten unrelated Review, Profile, Explore and post-media
source-contract assertions fail. The corrected signed,
minified Hermes native preview APK is
`com.circlebites.mobile.preview` (SHA-256
`55e192d0ddde94555e26dc46742624bca16a7706ef4bd3024148b10d6040877f`),
has one signer and verifies under APK v2/v3. The generated Hermes bundle
contains no service-role name, `.env.local` marker or developer workspace
path. The strict whole-APK privacy gate remains blocked because React Native
native libraries contain absolute build paths.

The corrected native APK and a newly built vendored control were physically
exercised on the same unlocked Motorola edge 70 fusion, preview API, signer,
account and cached 50-text-message room. Both completed 30 `Table -> Chat` and
30 `Chat -> Table` transitions with zero fatal errors. Vendor Chat visibility
was proven through accessible message nodes. Native visibility was proven on
all 30 measured entries with alpha one, exactly 50 logical rows, 15 visible
rows, non-zero bounds, attached cells and the requested anchor inside the
visible range; no native reveal failure occurred.

The visible vendored control recorded 109 ms `Table -> Chat` frame p95,
271.024 ms fully-usable p95, +126,878 KiB entry-block PSS and +159,437 KiB
whole-run active PSS. The corrected native candidate recorded 61 ms
`Table -> Chat` frame p95, 104.648 ms first-frame p95, 104.697 ms
fully-usable p95, +74,818 KiB entry-block PSS and +142,648 KiB whole-run
active PSS. Native `Chat -> Table` was 18 ms p95 but added another
61,210 KiB PSS; process views grew from 670 to 10,125. It materially improves
the visible control, but still misses the unchanged 20 ms frame budget by
41 ms and exceeds the 40 MiB PSS-growth budget.

Stage A therefore rejects the architecture in its current lifecycle. Per the
required stop rule, unread, rapid-send/reply, plateau, soak and
rich/media-cell physical stages were not started. Production continues to use
the vendored renderer. The Android/iOS parity and authority contract plus
content-free evidence paths are documented in
`docs/performance/MEMORY_ROOM_NATIVE_CHAT_ARCHITECTURE_2026-07-29.md`.

### Memory Room header selector geometry follow-up

The 2026-07-29 UI correction restores the established compact selector
geometry: each Table/Chat/Media/Dishes control is 34 dp high inside a 38 dp
track, and the expanded room header is 183 dp high. This leaves the original
10 dp clearance between the selector and the header divider, so the divider is
rendered as one continuous line instead of two exposed edge fragments. The
first-frame tab-width calculation now also includes the header's 18 dp outer
insets, matching the measured layout immediately and avoiding a later
horizontal indicator correction.

Memory hardening passes 105/105, the focused room/profile checks pass 70/70,
both root and mobile typechecks pass, and changed-file lint has zero errors
(existing warnings remain). The full root suite retains the same 19 unrelated
branch failures. Physical screenshot verification was deferred because the
connected Android device was in an active phone call; no app interaction was
performed while the call was active.

Security conclusion: no RLS, Storage, private-media, authentication,
rate-limit, API, database, offline/outbox, persistence or logging contract
changed.

The failed-delivery follow-up treats `Not sent · Retry · Cancel` as a message
row for spacing. The failed bubble groups into the recovery row at 3 dp; the
recovery row then uses the normal 3 dp grouped or 10 dp group-break spacing to
the following message or composer. The former extra 4 dp top and 2 dp bottom
offsets are removed for both text and media failures. Verification is
intentionally deferred to the connected-device test requested by the user.

### Media processing and optimistic bubble latency follow-up

The 2026-07-29 scoped result is **PASS WITH BLOCKERS**. Ordinary outgoing text
now enters a screen-owned, same-client-ID overlay synchronously with the native
submit, before React Query, SQLite and HTTP. The production row projection
performs an incremental newest-row insert and same-identity confirmation;
unchanged rows retain their object references and a normal insert affects only
the new row plus its immediate grouping neighbour. The existing timestamp,
profile icon, bubble-tail, reply animation, bottom anchoring and visual
renderer remain in place.

Durable media state is now distinct from source-upload failure. An uploaded
asset remains `processing` or `processing_delayed` when bounded polling ends;
retryable worker failure becomes `processing_failed`, permanent rejection
becomes `rejected`, and only an actual source/send failure is shown as
`Not sent`. Targeted retry calls the authenticated, rate-limited
`/api/media/retry` contract and requeues the same owner-scoped asset/job without
uploading the source or creating a second logical row. Client callers cannot
claim jobs; service-role enforcement remains inside the database RPC.

The continuous worker is defined as two Render background-worker instances in
`render.yaml`, using the hardened Node 22/FFmpeg image, atomic database claims,
bounded concurrency/backoff, five-minute leases, heartbeats and a five-minute
graceful shutdown. `docs/operations/MEDIA_WORKER_DEPLOYMENT.md` records the
exact provider setup, secrets and verification commands. The local image built
successfully and reported Node 22.18.0 and FFmpeg 5.1.9.

Hosted acceptance is still blocked. No authenticated Render CLI/provider
session is available in this workspace, so the service was not deployed.
Read-only production health at `2026-07-29T16:04:41.502Z` reported 2 queued
jobs, 0 running jobs, no worker heartbeat, no lease/reclaim activity and an
oldest queued age of 255,991 seconds. The queue and worker-unavailable alerts
were critical. A proposed one-shot production drain was not run because
processing shared production jobs requires explicit authorization. The
Supabase migration history is current through `202607270001`; the health
report's `migrationHeadMatches: false` reflects missing/stale release metadata,
not an unapplied migration for this change.

Scoped verification passes: media-worker plus focused latency/state tests
16/16, rapid-send 14/14, Memory hardening 105/105, and combined
journey/Phase-4/release-profile 85/85. Root and mobile typechecks, zero-error
lint, Next production build and `git diff --check` pass. The complete
repository suite is 1,793/1,803; its ten failures are existing Review,
Profile and Explore contract assertions outside this Memory Room change.

The connected Motorola edge 70 fusion was recognized and both debug and
release APKs built and installed, but the physical runs stopped at setup
because the phone was behind the secure Android keyguard. The release artifact
is a 138,331,124-byte minified Hermes APK; APK Signature Scheme v2 verification
and the embedded-bundle privacy/secret scan pass. No chat timing samples were
produced, so the required `<= 50 ms` p95 optimistic first-layout budget,
physical 8/50-row and text matrices, and hosted image/video matrix are not
claimed.

Security conclusion: authentication, room membership, RLS, private Storage,
service-only worker claims, rate limits, bounded request bodies, stable
idempotency and privacy-safe logging remain enforced. Whole-application
production release remains blocked by the inactive hosted worker, missing
hosted/physical media evidence, missing physical optimistic-latency evidence,
the ten unrelated root-suite failures and the independently documented Memory
Room release-performance failure.

### Chat earlier-history affordance follow-up

The Chat header no longer shows `Load earlier messages` when the cached
server-backed message count already meets the room summary's known total.
Pending and failed optimistic rows are excluded from that comparison. When the
summary is absent or reports more messages than the local replica, the
existing offline-first boundary lookup and cursor pagination remain enabled.
This is a client presentation correction only; message authority, SQLite,
HTTP/Realtime reconciliation, authentication, membership, RLS, private media
and logging contracts are unchanged.

Focused Phase 4 checks pass 50/50, Memory hardening passes 105/105, Phase 1/2
security checks pass 39/39, both typechecks and zero-error lint pass, and
`git diff --check` is clean. The full dirty-branch suite remains 1,803/1,813
with the same ten unrelated Review, Profile, Explore and post-media contract
failures.
