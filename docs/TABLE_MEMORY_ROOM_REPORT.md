# Table Memory Durable-Replica Implementation Report

**Implementation date:** 2026-07-26
**Workspace:** `foodreview`
**Target:** Discord-style server authority with a durable, local-first mobile replica
**Scope:** Architecture, persistence, synchronization, recovery, media metadata, and privacy

## 1. Final classification

> Server-authoritative permanent history, durable owner-scoped SQLite replica, guaranteed cursor convergence, complete joined-room discovery, renewable private media delivery, and disposable media binaries only.

The implementation in this workspace now follows that model:

| Layer | Responsibility |
| --- | --- |
| PostgreSQL/Supabase | Permanent authoritative rooms, membership, messages, replies, stops, dishes, ratings, media metadata, read positions, invitations, and sync/change state |
| Owner-scoped SQLite | Durable downloaded replica: summaries, room snapshots, messages, media metadata, sync cursors, read state, and text outbox |
| Realtime | Low-latency acceleration; never the sole correctness mechanism |
| Incremental sync | Repairs missed realtime events and converges SQLite to server state |
| React Query | Current in-memory UI projection |
| Device media cache | Disposable downloaded image/video/audio binaries and thumbnails |

Older messages and media metadata remain paginated. A login restores every joined-room summary in the background but warms full details for only a bounded recent set. It does not download all historical messages or media binaries.

## 2. Root causes confirmed

The implementation had ten persistence and convergence gaps:

1. The Table Memory database was opened under Expo `cacheDirectory`, so OS cache cleanup could remove structured room state.
2. A seven-day pruning policy deleted summaries, snapshots, messages, media metadata, sync cursors, and outbox rows by age.
3. Incremental sync stopped after four 200-change pages. A later head bootstrap could advance local state past changes and tombstones that were never applied.
4. Offline-first reads returned cached private rooms for broad server failures, including learned 403/404 access loss.
5. Realtime subscriptions patched live events but did not guarantee a cursor reconciliation after every successful resubscription.
6. Only the first summary page was durably restored, so older joined rooms could become undiscoverable on a reconstructed device.
7. Media hydration assumed a private `storagePath` even though the API security boundary strips it. Expired URLs for unchanged rows also lacked stable-ID renewal across all surfaces.
8. Mark-read optimistic state updated React Query but did not update SQLite.
9. Critical SQLite failures were often swallowed or treated like a network fallback, allowing synchronization to appear successful without durable persistence.
10. Transient auth refresh failures could enter destructive signed-out cleanup, and reactions appeared shared while existing only in component state.

## 3. Files changed

### Server/API

- `app/api/mobile/memories/read/route.ts`
  - Added authenticated, RLS-scoped signed-URL renewal by opaque media ID.
  - Kept raw private storage paths out of returned photo payloads.
- `app/api/mobile/memories/finalize-upload/route.ts`
  - Removed `storage_path` and stored `public_url` from the mobile response.
  - Added `signed_url_expires_at` to finalized media.

No PostgreSQL schema migration was added by this architecture fix. The existing server-authoritative tables and local-first sync migration remain the server contract.

### Mobile storage and synchronization

- `mobile/src/services/accountFileStore.ts`
  - Split disposable cache storage from persistent owner data storage.
  - Added the owner-scoped Table Memory database directory under `documentDirectory`.
- `mobile/src/services/memoryOfflineStore.ts`
  - Added safe cache-to-durable database migration and integrity verification.
  - Removed age pruning.
  - Made critical writes observable and failure-propagating.
  - Made sync row/tombstone application and cursor advancement one transaction.
  - Added transactional authoritative room deletion.
  - Added durable read-state updates.
  - Hydrated all downloaded room media metadata, including standalone, stop/gallery, and chat media.
- `mobile/src/services/memorySyncRunner.ts`
  - Added the reusable cursor paging engine with cancellation, repeated-cursor protection, transactional progress, yielding, and chunked resume.
