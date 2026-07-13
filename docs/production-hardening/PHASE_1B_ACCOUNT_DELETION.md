# FoodReview Production Hardening — Phase 1B Account Deletion

Date: 2026-07-13

Branch: `hardening/02-account-deletion`

Implementation status: PASS locally

Release verification status: BLOCKED pending disposable hosted-staging execution, worker scheduling/alerting verification, and the pre-existing production-readiness blockers recorded below. PH-301 was resolved locally in Phase 3; hosted history still requires explicit audit.

## Executive result

FoodReview no longer treats account deletion as a synchronous client request that removes the Auth user before all Storage and application records are proven clean. The active mobile flow now creates an owner-only durable deletion job and freezes the account atomically. A protected, bounded, lease-based worker inventories and verifies Storage deletion, cleans application data, reconciles shared data, deletes the Supabase Auth user last, and retains only sanitized operational metadata for a bounded 30-day window.

The local implementation passes behavior-level unit tests, a clean root migration reset, Supabase SQL lint, Next production build, Android/iOS Expo exports, Phase 1A security tests, and a real local Auth/RLS/Storage/HTTP lifecycle with another user's data present. The hosted matrix was not run and production has not been mutated.

Phase 3 supersession note (2026-07-13): the temporary mirrored migration arrangement is retired. `supabase/migrations/202607130002_complete_account_deletion.sql` is the sole executable copy, its former mobile hash is preserved in the locked manifest, and current database commands run from the repository root.

## Why the previous flow was unsafe

The previous `/api/delete-account` path synchronously attempted selected Storage deletion and then called `delete_current_account()`. That database function removed application rows and `auth.users` inside the request. The design had four material failure modes:

- Its Storage inventory predated the Phase 1A generic media source/private/public variants.
- A timeout or Storage partial failure could leave objects without a recoverable authoritative job.
- Auth deletion could remove the identity needed to resume or attribute cleanup.
- Shared Memory rooms created by the user could be deleted even when they contained another member's data.

The legacy `delete_current_account()` function is now fail-closed with `use_durable_account_deletion`. It cannot silently restore the retired Auth-first order.

## Architecture selected

The selected architecture is an asynchronous, service-only deletion state machine:

```text
mobile settings
  -> POST /api/delete-account with owner bearer token
  -> request_account_deletion()
       - create/reuse durable job
       - profiles.account_status = deleting
       - set deletion_started_at once
       - suppress the owner's reviews
  -> HTTP 202 Accepted
  -> mobile signs out and clears active query/session state

scheduled worker
  -> protected POST /api/internal/account-deletion
  -> claim with lease + FOR UPDATE SKIP LOCKED
  -> bounded inventory
  -> bounded Storage deletion + missing-object verification
  -> database cleanup + shared-data policy
  -> Supabase Auth admin deletion last
  -> completed reconciliation window
  -> bounded purge after retain_until
```

This is intentionally not a client-driven list of paths. Paths come from service-side database relationships and server-side owner-prefix enumeration only.

## Active deletion runtime path

The active path is:

1. `mobile/app/profile/settings.tsx` requires the explicit confirmation text and invokes the existing deletion mutation.
2. `mobile/src/services/settings.ts` calls `POST /api/delete-account` with the current bearer token.
3. `app/api/delete-account/route.ts` authenticates the user and calls only `request_account_deletion()`.
4. The route returns `202` with `accepted`, `jobId`, and the durable status; it does not perform Storage, database, or Auth deletion inline.
5. Mobile signs out immediately after acceptance and navigates to login. The UI states that deletion has started in the background.
6. The dedicated account-deletion worker calls the protected internal route until the job completes or becomes an operator-visible permanent failure.

The active mobile app does not call a deletion RPC directly. There is no new standalone web account-management UX in this phase.

## Account freeze behavior

The freeze occurs in the same transaction that creates or reuses the durable job:

