# Witoh Production Hardening — Phase 1C Cache Isolation

Date: 2026-07-13
Branch: `hardening/03-cache-isolation`
Parent: `8e1728db5141ced59cd1cdffe924afc8ec5e6b69`

## Executive result

Phase 1C replaces the mobile app's global authenticated cache lifecycle with an account boundary. A Supabase Auth UUID is resolved before any authenticated React tree, Query client, persisted Query payload, Memory SQLite database, account preference, or app-owned media directory can open. Alice and Bob receive different clients, MMKV namespaces, database directories, filesystem directories, SecureStore keys, async generations, and navigation trees.

Cleanup is local-first, idempotent, journaled, and independent of server sign-out. The app revokes the active generation before awaiting realtime, cache, database, file, preference, and local-auth cleanup. A prior cleanup must complete before another owner can hydrate. A corrupt or exhausted cleanup journal fails closed.

Implementation status: **PASS locally**.
Release verification status: **blocked outside this phase** on hosted/disposable-staging execution, a two-account native runtime matrix, Android backup/restore, authenticated iOS runtime verification, and the existing production blockers including PH-001, PH-002, and PH-301. No hosted project was mutated.

## Architecture selected

```text
Supabase INITIAL_SESSION / auth event
  -> neutral AccountSessionBoundary (no private screens)
  -> validate local JWT expiry and canonical user UUID
  -> resume or complete prior cleanup journal
  -> delete unsafe global legacy caches once per schema version
  -> open owner-scoped MMKV, SQLite, files, and SecureStore keys
  -> restore only a matching Query envelope
  -> validate online identity/account state when available
  -> mount a new owner-only QueryClient and navigation tree
```

Every account transition unmounts the prior tree before cleanup begins. A new `QueryClient` is allocated per owner transition; the app never clears and reuses an Alice client as Bob's client.

## Canonical cache-owner identity

`mobile/src/security/cacheOwnership.ts` defines local schema version 2 and the canonical `CacheOwner`:

```text
userId: normalized authenticated Supabase UUID
scope: the same UUID normalized to 32 lowercase hexadecimal characters
schemaVersion: 2
```

Email, username, display name, and profile name are not cache-owner inputs. Invalid UUIDs are rejected. Owner changes increment an in-memory generation; late async work must prove its generation is still active. The scope is used internally in filenames and keys but is never emitted by diagnostics or logs.

## Local-data ownership inventory

