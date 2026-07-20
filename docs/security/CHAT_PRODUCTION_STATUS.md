# Chat Production Status

Current phase: Production Hardening Phase 9 — load, soak, fanout, failure recovery and capacity proof

Production-hardening program phase: Phase 9 — production-rejecting hosted load harness, deterministic synthetic data, authenticated mobile API traffic, Realtime and private-media fanout, failure recovery, reconciliation, external evidence binding and an explicit capacity gate

Phase 8 implementation status: PASS locally on `hardening/10-native-release`. Production configuration rejects missing, placeholder, localhost/LAN, development-channel and privileged-public values; production identity is CircleBites with `com.circlebites.mobile` and `circlebites://`; OTA is disabled; Android release signing fails closed and production manifest/backup/permission policy is hardened; generated iOS production policy, usage strings and privacy manifests are validated; Google OAuth callbacks are environment-bound and replay-safe; owner-scoped post drafts survive termination and join account cleanup; release/store/device documentation and manual release CI are present.

Phase 8 release verification status: BLOCKED. The local Android APK/AAB use an explicitly disposable non-debug validation key, not the production upload key; Apple distribution signing/archive/IPA, production APNs, real OAuth/provider credentials, protected EAS production variables, physical Android/iOS installs/upgrades, two-account private-media/upload/push/auth/accessibility matrices, hosted staging, live Sentry symbolication, legal approval, store-console declarations/review and Phase 9 capacity testing remain external gates. PH-001, PH-002 and PH-003 are not hidden or declared resolved.

Local evidence includes Android APK/AAB release builds with R8/resource shrinking, mapping/native symbols/Hermes maps, signature/package/version/merged-manifest inspection and artifact scans; an arm64 generic-iPhone Release compile with privacy manifest, minimal generated Info.plist, dSYM and Hermes map; environment/EAS inventory validation; clean root production dependency audit; mobile audit with 18 moderate and no high/critical advisories; passing Phase 8 and Phase 1A–7 focused regressions; root/mobile typechecks; zero-error lint; Memory hardening; canonical database reset/policies/upgrades/drift; and Next production build. Exact command totals and hashes are recorded in `docs/production-hardening/PHASE_8_NATIVE_RELEASE.md`.

Next required work: execute the Phase 8 external release gates and the checked-in Phase 9 hosted/physical matrix on disposable production-like staging.

Required sequence: assign PH-001 credential ownership and rotate if privileged; adjudicate PH-002 and the PH-003 Expo advisory chain; configure protected staging/EAS/Apple/Google/APNs/OAuth/Sentry/load credentials; deploy canonical disposable staging; build production-signed candidates; execute the documented physical-device, two-account, install/upgrade, push, auth, media, deletion and accessibility matrices; obtain legal/store declaration approval; execute Phase 7 hosted drills; then run the Phase 9 launch, stress, soak, recovery, restore and physical-device evidence matrix. Do not publish automatically.

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
- Vercel Preview deployment now uses the explicit `vercel.preview.json` local
  config and a local-build/prebuilt-upload workflow through
  `npm run deploy:preview`. The alternate config retains the Mumbai region but
  omits production cron registration because Preview does not execute those
  schedules and the linked Hobby project rejects sub-daily cron definitions.
  Prebuilding prevents the remote builder from rediscovering the root
  production config. The production `vercel.json` schedule inventory is
  unchanged. The Preview config, explicit target, pinned CLI, prebuilt upload,
  and absence of `--prod` pass 2/2 focused deployment tests; an actual remote
  deployment is still external evidence.

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