- `profiles.account_status` changes from `active` to `deleting`.
- `profiles.deletion_started_at` is set once and remains stable across repeated requests.
- Owned reviews immediately receive `deleted_at` and `status = deleted`.
- Restrictive profile and review read policies suppress the deleting account from normal anonymous/authenticated discovery.
- `current_profile_name()` returns no actor name for a deleting account, so existing username-scoped RLS write policies fail closed.
- UUID-keyed direct-write tables have a frozen-account trigger guard.
- Generic media-source and legacy quarantine Storage insert policies require an active account.
- Server routes using `getAuthenticatedCircleActor()` reject a deleting or RLS-suppressed profile and never reconstruct it from Auth metadata/email.
- Phase 1A media access checks the owner's active profile before issuing a fresh signed URL, including anonymous access to formerly public content.

Already-issued Phase 1A signed URLs retain their intentional maximum five-minute validity. FoodReview cannot truthfully revoke bytes already downloaded to a device or prove immediate third-party CDN cache erasure.

## Job state machine

| State | Work | Exit condition |
| --- | --- | --- |
| `inventory_pending` | Load database-backed paths and paginate owner-prefix Storage enumeration | Queue exhausted and no ambiguous ownership |
| `storage_cleanup_pending` | Process at most 50 persisted objects per run | Every item is `deleted` or `already_missing` |
| `database_cleanup_pending` | Recheck Storage/ambiguity gate and clean application data | Database cleanup transaction commits |
| `auth_deletion_pending` | Delete Supabase Auth user | Auth deletion succeeds or user is already missing |
| `completed` | No further deletion work is claimable | Retained for bounded reconciliation |
| `failed` | Permanent/operator-visible state after ambiguity or attempt exhaustion | Operator resolves cause before controlled recovery |

Claims use `FOR UPDATE SKIP LOCKED`, a bounded job limit, worker identity, `locked_at`, and `lease_expires_at`. Expired leases can be reclaimed. The route caps claims at 50 jobs; the normal default is 10.

Job attempts are capped at 50. Transient failures use sanitized error codes/text and bounded retry delay. Object attempts are separately durable. Raw provider errors, object paths, content, tokens, or credentials are not logged.

## Data ownership inventory

| Category | Ownership key/source | Deletion or retention decision | Verification |
| --- | --- | --- | --- |
| Profile and identity | `profiles.id`, username, Auth user ID | Freeze first; profile hard-deleted; Auth last | Profile absent; Auth user absent |
| Reviews/posts | `reviews.reviewer_name` | Suppressed at request; hard-deleted after Storage | Review rows absent; dependent cascades reconciled |
| Generic media | `media_assets.owner_id`, derivatives and privacy jobs | Source, canonical, thumbnail, poster, old/new migration objects deleted before DB metadata | Per-object verified missing; media rows absent |
| Review/avatar media | Review ownership, upload-intent `user_id`, profile URL, legacy cleanup job | Final and quarantine objects deleted | Per-object verified missing |
| Memory media | `uploader_id`, legacy `uploader_name`, upload intents | Deleted only for deleting member; another member's objects preserved | Owner objects absent; other owner objects present |
| Social engagement | Username/user UUID in comments, likes, wishlist, Circle requests/memberships, blocks, notifications | Hard-deleted | Reconciliation counts |
| Taste/trust and activity | Recommendation feedback, tried items, reputation, badges, visit attribution, post views/impressions | Removed by review/profile/Auth FK cascade; direct frozen writes denied | Reconciliation counts after completion |
| Settings/device data | Notification settings, push tokens, user location | Hard-deleted/cascaded | Reconciliation counts |
| Dish identity | Review mentions deleted by review/Auth cascade; candidate attribution becomes null on Auth deletion | Shared canonical dishes/families/aliases/images are retained | No deleted-user mention or candidate attribution remains |
| Moderation reports | Reporter/moderator identity and free-text details | Report retained for abuse/security; identity/details anonymized | Reporter/moderator fields null or sentinel |
| Shared Memory rooms | Creator/member/content attribution | Policy described below | Shared and sole-room assertions |
| Legacy stories | Author username and stored path | Object and row deleted when table exists | Storage and row reconciliation |
| Operational deletion metadata | Service-only job/items | Sanitized record retained 30 days after creation/completion window | Bounded worker purge after `retain_until` |