- `mobile/src/services/memories.ts`
  - Added single-flight full backlog convergence.
  - Classified authoritative access loss separately from transient failures.
  - Restored all summary pages.
  - Added stable-ID media renewal for room, chat, and gallery data.
  - Prevented local persistence failures from being hidden by cache fallback.
- `mobile/src/hooks/useMemories.ts`
  - Added deduplicated reconciliation on global and open-room `SUBSCRIBED`.
  - Added full summary restoration with bounded room warming.
  - Purged local/query projections after authoritative access loss.
  - Persisted confirmed read state and scheduled reconciliation on persistence failure.
- `mobile/src/providers/MemoryRoomSyncBootstrap.tsx`
  - Restores every joined-room summary in the background.
  - Retains foreground and network reconnect recovery.
- `mobile/src/providers/AccountSessionBoundary.tsx`
  - Preserves the active owner replica through transient refresh/network/server failures.
  - Retains destructive cleanup for confirmed invalid sessions and explicit security transitions.

### Mobile media/types/UI

- `mobile/src/services/memoryMapper.ts`
- `mobile/src/services/memoryShared.ts`
- `mobile/src/types/models.ts`
- `mobile/src/security/offlineMemorySecurity.ts`
- `mobile/src/constants/memoryMediaPolicy.ts`
  - Made storage paths optional, media sanitation null-safe, and signed expiry the renewal contract.
- `mobile/app/memories/[id].tsx`
  - Disabled local-only reactions until they have a real server/realtime/sync/SQLite model.

### Tests and documentation

- `tests/table-memory-durable-replica.test.mjs`
- `tests/mobile-cache-isolation-phase1c.test.mjs`
- `tests/mobile-auth-lifecycle-hardening.test.mjs`
- `tests/shared-memory-phase4-mobile-performance.test.mjs`
- `docs/TABLE_MEMORY_ROOM_REPORT.md`

## 4. Database and storage migration behavior

The local database path is now:

```text
documentDirectory/circlebites-private/v2/<owner-scope>/table-memory/
  circlebites-memory-offline-v<schema>.db
```

Temporary uploads, picker/camera intermediates, thumbnails, and downloaded media binaries remain below `cacheDirectory`.

On the first open for an owner:

1. Check whether the durable database already exists.
2. Check the legacy owner cache directory for the old database.
3. If only the old database exists, checkpoint its WAL.
4. Copy the database to a `.migrating` file in durable storage.
5. Run SQLite `quick_check` and verify any existing owner marker.
6. Promote the verified copy to the durable filename.
7. Open and verify the promoted database again.
8. Remove the old database, WAL, and SHM only after successful verification.

The process is idempotent. If validation fails before promotion, the old source remains. If a process stops after promotion but before final validation, the next run may discard the candidate only when the old source still exists. An invalid sole durable database fails closed rather than being deleted.

There is no age-based structured-data deletion. Room data remains until an explicit security lifecycle event, clear app data, or uninstall. No size-based structured-data eviction was introduced in this task.

## 5. Sync convergence design

Each incremental page is handled as:

```text
fetch page(cursor)
  → validate numeric next cursor
  → reject repeated cursor while hasMore=true
  → merge messages, updates, and tombstones
  → transactionally persist row changes/deletes + next cursor
  → advance in-memory cursor only after commit
```

The room sync is single-flight per owner generation and room. Page size remains bounded at 200. Work yields periodically. A 500-page execution chunk returns the last committed state and immediately resumes the next chunk; it does not skip or bootstrap over the remaining backlog.

Cancellation occurs when the active owner generation changes. If a fetch, merge, or SQLite transaction fails, the stored cursor remains at the last successfully applied page. The next reconciliation resumes there.

The final room snapshot is written after convergence. If the process stops after a page transaction but before that final snapshot write, the next sync still returns the authoritative room/stops/dishes/members/read projection and repairs the snapshot from the committed cursor.

