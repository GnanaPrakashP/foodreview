# FoodReview database migrations

## Authority

`supabase/migrations` is the only executable migration history. `supabase/config.toml` is the only Supabase CLI configuration, and every database command runs from the repository root. `supabase/schema.sql` is a reference snapshot, not an apply mechanism.

The root was selected because it owns the backend/API, has the repository-level Supabase configuration, already reset successfully, contains dependencies absent from the former mobile chain (including `post_views`), and owns the Phase 1A–2 production-hardening migrations.

Never edit a committed/applied migration. Add a new, uniquely versioned, forward-only corrective migration. Never copy a new migration into `mobile/supabase`.

## Canonical commands

The compatible CLI is pinned/documented as Supabase CLI `2.109.1` with PostgreSQL 17.

```sh
npm run db:start
npm run db:reset
npm run db:lint
npm run db:test
npm run db:test:upgrades
npm run db:drift-report
npm run db:stop
```

Create a migration only from the repository root:

```sh
npx supabase@2.109.1 migration new descriptive_name
```

Then run `npm run db:verify`. That command validates the locked history, performs two consecutive clean resets, lints SQL, runs pgTAP plus real Auth/RLS/Storage checks, exercises supported upgrade fixtures, and finishes with the read-only local drift audit.

Phase 3 verified 64 canonical migrations and 82 tracked historical entries. Subsequent forward-only hardening migrations bring the current manifest to 85 canonical migrations and 103 tracked entries, with two preserved historical conflicts. The database contract now runs 186 pgTAP assertions plus the real Phase 3 and Phase 4 Auth/RLS/Storage/security behavior matrices and the Phase 5 deterministic plan/API harnesses. See `docs/production-hardening/PHASE_3_CANONICAL_MIGRATIONS.md`, `docs/production-hardening/PHASE_4_API_SECURITY.md`, and `docs/production-hardening/PHASE_5_BACKEND_PERFORMANCE.md`.

## Historical inventory

Before reconciliation there were 29 root files and 49 mobile files spanning 60 unique versions:

| Classification | Versions | Disposition |
| --- | ---: | --- |
| Identical in both roots | 16 | Root copy retained; mobile copy retired and hash preserved |
| Root-only | 11 | Retained as canonical |
| Mobile-only | 31 | Mechanically promoted at the same unique version |
| Same version, different bytes | 2 | Root selected; mobile variant archived; both hashes locked |

The full per-file object categories, dependency hints, sizes, SHA-256 hashes, duplicate status, and canonical disposition are in `docs/database/migration-history-manifest.json`. Validation fails on a changed historical hash, duplicate/malformed canonical version, executable mobile SQL, a mobile Supabase config, a missing promoted version, or lost conflict evidence.

### Mobile-only versions promoted unchanged

```text
202606060001_shared_memory_rooms.sql
202606060002_create_shared_memory_room_rpc.sql
202606060003_shared_memory_media_type.sql
202606070001_shared_memory_photo_message_groups.sql
202606080001_shared_memory_message_edit_delete.sql
202606080002_shared_memory_realtime.sql
202606090001_shared_memory_media_dimensions.sql
202606090002_shared_memory_reads.sql
202606090003_push_tokens.sql
202606090004_shared_memory_message_replies.sql
202606120001_profile_search.sql
202606120002_shared_memory_invites.sql
202606140001_shared_memory_privacy_hardening.sql
202606140002_settings_account_management.sql
202606140003_block_visibility.sql
202606160001_shared_memory_dish_ratings.sql
202606180001_shared_memory_phase1_security.sql
202606180002_shared_memory_phase1_1_cleanup.sql
202606180003_shared_memory_phase2_media_upload_hardening.sql
202606180004_shared_memory_phase2_1_trust_boundary.sql
202606180005_shared_memory_phase2_2_cleanup_verification.sql
202606180006_shared_memory_phase3_scalability.sql
202606180007_shared_memory_final_audit_hardening.sql
202606210001_shared_memory_room_occasion_title.sql
202606210002_shared_memory_room_occasion_classification.sql
202606220001_shared_memory_stops.sql
202606250001_profile_media_username_hardening.sql
202607030001_shared_memory_audio_messages.sql
202607050001_shared_memory_chat_page_rpc.sql
202607060001_circle_feed_seen_ranking.sql
202607060002_circle_feed_page_rpc.sql
```