| Store | Identifier/location | Data | Owner and retention | Cleanup and verification |
|---|---|---|---|---|
| Supabase Auth | SecureStore adapter key `circlebites.auth.<host>`, optional `.chunks` / `.chunk.N`, and code verifier | Access/refresh session and authenticated UUID | One active Supabase session; retained until invalidation/logout | Bounded local sign-out and direct adapter removal; Android SecureStore backup exclusion |
| Cleanup/security MMKV | `circlebites.local-security.v2` under OS cache `circlebites-mmkv-v2` | Active scope, minimal cleanup journal, legacy marker/counts | Device-local security control data; no content/token/raw user ID | Removed/updated by coordinator; sanitized `localDataDiagnostics()` |
| React Query MMKV | instance `circlebites.query-cache.v2.<scope>`, key `circlebites:query-cache:v2` | Successful `memories` queries only, including temporary private Memory DTOs | Verified owner envelope, schema 2, 7-day maximum | Stop persister, clear QueryClient, remove owner key; focused owner-mismatch tests |
| Legacy Query MMKV | instance `circlebites.query-cache`, key `circlebites:query-cache:v1` | Former unowned Memory Query payload | Ownership unprovable | Deleted once per v2 migration; never assigned to the next session |
| Memory SQLite | `<cache>/circlebites-private/v2/<scope>/circlebites-memory-offline-v2.db` | Room summaries/snapshots, messages, replies through message payloads, photos/videos/audio, signed URL records, timestamps | Per-account directory and `local_cache_meta`; rows pruned after 7 days | Close prior handle, delete only prior scope; behavioral Alice/Bob DB test |
| Memory SQLite tables | `local_cache_meta`, `memory_room_summaries`, `memory_room_snapshots`, `memory_messages`, `memory_photos` | Owner proof plus offline Memory data | Bound by the opened owner database | Owner/schema mismatch rejects DB; existing pagination indexes retained |
| Legacy Memory SQLite | default `circlebites-memory-offline.db` | Former globally queryable Memory data | Ownership unprovable | Deleted, never migrated to current user; presence is fail-closed in diagnostics |
| App-owned account files | `<cache>/circlebites-private/v2/<scope>/` | Picker/camera copies, voice recordings, crops, re-encodes, transcodes, generated thumbnails, SQLite file | Active owner generation; cache retention until upload/logout/OS eviction | Staging validates owner before and after copy; cleanup deletes only exact scope |
| Account profile fallback | SecureStore/localStorage `circlebites.account-profile.v2.<scope>` | Minimal actor ID, username, display name, account type | Same UUID owner only; used only for explicit bounded offline policy | Envelope/user ID checked; deleted on all account-ending transitions |
| User location | `user_location_*:v2:<scope>` in SecureStore/localStorage | Coordinates, label, place ID, source, timestamp | Account-scoped | Generation-guarded reads/writes; owner keys deleted; legacy global keys deleted |
| Occasion corrections | `table_memory_occasion_corrections:v2:<scope>` | Private local classification corrections | Account-scoped by Supabase UUID | Generation-guarded; owner key deleted |
| Device theme | existing global theme key | `system`, `light`, or `dark` | Deliberately device-wide and non-account-sensitive | Preserved |
| In-memory Query state | one `QueryClient` inside `AccountSessionBoundary` | All active queries, mutations, optimistic snapshots, signed DTOs | Current mounted owner only | Prior tree unmount, cancel, clear, discard client |
| In-memory drafts/buffers | post and Memory capture maps, composer, comments sheet, pending Memory delete batches, recent media expiry map | Selected media, captions, messages, pending optimistic metadata | Current owner generation/tree | Central registry plus store reset; screen state disappears with boundary unmount |
| In-memory media caches | Memory prefetch keys, generated thumbnail maps/promises, viewers/players | Signed URL references and private thumbnail URIs | Current owner generation | Generation rejection, registry clear, app-owned thumbnail deletion, tree unmount |
| User search cache | module LRU map | Profile search results/exclusions | Potentially account-dependent due access context | Registry clear on transition |
| Realtime | Supabase Memory room/list channels and debounce timers | Prior-account events and invalidations | Captured active generation | `removeAllChannels`, effect unsubscribe, timer clear, generation checks |
| Push navigation | notification-response listener and handled ID ref | Notification routing identifiers | Active session user ID, with username fallback only for legacy-compatible assertion | Listener removed on tree unmount; new pushes carry recipient UUID/name; mismatches ignored |
| AsyncStorage | none found in active mobile source | N/A | N/A | Repository search evidence |
| Offline mutation queue | no persistent general queue found | React Query mutations and screen-local optimistic work only | Current client/tree | Client and drafts cleared; no mutation persistence enabled |

## React Query isolation

- Hydration moved out of the global provider and occurs only after session owner resolution.
- The persisted envelope contains `ownerScope`, schema version, buster, timestamp, and the dehydrated client.
- Only successful `memories` queries remain eligible; Circle, Explore, Profile, notifications, and other feeds were not newly persisted.
- Corrupt, incomplete, wrong-owner, wrong-version, expired, or wrong-buster payloads are rejected and removed.
- The previous persister unsubscribes before cleanup, and its QueryClient is canceled, cleared, and abandoned.
- Owner MMKV lives under the OS cache directory so iOS does not back it up. The default legacy MMKV path is opened only to remove the old v1 key.

## Memory SQLite isolation

Phase 1C selected a per-user database rather than a shared owner column. The database opens only after UUID resolution and under the account directory. `local_cache_meta` proves the scope and schema. Owner change closes the old handle before any new handle opens. The old global database is deleted because ownership of its rows cannot be proven.

Normal indexes for summary ordering, `(room_id, created_at, id)` message/media pagination, and message-photo lookup remain. Cleanup releases the handle and deletes only the validated 32-hex owner directory/database. Missing databases are idempotent.

## Filesystem isolation

All newly selected or generated upload files are staged into the active owner directory. This covers image/video picker results, both camera paths, voice recordings, post/review/Memory upload sources, ImageManipulator outputs, compressor outputs, first-frame probes, and Memory gallery thumbnails. Unowned files inside the app cache are deleted after a successful scoped copy. External photo-library/content-provider files are never deleted.

Staging captures the owner generation and rechecks it after asynchronous copy. If logout wins the race, the destination and app-cache source are discarded and the operation fails instead of attaching the file to a later account.