The inventory is deliberately fail-closed. An invalid bucket/path, owner mismatch, or ownership ambiguity creates only a SHA-256 reference in `account_deletion_ambiguous_items`; it does not delete the object. Unresolved ambiguity prevents database and Auth deletion.

## Storage buckets covered

The durable inventory allowlist covers:

- `media-sources`
- `media-private`
- `media-public`
- `review-photos`
- `review-media-quarantine`
- `memory-media`

Server-side prefix enumeration covers Phase 1A and legacy conventions including:

- `sources/post/<user-id>/...`
- `sources/avatar/<user-id>/...`
- `sources/memory/<user-id>/...`
- `private-posts/<user-id>/...`
- `posts/<user-id>/...`
- `avatars/<user-id>/...`
- `memories/<user-id>/...`
- `public/avatars/<user-id>/...`
- `public/mobile/<user-id>/...`
- `pending/<user-id>/...`

Database inventory additionally covers paths that are not discoverable by these prefixes: generic derivatives, Phase 1A old/new privacy migration objects, review-photo rows, final/quarantine upload intents, Memory rows/intents, legacy account-media cleanup arrays, and legacy stories.

Storage enumeration is bounded to 100 entries per page and five pages per worker invocation. Storage removal is bounded to 50 persisted items per invocation. Each object is checked before deletion and checked again afterward. A missing object is an idempotent success, not a fatal error.

The worker never accepts a client-supplied bucket or path. Another user's seeded private post and Memory objects remained present in the real local lifecycle.

## Database tables covered

Direct cleanup and FK cascades cover all active categories found in the root/mobile code and migration inventory:

- Core identity/content: `profiles`, `reviews`, `review_photos`.
- Social: `comments`, `likes`, `wishlist`, `circle_requests`, `circle_memberships`, `blocked_users`, `notifications`.
- Taste/activity: `recommendation_feedback`, `user_tried_items`, `user_reputation`, `user_badges`, `post_visit_attributions`, `post_views`, legacy `post_impressions`, `hungry_picks`.
- Media: `media_assets`, `media_derivatives`, `media_processing_jobs`, `media_privacy_migration_jobs`, `review_media_upload_intents`, `shared_memory_upload_intents`, legacy `account_media_cleanup_jobs`.
- Memory: `shared_memory_rooms`, `shared_memory_members`, `shared_memory_messages`, `shared_memory_photos`, `shared_memory_dishes`, `shared_memory_dish_ratings`, `shared_memory_stops`, `shared_memory_reads`, `shared_memory_invites`.
- Device/settings: `notification_settings`, `push_tokens`, `user_location_preferences`.
- Dish identity: `review_dish_mentions`, user attribution in `dish_candidates`; shared canonical catalog tables are retained.
- Moderation/legacy: `content_reports`, `stories`.

`account_deletion_remaining_counts()` is service-only and reports remaining direct user references by table without returning row contents.

## Shared Memory policy

Shared Memory uses explicit shared-ownership behavior:

- A room created by the deleting user is deleted only when it has no other member and no message, photo, or dish attributed to another user.
- A room containing another user's membership or content is retained.
- A retained room's `created_by` becomes the non-identifying sentinel `deleted-account`.
- The deleting member's photos, upload intents, messages, dishes, dish ratings, stops, read state, invites, and membership are removed.
- Another member's room membership, messages, dishes, and Storage objects remain.

The real runtime test covers both a shared room and a sole-owner room and verifies the other member's `memory-media` object remains.

## Retention and anonymization decisions