### Retired identical mobile copies

The retired copies were `202606300001` through `202607130003` where listed by the locked manifest: content reports, Explore, Circle production hardening, feedback collapse, dish-identity migrations, user-location/search indexes, canonical dish images, and Phase 1A–2. Each maps to the byte-identical file at `supabase/migrations/<filename>`.

### Conflicting historical versions

| Version | Canonical SHA-256 | Archived mobile SHA-256 | Resolution |
| --- | --- | --- | --- |
| `202505010001` | `cec7bb5ab31a33be30e9ab366f60ceb29c8fef2bcad52d0f937e98d86afa1f3a` | `05d5fb01544622fff97c0522d9df3f44b5f4b058047a68fe570aeaa7e6c4655d` | Root baseline selected; executable SQL is equivalent; comment-only mobile variant archived |
| `202607100001` | `f17722fa92e3b973fdede58581cbc419c0b0ff8419665e57adff8a14b5ff22ed` | `7f57c83e00b89f593728c6a4a5d4278a92f83191986b0301630e01226fac0aee` | Root media pipeline selected; executable SQL is equivalent; comment-only mobile variant archived |

The archived variants live under `docs/database/legacy-mobile-migrations`, outside Supabase CLI discovery. They are evidence only and must never be applied.

## Corrective convergence

The mechanically merged chain reset successfully without changing old SQL. Runtime policy testing then found three final-state defects and corrected them additively:

- `202607130004_canonical_schema_contract.sql` adds the service-only read-only schema/RLS/Storage/grant contract.
- `202607130005_canonical_policy_reconciliation.sql` restores anonymous reads of eligible public reviews without allowing anonymous profile-table discovery, while preserving deleting-account suppression.
- `202607130006_canonical_role_grants.sql` supplies least-privilege API grants for promoted RLS tables while keeping Memory photo/upload-intent finalization and all worker/deletion authority server-only.
- `202607130007_canonical_review_media_path_reconciliation.sql` teaches the older Profile ownership guard the server-derived Phase 1A `private-posts/<owner>/...` shape, allowing existing-data backfill and deletion inventory while still rejecting cross-owner paths.
- `202607130008_mobile_api_security.sql` adds durable HMAC-keyed API rate buckets, idempotency state, install/Auth-bound push tokens, active generic-media moderation quarantine/audit, audited report decisions, service-only grants, and the additive Phase 4 schema-contract extension.
- `202607130009_backend_feed_performance.sql` adds stable cursor indexes, bounded feed/engagement/Explore/Memory RPCs, Memory activity maintenance, and dry-run-first projection reconciliation. Memory read payloads omit private Storage paths; the authenticated API signs authorized photo IDs in one batch.
- `202607210001_notification_inbox_seen_state.sql` adds owner-derived, server-persisted notification inbox seen state without changing per-row read state.
- `202607210002_review_visible_content_revision.sql` adds the server-owned review revision consumed by explicit Home refresh comparison.
- `202607210003_review_media_refresh_revision.sql` advances that revision when ordered review media membership changes.
- `202607210004_notification_unseen_indexes.sql` keeps both canonical UUID and legacy-name unseen badge lookups on bounded partial indexes.
- `202607210005_home_location_ranked_feed.sql` gives Home stable unseen-first, nearest-first keyset pagination using the account-scoped app location and an immutable first-seen cutoff.
- `202607210006_retire_thread_reply_notifications.sql` retires discussion-thread inbox and push events, removes historical rows from unread state, and keeps the unread existence function owner-scoped and index-bounded.
- `202607210007_profile_memory_timeline_pagination.sql` adds a member-scoped 12-room Profile Memory timeline contract with stable `(visit date, room id)` pagination and a matching cursor index.
- `202607220001_table_memory_invitation_lifecycle.sql` directly adds only users in the inviter's Circle, persists pending invitations for everyone else, and provides a receiver-scoped atomic Join/Decline RPC while revoking direct authenticated invite writes.