The app does not globally purge `expo-image`, operating-system HTTP, video, or external photo-library caches because those APIs provide no safe owner-scoped deletion contract. Framework bytes may survive temporarily, but Phase 1C removes all app references and signed URLs, unmounts viewers, and prevents Bob from obtaining Alice's cache key/URL. Authorization for fresh Phase 1A post URLs remains current-policy checked and five minutes. This limitation requires native staging verification.

## Legacy cache handling

Local schema version 2 runs an idempotent one-time migration:

1. Count whether the old Query namespace and old Memory database exist (0/1 only).
2. Delete the v1 global Query key.
3. Delete the unowned global Memory database.
4. Delete global and older `trending_loc_*` location keys.
5. Persist only sanitized removal counts and a completion marker.

No private legacy payload is inspected, printed, or attributed to the first post-upgrade user. The migration reruns safely if interrupted before its completion marker.

## Cleanup coordinator and journal

`mobile/src/services/localDataIsolation.ts` is the single account-sensitive lifecycle coordinator used by auth logout, auth loss, account switching, deletion acceptance, owner mismatch, token expiry, freeze detection, startup recovery, and development reset.

The minimal MMKV journal contains only:

```text
owner scope
reason code
status
attempt count
schema version
updated timestamp
```

State progression:

```text
cleanup_required
  -> stopping_activity
  -> clearing_query_cache
  -> clearing_local_database
  -> clearing_files
  -> clearing_account_storage
  -> journal removed (idle)
```

The current owner generation is revoked before the first asynchronous cleanup. Each step is idempotent and the most recently entered step remains in the journal on failure. Startup replays the entire safe sequence. Eight failed attempts fail closed. A corrupt journal with a known marker reconstructs an owner-mismatch cleanup; one without a provable owner clears local auth and requires a fresh sign-in.

Cleanup resets realtime, registered media/search buffers, capture sessions, comments, composer, user-location memory, Query state/persistence, SQLite, account files, account preferences, cached actor profile, occasion corrections, and—except during a legitimate account switch or developer reset—the local Supabase auth artifact.

## Explicit logout behavior

```text
capture active scope
-> write cleanup_required
-> neutralize UI / revoke generation
-> stop realtime and sensitive callbacks
-> clear memory, Query persistence, SQLite, files, preferences, local auth storage
-> bounded Supabase local signOut attempt (2 seconds maximum)
-> force-remove auth storage again
-> render signed-out navigation
```

Local cleanup does not depend on the network. `signOut({ scope: "local" })` does not claim global refresh-token revocation on other devices. If the server is unreachable, this device still loses its local session and private state.

## Account switching and navigation privacy

The account boundary renders a neutral dark view while transitioning. The prior navigation tree, viewers, sheets, screen state, hooks, subscriptions, and Query provider unmount first. Previous cleanup must reach a safe state before the new namespace restores. A detected owner change resets the Expo Router path to root/onboarding, so Bob does not reopen Alice's room/detail route.

## Token expiry, invalid session, and account freeze

- A local `expires_at` check prevents already-expired JWT restoration.
- A timer contains a session that expires while the app remains foregrounded.
- Supabase `SIGNED_OUT`/refresh rejection and unexpected null sessions enter cleanup.
- Online identity validation rejects invalid JWTs and any session/user UUID mismatch.
- Foreground resume calls the minimal account-status route. `deleting`, unexpected `missing`, or authoritative 401/403 neutralizes UI and cleans locally.
- Profile/account-status disagreement fails closed.
- Network/503 failure does not masquerade as authoritative invalidation; it enters only the explicit offline policy below.

### Explicit offline policy

Same-account offline Memory restoration is allowed only when all of the following hold:

1. Supabase local session parsing succeeds.
2. Its `user.id` is a valid UUID and selects the same owner namespace.
3. The JWT `expires_at` is still in the future.
4. A matching v2 actor-profile envelope exists.
5. Query/SQLite/file envelopes prove the same scope/schema.

The policy ends at local JWT expiry. Logout, deletion, owner change, corrupt auth, or cleanup journal state always removes/locks offline access. It is not an indefinite offline authentication mode.

## Phase 1B deletion integration

The server's durable deletion acceptance remains unchanged. After acceptance, the mobile hook calls the Phase 1C coordinator with `account_deletion`, then performs bounded local sign-out. Account data is unavailable locally while the Phase 1B worker continues Storage/database/Auth deletion. The new account-status route is a minimal read signal only; it does not modify the Phase 1B worker or migration architecture.

## Signed URL handling

