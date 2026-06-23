# Chat Production Status

Current phase: Final production-readiness audit

Next required phase: Authenticated staging smoke verification

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
| Phase 4: Mobile Performance Fixes | Partial | Virtualized chat/media surfaces, disk cache hints, sequential media upload/finalize, compression/size guards. | Static tests, mobile typecheck, public E2E smoke pass. | Needs real-device large-media memory test, interrupted/background upload test, offline retry validation, and signed-URL expiry smoke. |
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