## 6. Realtime reconnect behavior

Both the global Table Memory channel and the open-room channel now treat every successful `SUBSCRIBED` callback as a reconciliation signal.

Signals are:

- debounced;
- deduplicated per QueryClient;
- coalesced across global and room subscriptions;
- protected against a late signal arriving while the previous reconciliation promise settles.

Reconciliation invalidates the joined-room list, forces cursor sync for the bounded recent loaded rooms, and explicitly syncs the open room. Foreground and online-reconnect reconciliation remain additional paths.

Realtime still provides immediate UI updates, but the change cursor is the correctness boundary.

## 7. Joined-room recovery

After login:

1. The first summary page renders normally.
2. `MemoryRoomSyncBootstrap` follows every `nextCursor` in the background.
3. Every page is persisted to SQLite and appended to the infinite query without duplicates.
4. Only the 12 most recent summaries are candidates for full room warming.
5. Detailed snapshots, older messages, and media remain lazy.

When offline after summaries were previously restored, the fallback exposes the complete durable local summary set instead of slicing it back to the first 12 rooms.

After clear app data, uninstall, or a new-device login, local state is rebuilt from server summaries and then from per-room bootstrap/sync as rooms are warmed or opened. Server-acknowledged history is not dependent on a phone backup.

## 8. Media renewal and hydration

The durable media row contains stable metadata:

- opaque media ID;
- room/message/stop association;
- uploader metadata safe for display;
- media kind, dimensions, duration, position, moderation state, and timestamps;
- a short-lived signed delivery URL and its expiry when available.

Raw private storage paths are not required for read hydration and are stripped from read/finalize responses. Upload intents still provide the temporary upload destination required to upload the object.

When a visible URL is missing or close to expiry:

1. The client requests `renewMedia` with room ID and media ID.
2. The actor-scoped Supabase client proves row visibility through RLS.
3. Only after that read succeeds does the server use the admin storage client to sign the internal object path.
4. The API returns safe metadata, signed URL, and expiry—never the raw path.
5. The renewed metadata is written to SQLite.

Renewal runs for room media, chat attachments (including cached older pages), and Media-tab pages. It does not require a server media-row update or realtime event.

Actual binaries remain managed by the normal evictable image/video/audio caches. An offline device can show a binary only if that binary is already cached locally.

## 9. Read state, writes, and access loss

After a mark-read server acknowledgement:

- React Query keeps the optimistic `lastReadAt` and zero unread count.
- SQLite transactionally updates the detailed snapshot and summary.
- A persistence failure emits privacy-safe telemetry and invalidates detail/list queries so server reconciliation retries the durable write.
- A server failure rolls React Query back to the previous detail and list state.

Critical SQLite operations now throw `MemoryOfflinePersistenceError` after emitting sanitized telemetry. The error contains only the operation category, not room names, usernames, content, URLs, or storage paths.

Authoritative room deletion/access loss transactionally removes:

- photos;
- messages;
- outbox entries;
- sync cursor;
- detailed snapshot;
- summary.

This operation is used for learned 403/404 responses, room deletion, membership removal, and confirmed leave. Transient network/server errors may still use the durable offline room.

## 10. Account and session cleanup

The owner namespace and generation checks remain unchanged. Explicit logout, account switch, account deletion/freeze, confirmed invalid or revoked session, owner mismatch, and manual security reset retain the journaled local-data cleanup path.

A timeout, offline device, temporary auth outage, or temporary lifecycle API failure no longer authorizes deletion. The active owner host/replica is retained and refresh is retried. On a cold expired-session start where authority cannot be checked, protected authenticated UI is not mounted, but owner files are preserved for a later verified login.

The cleanup journal still revokes the owner generation before stopping async work and deleting the owner’s Query cache, SQLite database, cached files, and account-scoped storage. That prevents work from account A from writing into account B.

## 11. Automated verification

Latest local results:

| Check | Result |
| --- | --- |
| Focused durable-replica tests | 11 passed, 0 failed |
| Table Memory hardening suite | 96 passed, 0 failed |
| Auth lifecycle + cache isolation | 18 passed, 0 failed |
| Invitation/join/leave lifecycle | 6 passed, 0 failed |
| Full repository test suite | 1,712 passed, 0 failed |
| Root TypeScript | Passed |
| Mobile TypeScript | Passed |
| Next.js production build | Passed |
| Relevant ESLint | 0 errors; existing warnings remain in the large room UI/service files |

Focused coverage includes:

- page-five message update, message deletion, and photo deletion after more than 800 changes;
- interrupted persistence and retry from the last committed cursor;
- execution-chunk pause/resume;
- cancellation, missing cursor, and repeated cursor;
- interrupted cache-to-durable migration and lossless retry;
- no age pruning;
- transactional cursor/entity persistence;
- authoritative room purge;
- realtime resubscription hooks and deduplication;
- complete summary-page persistence;
- stable-ID media renewal and path stripping;
- standalone/chat/gallery metadata hydration;
- read-state persistence;
- transient-auth replica retention;
- reaction UI disablement.

No hosted Supabase runtime or physical-device test was performed as part of this local implementation run.

## 12. Remaining limitations

1. Physical Android/iOS lifecycle behavior—process kill, reboot, OS cache cleanup, low storage, and upgrade from a released legacy build—still requires release-build device testing.
2. This repository has no checked-in native iOS project. Expo `documentDirectory` is persistent, but the generated iOS container/backup and file-protection behavior must be verified before release. Android declares `allowBackup=false`.
3. The hosted environment’s existing local-first sync migration and RLS policies were not queried or changed in this task. Deployment state must be verified separately.
4. Structured SQLite data has no size-based eviction policy. That is deliberate for this task; monitor database growth before choosing an explicit, user-safe policy.
5. History that has never been downloaded still requires the server. Older messages and metadata remain lazy by design.
6. Media binaries can be evicted and must be downloaded again. Metadata remains durable.
7. Reactions are unavailable until a complete shared server/realtime/sync/SQLite implementation is approved.

## 13. Manual Android/iOS release checklist

Run on both platforms unless noted:

1. Install the previous release, populate summaries, messages, media metadata, read state, and a pending outbox row; upgrade in place and confirm migration retains all rows.
2. Verify the old cache database is removed only after the durable database opens.
3. Open a warmed room offline after backgrounding, swiping away, app restart, and phone restart.
4. Use Android “Clear cache” without “Clear storage”; confirm room structure/history remains and only media binaries reload.
5. Clear app data/uninstall, reinstall, sign in, and confirm every joined summary returns while room details/history hydrate lazily.
6. Create and accept an invitation, kill the app immediately, relaunch, and confirm the room is discoverable.
7. Disconnect realtime without changing the OS online state, make remote insert/update/delete changes, allow resubscription, and confirm cursor convergence.
8. Stage more than 800 message/photo changes with tombstones and verify the final device state and cursor.
9. Revoke membership/delete a room remotely and confirm summary, snapshot, messages, photos, cursor, and outbox disappear after the learned 403/404 or realtime event.
10. Expire a signed URL and open both a chat attachment and Media-tab item; confirm renewal by media ID and no raw path in network payloads/logs.
11. Mark a room read, kill/restart offline, and confirm detail/read summary consistency.
12. Simulate full disk/SQLite write failure; confirm sanitized telemetry, no cursor advancement, and a visible pending/retry state where applicable.
13. Test temporary auth/network failure with an expired token; confirm the replica remains isolated and is reused after recovery.
14. Test explicit logout and A→B account switch; confirm account A data never appears for B and the cleanup journal resumes after interruption.
15. Confirm reaction controls are absent.
16. On iOS, inspect generated backup/file-protection behavior for the durable directory and confirm uninstall removes the container.