- User-authored profile, review, social, private settings, device tokens, and owned media are hard-deleted.
- Canonical dish, dish-family, alias, image, and restaurant entities are shared system data and are not deleted.
- Moderation reports are retained for abuse/security integrity, but reporter and deleted moderator identity are cleared, identifying free-text details are removed, and deleted targets are replaced by `deleted-account` where required.
- Shared-room attribution uses `deleted-account`; deleted-member content is removed.
- Deletion error text is allowlisted and generic. Ambiguous object references are hashed.
- Completed job, item, and hashed ambiguity metadata has `retain_until` defaulting to 30 days from the request. Each worker call first purges up to 100 expired completed jobs; item/ambiguity rows cascade with the job. Permanent failed jobs remain for operator resolution and must not be silently purged while deletion is incomplete.

## Deletion ordering and invariants

The irreversible order is:

1. Authenticate the owner.
2. Create/reuse the job and freeze/suppress the account atomically.
3. Persist the complete database-backed and prefix-discovered Storage inventory.
4. Delete and verify every Storage object.
5. Refuse database cleanup if any Storage item is unfinished or any ambiguity is unresolved.
6. Apply database hard-deletion, cascade, anonymization, and shared-room policy.
7. Delete the Auth user last. A missing Auth user is accepted as idempotent completion.
8. Reconcile and retain sanitized operational state for the bounded window.
9. Purge expired completed metadata in bounded service-only batches.

No rollback should ever reintroduce Auth-first deletion.

## RLS and authorization model

- The deletion job, Storage item, and ambiguity tables are RLS-enabled, revoked from public/anon/authenticated, and granted only to `service_role`.
- Request creation is the sole authenticated RPC and derives ownership from `auth.uid()`; it accepts no user ID or Storage path.
- Claim, inventory, database cleanup, remaining-count, and retention-purge functions explicitly require `auth.role() = service_role`.
- Security-definer functions use an empty `search_path` and fully qualified relations.
- The internal HTTP worker requires a dedicated `ACCOUNT_DELETION_WORKER_SECRET`, compares it in constant time, returns 404 on failed authentication, and exposes only aggregate states/counts.
- The service role and worker secret must remain server/scheduler-only. Neither appears in Android/iOS production exports.

## Mobile behavior

The confirmation UI remains intentionally small and familiar. Its semantics changed:

- Confirmation explains that permanent deletion finishes securely in the background.
- Shared rooms may remain for other participants while the deleting user's content is removed.
- Pending copy is `Starting...`, not an inaccurate synchronous-deletion claim.
- On `202 Accepted`, mobile signs out, the existing logout/session flow clears active query state, displays `Deletion started`, and returns to login.
- A network/server error before acceptance leaves the user signed in and permits a safe retry.
- A repeated accepted request reuses the same active durable job.

Complete cross-account persisted/offline cache isolation is Phase 1C and was not started here.

## Worker and reconciliation tooling

Worker command:

```bash
ACCOUNT_DELETION_WORKER_BASE_URL=https://app.example.com \
ACCOUNT_DELETION_WORKER_SECRET='<scheduler-secret>' \
npm run account:deletion-worker -- --once
```

The continuous script defaults to a 30-second interval; production should normally invoke `--once` from an external scheduler so platform retries/alerts are visible.

Default dry-run reconciliation:

```bash
SUPABASE_URL='https://project.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='<server-only-key>' \
npm run account:deletion-report -- --limit=25
```

Filter without mutation:

```bash
npm run account:deletion-report -- --job='<job-uuid>'
npm run account:deletion-report -- --user='<user-uuid>'
npm run account:deletion-report -- --after='<last-job-uuid>' --limit=25
```

Apply exactly one bounded worker step for an inspected job:

```bash
SUPABASE_URL='https://project.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='<server-only-key>' \
ACCOUNT_DELETION_WORKER_URL='https://app.example.com/api/internal/account-deletion' \
ACCOUNT_DELETION_WORKER_SECRET='<scheduler-secret>' \
npm run account:deletion-report -- --job='<job-uuid>' --apply
```

Reports include job state, sanitized error code, remaining/failed/ambiguous object counts, database counts by table, Auth presence, and retention deadline. They do not print object paths, usernames, email addresses, content, tokens, or credentials.