## Upgrade support

`npm run db:test:upgrades` proves upgrades from legacy root-only (`202606020001`), pre-Phase 1A, post-Phase 1A, post-Phase 1B, and post-Phase 2 checkpoints. Each fixture seeds a real Auth user/profile/review and phase-relevant records, migrates forward, verifies preservation, runs the critical contract, and executes the real policy/Storage harness.

The former independently executable mobile-only history is unsupported because it is missing the root `post_views` dependency required by `202607080001_circle_production_hardening.sql`. The manifest detects that state. Do not fabricate the missing object or renumber history in production; export the hosted history/schema and follow a reviewed, project-specific additive remediation plan.

## Read-only hosted drift audit

Local:

```sh
npm run db:drift-report
```

Explicit staging/production configuration:

```sh
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run db:drift-report -- --hosted
```

The hosted mode is read-only and opt-in. It never prints credentials or mutates the project. It reports sanitized missing, extra, or name-divergent migration versions and critical table/RLS/bucket/function/grant/index/constraint drift. A missing Phase 3 contract is itself a failure. Never claim a hosted project is clean without running this exact audit against it.

## Deployment rules

Before staging or production: confirm backup/PITR, export hosted migration history, run the drift report, inspect estimated migration locks/runtime, and validate Storage inventory. Apply only pending canonical migrations to staging, run the committed database and Phase 1A–2 suites, verify at production-like scale, then repeat the evidence review for production.

Rollback is roll-forward by default. Do not delete a recorded migration, restore the mobile history, weaken RLS, or make a private bucket public. For an unsafe partial deployment, stop writes/workers, retain privacy controls, restore only into an isolated project if required, and ship a new corrective migration after review.

## Memory migration verification retained from the legacy guide

### Manual Phase 2.2 staging verification

After canonical migration `202606180005_shared_memory_phase2_2_cleanup_verification.sql` is approved against the hosted drift report, apply it through the reviewed linked-project command (`npx supabase@2.109.1 db push --linked`) in disposable staging only. Verify with real authenticated actors:

- Direct authenticated client insert must still fail with RLS.
- Duplicate upload_intent_id and duplicate storage_path must fail.
- Pending media visibility must be checked with real authenticated users.
- Storage object read/write must be checked with real authenticated users.
- Cleanup safety must prove `shared_memory_room_media_paths` and `shared_memory_account_media_paths` return only authorized DB-backed paths.

Rollback for `202606180005_shared_memory_phase2_2_cleanup_verification.sql` is roll-forward: preserve the one-use constraints and service-only cleanup functions, stop cleanup writes, and add a corrective migration. Do not restore direct client photo inserts.

### Phase 3 scalability verification

Canonical migration `202606180006_shared_memory_phase3_scalability.sql` introduces `shared_memory_room_summaries` and indexes for bounded room summaries. In staging, verify membership-scoped results, pagination bounds, stable ordering, large-room and many-room query plans, and the mobile legacy fallback before production rollout.

### Phase 5 monitoring and operations

Monitor the Upload intent create rate and error rate, Finalize success/error rate and latency, pending/expired intent counts, cleanup throughput, cleanup storage deletion failures, notification outcomes, and blocked membership attempts. Alert on sustained error rates, growing pending/expired queues, repeated cleanup failures, and unexpected authorization denials.

Memory telemetry is metadata-only. Never add room IDs, user IDs, usernames, message text, captions, signed URLs, Storage paths, tokens, or credentials to logs, metrics, alerts, or traces.