Phase 1A post media remains five-minute and was not extended. Phase 1C continues persisting only the existing Memory offline surface. Private Memory rows now carry `signedUrlExpiresAt`; offline reads blank private URLs when expiry is absent, invalid, or past. Logout/switch deletes their Query and SQLite containers. A fresh URL still requires current room authorization.

The existing Memory-specific signed URL TTL remains separate from Phase 1A. Its effective offline use is additionally bounded by the authenticated local session policy above.

## Pending mutations and drafts

No persisted general offline mutation/replay queue exists. React Query mutations, optimistic snapshots, Memory delete batches, composer data, capture selections, failed message state, and upload state are in the owner QueryClient, screen tree, or registered module maps. They are canceled/cleared/unmounted and are never dehydrated. Phase 1C does not add a new offline queue.

## Realtime and background cancellation

All Supabase channels are removed before storage cleanup. Memory list/detail callbacks and their delayed invalidations capture the active generation and no-op after it changes. Old Query clients are abandoned, so even a late promise cannot modify Bob's client. Push listeners remount per session and verify recipient UUID/name before routing. Foreground freeze validation also rechecks that the response still belongs to the captured host before cleaning anything.

## Android backup handling

The application keeps `allowBackup=true` for harmless platform preferences, but adds and compiles both referenced resources:

- `secure_store_backup_rules.xml`
- `secure_store_data_extraction_rules.xml`

Cloud backup and device transfer exclude SecureStore, credential/device MMKV paths, and application databases. Account files and new MMKV/SQLite files live under the OS cache directory and are not backup inputs. Excluding the database domain is deliberate because every current app database is an offline derivative; other shared preferences remain eligible.

The release Gradle build compiled both XML resources. The merged release manifest retained `fullBackupContent` and `dataExtractionRules`, and `assembleRelease` produced the APK.

## iOS backup handling

There is no checked-in `ios/` project to carry a native backup-entitlement patch. Instead, account files, Memory SQLite, Query MMKV, and cleanup MMKV are placed under Expo's `cacheDirectory`, which iOS excludes from iCloud/device backup by platform contract. Supabase tokens remain in Expo SecureStore/Keychain and are explicitly deleted on account-ending cleanup; they were not moved to plaintext storage.

Production iOS export passes. Because the repository intentionally has no checked-in `ios/` directory, verification also used an isolated temporary `expo prebuild` outside the worktree. CocoaPods resolved 123 pods, including Expo FileSystem, SQLite, SecureStore, Nitro/MMKV, and Hermes. An unsigned arm64 device Release build completed all 137 native targets, generated the production Hermes bundle, linked, validated the app bundle, and ended with `BUILD SUCCEEDED`. This proves native integration and compilation without adding generated iOS files to source control. Authenticated runtime and restore testing remain staging/release gates.

## Diagnostics

`localDataDiagnostics()` reports only:

- active owner present/missing;
- owner marker present/missing;
- Query namespace count/presence;
- Memory database namespace count;
- account-scoped file count;
- signed-URL record count;
- journal status/attempts;
- legacy cache presence, migration completion, and sanitized removal counts;
- local schema version.

It never returns owner UUID/scope, message text, room title, file path, URL, token, or media. `developmentResetAccountSensitiveData()` is code-only tooling and is not exposed in production UI.

## Cache versions and migrations

- Local data schema: 2.
- Query buster: `memory-cache-v2`.
- Query key: `circlebites:query-cache:v2`.
- Memory DB: `circlebites-memory-offline-v2.db` with owner/schema meta.
- Filesystem root: `circlebites-private/v2/<scope>`.
- Account preferences/profile/occasion keys: v2.
- Legacy cleanup marker: v2.
- Database/Supabase migrations: none. PH-301 remains untouched.

## Tests added or strengthened

`tests/mobile-cache-isolation-phase1c.test.mjs` provides behavior coverage for:

- canonical UUID scopes and stale generation revocation;
- owner-envelope Query restore and mismatch rejection;
- crash interruption, journal replay, corrupt-journal recovery, and Bob hydration ordering;
- app-cache staging and Alice/Bob directory preservation;
- separate Memory SQLite owner directories and row visibility;
- expired private signed URL rejection;
- iOS MMKV cache placement and Android backup rules;
- active session/deletion/realtime/notification/navigation wiring.

Phase 1B's mobile deletion assertion was updated to require the stronger coordinator-before-local-logout ordering. Existing location, compression, notification, Memory signed-URL, and Query persistence assertions were updated for the new active contracts rather than weakened.