## Tests added or updated

- `tests/account-deletion-phase1b.test.mjs`: canonical migration, state machine, freeze/order, shared Memory, Auth-missing idempotency, partial Storage retry, and mobile acceptance behavior.
- `tests/delete-account-route.test.mjs`: unauthenticated rejection, atomic durable request, retired RPC exclusion, and generic error response.
- `tests/supabase-account-deletion-phase1b-runtime-validation.mjs`: real local Auth actors, Storage variants, cross-user isolation, freeze, protected bounded worker, Auth-last order, shared/sole rooms, moderation anonymization, idempotency/reconciliation, and bounded retention purge.
- `tests/fixtures/phase1b-root-runtime-compat.sql`: obsolete historical test-only evidence from the former PH-301 split; current gates do not apply it.
- Updated actor/media mocks and the pre-existing account-media cleanup worker test so active dependencies are represented without weakening security assertions.

## Local validation results

Passed:

- Clean root `npx supabase db reset` through `202607130002_complete_account_deletion.sql`.
- Root `npx supabase db lint`: no schema errors.
- Real local Phase 1B lifecycle: 9/9.
- Focused Phase 1B, account-media, actor-freeze, Phase 1A, and operations tests: 35/35.
- Phase 1A security regression: 6/6.
- Root TypeScript: passed.
- Mobile TypeScript: passed.
- Scoped changed-file lint: zero errors.
- Full root lint has zero changed-path errors and 94 existing warnings; root lint exits successfully after the changed-path error was removed.
- Next production build: passed.
- Android Expo production export: passed.
- iOS Expo production export: passed.
- Export scan for public service-role names, service-role name, development auto-login names, and the deletion worker secret: no matches.
- Canonical migration manifest/hash validation: passed under Phase 3.
- Production-hardening issue register validation: passed.

Known repository baselines, honestly retained:

- Before Phase 1B (`hardening/01-private-media`): full root tests 1030/1051, 21 failures; Memory hardening 71/72, one failure.
- After Phase 1B: full root tests 1042/1062, 20 failures; the additional Phase 1B tests pass and one stale account-deletion operations assertion was corrected. The remaining failures are the pre-existing UI/architecture static baselines recorded under PH-002.
- After Phase 1B Memory hardening remains 71/72. The one failure is the pre-existing chat preload/timestamp static assertion, unrelated to account deletion.

No new validation regression was introduced.

## Migration details and PH-301

Phase 1B originally added byte-identical migrations to two temporary roots. Phase 3 retains only `supabase/migrations/202607130002_complete_account_deletion.sql` as executable and preserves the retired hash in `docs/database/migration-history-manifest.json`.

The migration uses guarded runtime relation discovery for mobile-only optional tables so the root migration can reset and lint cleanly without fabricating missing product tables.

The canonical migration history resets cleanly. The retired mobile history's earlier missing-`post_views` failure remains documented in Phase 3 as an unsupported ambiguous hosted state requiring explicit operator reconciliation; no applied history was rewritten.

## Disposable staging execution matrix

Do not use production accounts for the first hosted run.

### Dry run

1. Create a disposable Supabase staging branch/project and snapshot it.
2. Confirm Phase 1A is deployed and run the explicit Phase 3 hosted drift/history audit for this environment.
3. Apply the Phase 1B migration only through the normal migration pipeline.
4. Deploy the app server with `ACCOUNT_DELETION_WORKER_SECRET`; do not schedule the worker yet.
5. Create an owner and another user. Seed public/circle/private posts, generic source/canonical/thumbnail/poster variants, review/avatar final and quarantine objects, shared/sole Memory rooms, moderation report, push token, likes/comments/wishlist/Circle/block rows.
6. Run `npm run account:deletion-report -- --limit=25` and confirm it is read-only.
7. Request deletion from the owner mobile flow and confirm immediate sign-out, discovery suppression, write denial, upload denial, and fresh signed-URL denial.
8. Inspect the new job in dry-run mode. Confirm no object path/content is printed.