## Validation results

| Gate | Result |
|---|---|
| Phase 1C focused behavior | 8/8 pass |
| Phase 1A focused security | 6/6 pass |
| Phase 1B focused | 6/6 pass |
| Changed Memory security/operations group | 25/25 pass |
| Root TypeScript | pass |
| Mobile TypeScript | pass |
| Root lint | pass with existing warnings, zero errors |
| Mobile lint | pass with existing warnings, zero errors |
| Next production build | pass; account-status route compiled |
| Android production Expo export | pass; forbidden-name scan clean |
| iOS production Expo export | pass; forbidden-name scan clean |
| Android Gradle release APK | pass; backup resources and merged manifest compiled |
| Isolated iOS arm64 device Release build | pass; 123 pods, 137 targets, Hermes bundle, link and bundle validation |
| Full root suite before Phase 1C | 1042/1062; 20 PH-002 failures |
| Full root suite after Phase 1C | 1050/1070; same 20 PH-002 failures |
| Memory hardening before/after | 71/72; same one PH-002 failure |
| `git diff --check` | pass |

The eight-test full-suite increase is exactly the new Phase 1C focused suite. No changed-path or new regression is hidden in the baseline.

## Runtime validation and unverified items

Repository runtime/build validation completed:

- real Android release resource merge and APK build;
- Android and iOS production Metro/Hermes exports;
- isolated generated iOS arm64 device Release compile and bundle validation;
- Next server route compilation;
- executable owner-switch/SQLite/file/MMKV/crash simulations.

Not claimed as completed:

- native Alice/Bob authenticated walkthrough on the connected Android phone (no disposable two-account staging backend was configured, and hosted production was not mutated);
- Android Auto Backup/device-transfer restore attempt;
- iOS simulator/device launch, reinstall/restore, or authenticated Alice/Bob walkthrough;
- real process kill at every journal state;
- framework image/video cache byte inspection;
- hosted account-freeze/deletion status validation.

These are release-verification blockers, not evidence of an incomplete local implementation.

## Rollout and roll-forward plan

1. Deploy to a disposable/staging mobile backend with Alice and Bob seed accounts.
2. Upgrade an install containing the old v1 Query key and global Memory DB; verify sanitized legacy counts and no hydration.
3. Run the manual matrix below on Android release and iOS release builds.
4. Exercise backup/restore and account-deletion worker delay/failure.
5. Monitor only sanitized cleanup status/attempt metrics; never upload journal scopes or content.
6. Roll forward by increasing the local schema version and deleting/rebuilding incompatible owner caches.

A binary rollback to the old global-cache architecture is security-unsafe. If emergency rollback is unavoidable, require app-data wipe/local logout before installing the old binary. Prefer a forward fix that keeps schema v2 isolation.

## Manual staging and release checklist

For each scenario verify no old content flash, stale signed URL, pending mutation replay, realtime delivery, or navigation reuse:

- same-account online restart and permitted offline restart;
- Alice private Memory cache -> online logout -> Bob immediate login;
- Alice private Memory cache -> offline logout -> process death -> offline restart -> Bob login later;
- token refresh rejection and local expiry while foregrounded/backgrounded;
- account freeze from another session followed by foreground resume;
- Phase 1B deletion acceptance while worker remains pending;
- kill after journal creation and after every cleanup status;
- corrupt and retry-exhausted journal;
- upgrade with v1 Query/global SQLite/global location data;
- Android cloud backup and device transfer;
- iOS backup/reinstall/restore;
- late Alice realtime and notification callbacks after Bob becomes active;
- Alice file cleanup while Bob directory and global theme remain intact.

## Remaining risks

- Framework/OS image, HTTP, and video caches have no safe owner-scoped purge API; bytes can outlive app references until eviction or URL expiry.
- The cleanup journal is intentionally in the OS cache to avoid iOS backup. It survives normal crash/restart but the OS may evict cache under storage pressure; per-owner namespaces still prevent cross-account hydration and local auth is cleared during account-ending cleanup.
- Online freeze detection occurs at initial validation and foreground resume, not by continuous polling. Supabase auth loss and local token expiry are independently handled.
- Local sign-out does not revoke sessions on other devices.
- Native two-account and backup/restore evidence remains outstanding.
- PH-001 credential assessment, PH-002 baseline adjudication, PH-301 migration-root reconciliation, and earlier hosted gates remain open.

## Phase gate

```text
PASS locally
```