### Apply and completion

1. Execute one bounded step with `--job=<id> --apply`.
2. Repeat dry-run reconciliation after each step and confirm the expected state progression.
3. Enable the scheduled `--once` worker at the selected cadence.
4. Wait for `completed`; verify zero remaining Storage/database references and no Auth user.
5. Confirm another user's database rows and objects are unchanged.
6. Force a completed test job's retention deadline in staging and confirm the next worker run purges the job and child metadata.

### Interruption and retry

1. Stop the worker during inventory; wait beyond lease expiry; restart and confirm cursor resume without duplicate unsafe deletion.
2. Inject a Storage deletion failure for one owned object; confirm the account remains frozen, database/Auth cleanup does not run, the object is marked failed with a generic code, and later retry completes.
3. Interrupt immediately after Storage verification and before database cleanup; restart and confirm idempotent continuation.
4. Simulate an already-missing Auth user at `auth_deletion_pending`; confirm completion succeeds.
5. Create an invalid or mismatched candidate in staging; confirm hashed ambiguity causes operator-visible `failed` and prevents database/Auth deletion.

### Operator failure handling

1. Alert on growing oldest non-completed age, `failed` jobs, repeated temporary error codes, unresolved ambiguity, and nonzero remaining objects after expected completion time.
2. Inspect only sanitized reconciliation output. Use direct privileged Storage/database inspection only under the incident process.
3. Correct configuration/ownership data; never edit paths from client input or mark objects deleted without verifying Storage.
4. Requeue a permanently failed job only through an reviewed operator procedure that resets attempts/status after the cause is resolved.
5. Do not delete Auth manually to make a dashboard green.

## Production rollout and roll-forward strategy

1. Resolve/approve the production migration root and take a database backup.
2. Deploy the migration first.
3. Deploy the app/API containing the durable request route and freeze-aware reads/writes.
4. Store a new high-entropy worker secret in server and scheduler secret stores only.
5. Deploy the bounded worker and dry-run reconciliation tooling.
6. Run the complete disposable-staging matrix and record evidence.
7. Enable production account-deletion requests, then the scheduler, at low concurrency.
8. Monitor queue age, attempts, failed/ambiguous counts, Storage error rate, Auth deletion error rate, and reconciliation totals.
9. Increase scheduler frequency only after observed bounded execution is healthy.

Rollback is roll-forward only for in-flight deletion jobs:

- Do not restore `delete_current_account()` or an Auth-first client flow.
- If the new application release must be rolled back, keep the Phase 1B migration and worker available until every accepted job is completed or deliberately held frozen for incident response.
- It is safe to temporarily disable new deletion requests while continuing existing jobs.
- Schema removal is not an emergency rollback because it would destroy recovery evidence.

## Unverified items and remaining risks

- No hosted Supabase project, production database, production Storage, or production Auth tenant was changed.
- Real hosted Storage/CDN timing, provider throttling, and scheduler behavior remain unverified.
- Deletion under production-like object counts and concurrent requests has not been load-tested.
- A hosted project based on the retired mobile-only history requires the explicit Phase 3 operator reconciliation before Phase 1B deployment.
- PH-302 transactional database/RLS/Storage CI coverage is still open; the real validator is strong local evidence but not a replacement for deployed pgTAP/hosted gates.
- Phase 1A hosted migration/backfill, credential-owner rotation assessment, and native authenticated iOS validation remain blocked exactly as previously recorded.
- Already-downloaded media and already-issued signed URLs cannot be erased immediately; Phase 1A bounds fresh URL validity to five minutes.
- Globally unreferenced objects that contain no trustworthy owner relationship and do not match an owner prefix cannot be safely attributed. They must be reported/handled through operator inventory, never guessed and deleted.
- Permanently failed jobs intentionally retain the frozen account and sanitized recovery metadata until an operator resolves them.
- Phase 1C account-scoped persisted/offline cache isolation is not implemented here.

## Phase gate

```text
PASS locally
```
