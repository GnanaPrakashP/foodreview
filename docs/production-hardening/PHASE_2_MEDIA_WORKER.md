# FoodReview Production Hardening — Phase 2 Production-Reliable Media Processing

Date: 2026-07-13

Branch: `hardening/04-media-worker`

Parent commit: `1a07f9fe8c8495e31080a6ec4c8b49e9e46248cd`

Implementation status: PASS locally

Release verification status: BLOCKED pending hosted worker deployment, scheduler/process supervision, hosted Storage and database interruption testing, two-instance staging termination tests, alert/dashboard wiring, production-like throughput validation, and the earlier production-hardening blockers.

Phase 3 supersession note (2026-07-13): the temporary mirrored migration roots are reconciled. `supabase/migrations/202607130003_media_worker_reliability.sql` is the sole executable copy; the former identical mobile hash remains locked in the migration manifest. Current database gates run through `npm run db:*` from the repository root.

## Executive result

FoodReview's generic post-media path is now a durable at-least-once processing system with an exactly-once authoritative result. Upload finalisation and job creation are atomic. Workers claim jobs through a service-only PostgreSQL RPC using `FOR UPDATE SKIP LOCKED`, an expiring lease, a generation, and a random claim token. A crashed worker can be replaced; an old worker cannot complete after its lease is reclaimed. Image and video derivative paths are deterministic and safe to overwrite, while the database completion RPC verifies the current lease, active account, authoritative asset contract, and complete derivative set before publishing `ready` metadata.

Retryable failures use bounded exponential backoff with deterministic jitter. Permanent media failures become `rejected`; exhausted transient failures become operator-visible `dead_letter`; account freeze becomes `cancelled`. A separately leased cleanup state machine removes consumed sources after retention, removes terminal assets, and sweeps unattached ready media. Mobile persists only owner-scoped recovery metadata and staged-file references, resumes upload/finalisation/status reconciliation on same-account startup or foreground, and cannot resume another account's upload.

The selected worker is a repository-owned, non-root Docker image pinned to Node 20.19.4 on Debian Bookworm, with `ffmpeg`/`ffprobe`, a localhost-only Next production server, the continuous claim loop, startup validation, readiness, health checking, bounded concurrency, and graceful `SIGTERM`. It was built and inspected locally. It has not been deployed to a hosted environment and no production project was mutated.

This is sufficient for a local Phase 2 pass. It is not evidence that 1,000 users have been load-tested. Registered users are not the sizing variable; simultaneous media jobs, source mix, media duration, CPU, disk, network, and database capacity are. Start staging with two replicas at concurrency two, measure the documented signals, and perform Phase 9 load testing before making a capacity claim.

## Scope and initial state

The branch was created from the clean Phase 1C handoff. Its history contains:

```text
1a07f9f hardening: isolate mobile caches by account
8e1728d feat: harden account deletion workflow
4c96490 test(hardening): validate phase 1a runtime gates
5eac799 feat(hardening): make post media visibility-aware
54ac94e chore(hardening): establish phase 0 baseline
```

Only the active generic post upload/processing path and the supporting mobile, API, database, Storage, worker, cleanup, and operator paths were changed. Phase 3 migration-root reconciliation, Phase 4 general abuse/rate limiting, unrelated query/rendering optimization, broad observability, store submission, and load testing were not started.

## Architecture selected

```text
owner-scoped mobile file
  -> owner-bound upload intent (10-minute expiry)
  -> private media-sources object
  -> idempotent upload confirmation
  -> media_assets.status = uploaded
       -> database trigger inserts one queued processing job atomically
  -> dedicated Docker worker calls protected localhost process route
  -> service-only atomic leased claim
  -> signature/size/dimension/duration validation
  -> Sharp image pipeline or ffprobe + ffmpeg video pipeline
  -> deterministic private derivatives with upsert
  -> derivative metadata upsert (asset_id, kind unique)
  -> lease-fenced database completion
  -> ready
  -> review attachment consumes the asset once
  -> leased retention cleanup deletes the source after 24 hours
```

The delivery path remains Phase 1A: post derivatives are private and are delivered only through current-access authorization and five-minute signed URLs. The media worker does not issue delivery URLs.

## Active processing path

1. The Create flow obtains media through the existing picker/camera flow and stages it under the current Phase 1C account directory.
2. `mobile/src/services/posts.ts` calls `uploadPostMediaAsset()` sequentially for each post item.
3. `mobile/src/services/mediaPipeline.ts` stores an owner-scoped durable `prepared` record before server work.
4. `POST /api/media/upload-intent` authenticates the actor, verifies the account is active, normalizes media metadata, derives access class, assigns an asset UUID, derives the source path, and inserts `media_assets.status = created`.
5. Mobile uploads only to the returned `media-sources` path. Storage RLS also binds that path to the active owner's unexpired asset.
6. `POST /api/media/finalize-upload` verifies actor/owner/path/account/expiry and Storage existence/metadata. It changes the asset to `uploaded`; the Phase 2 database trigger creates the processing job in the same transaction. The API's compatibility insert is idempotent on `(asset_id, job_type)`.
7. `scripts/media-worker-entrypoint.mjs` starts the production Next server on `127.0.0.1`, waits for protected readiness, then starts `scripts/media-worker.mjs`.
8. The loop calls `POST /api/internal/media/process`; the route creates a service client and runs a bounded batch.
9. `claim_media_processing_jobs()` atomically leases eligible work. Processing downloads the authoritative source, validates bytes, creates and uploads derivatives, upserts derivative metadata, and calls the fenced completion RPC.
10. Mobile polls with bounded backoff or reconciles later after restart/foreground. A UI timeout keeps the durable record and reports that processing is still underway.
11. `POST /api/reviews` validates the ready asset, owner, access class, derivative set, and one-use attachment contract. Recovery metadata/files are removed only after the review API succeeds.
12. The worker periodically calls `POST /api/internal/media/cleanup`; cleanup claims are also leased and fenced.

No second generic media processor was found. The process API is the server-side implementation invoked by the dedicated worker, not an independent scheduler. The existing review/avatar quarantine image service and the separate shared-Memory upload/finalisation service remain active for their established surfaces; they are not alternate consumers of generic `media_processing_jobs`. Account-deletion workers remain separate and retain override authority over all related paths.

## Canonical job state machine

| State | Meaning | Permitted owner/transition |
| --- | --- | --- |
| `queued` | Durable job is immediately eligible | upload trigger or explicit eligible operator requeue -> worker claim |
| `running` | One current lease owns processing | claim/reclaim RPC -> success, retry, rejection, dead letter, cancellation |
| `retry_wait` | Retryable failure is waiting for `next_attempt_at` | claim RPC after database time reaches the deadline |
| `succeeded` | Complete derivative set is authoritative and asset is `ready` | terminal; repeated completion returns false/no mutation |
| `rejected` | Permanent media/input/ownership failure | terminal; a new upload is required |
| `dead_letter` | Retryable work exhausted `max_attempts` | terminal until explicit audited eligible requeue or cancel |
| `cancelled` | Account freeze, shutdown cancellation, or operator cancellation | terminal; cannot be claimed or completed |

Asset states remain server-owned: `created`, `uploaded`, `processing`, `ready`, `failed`, `rejected`, `expired`, `abandoned`, and `cancelled`. Mobile can request intent/finalisation and read sanitized status, but it cannot claim, complete, mark `ready`, requeue, or mutate worker metadata.

Every active/terminal transition stores appropriate timestamps and sanitized codes. Public clients have no execute privilege on worker RPCs or access to the service-only event table. Permanent rejection cannot be requeued blindly; it requires a new validated source.

## Claim, lease, and fencing design

`claim_media_processing_jobs(worker, limit, lease_seconds, max_attempts)`:

- requires `auth.role() = service_role`;
- validates worker ID, claim limit (1–25), lease (15–900 seconds), and max attempts (1–20);
- orders deterministically by `next_attempt_at`, creation time, and job ID;
- selects with `FOR UPDATE OF job SKIP LOCKED`;
- excludes frozen/deleting accounts and non-active asset states;
- claims `queued`/due `retry_wait` work and reclaims expired `running` work;
- increments attempts and lease generation;
- assigns `locked_by`, database `locked_at`, database `lock_expires_at`, `heartbeat_at`, and a random `claim_token`;
- reports whether a stale lease was reclaimed and audits the event.

Heartbeat, lease-current, completion, and failure RPCs match job ID, worker ID, lease generation, and claim token. Heartbeat and completion also require an unexpired lease. A reclaimed or cancelled job therefore fences the old process even if that process later resumes after a network partition.

The default lease is 180 seconds. The default heartbeat is the smaller of 30 seconds or one-third of the lease; configuration requires at least five seconds and no more than half the lease. Every processing checkpoint also verifies the lease. Database time controls eligibility and expiry.

## Job creation and authoritative finalisation

The Phase 2 trigger runs after an asset is inserted/changed to `uploaded` and inserts exactly one job under the existing `(asset_id, job_type)` uniqueness contract. This closes the previous failure window where the API could commit the uploaded state and crash before creating a job.

Completion is a single service-only transaction. It locks the current job and asset, verifies:

- exact current lease identity and expiry;
- asset state is still `uploaded`/`processing` and unconsumed;
- owner profile remains active and not deleting;
- expected derivative kinds exist exactly for the media type;
- derivative bucket/path prefix matches the authoritative asset surface/owner/asset;
- non-avatar derivatives have no permanent public URL.

Only then does it mark the asset `ready`, record probed dimensions/duration, set source-retention time, mark the job `succeeded`, clear lease fields, and write a sanitized event. A crash after this commit is treated as success; a repeated or stale completion cannot change it.

## Retry classification and backoff

Retryable examples include:

```text
storage_temporarily_unavailable
source_download_timeout
database_temporarily_unavailable
derivative_upload_timeout
worker_shutdown
temporary_ffmpeg_resource_failure
temporary_disk_unavailable
```

Permanent examples include:

```text
invalid_file_signature
unsupported_media_type
duration_exceeded
dimensions_exceeded
file_too_large
corrupt_source
source_missing
source_owner_mismatch
visibility_contract_mismatch
account_deleting
intent_expired
```

Failures are normalized to lowercase allowlisted codes of at most 80 characters. Raw Storage/database/ffmpeg errors, object paths, URLs, tokens, or credentials are not stored or returned. Client status converts codes to safe product messages.

The retry delay is:

```text
min(retry_max, retry_base * 2^(attempt - 1) * deterministic_jitter)
jitter range: 0.75–1.25
default base: 30 seconds
default cap: 3,600 seconds
default max attempts: 5
```

The hash-based jitter is stable for a job/attempt and computed in PostgreSQL. Future `next_attempt_at` jobs are not claimable. Attempt five followed by another retryable failure becomes `dead_letter`; it is never left `running`.

## Idempotency and derivative design

Server-derived paths are:

```text
private post image:
  media-private/private-posts/<owner-uuid>/<asset-uuid>/canonical.jpg
  media-private/private-posts/<owner-uuid>/<asset-uuid>/thumbnail.jpg
  media-private/private-posts/<owner-uuid>/<asset-uuid>/feed.jpg

private post video:
  media-private/private-posts/<owner-uuid>/<asset-uuid>/canonical.mp4
  media-private/private-posts/<owner-uuid>/<asset-uuid>/poster.jpg

avatar:
  media-public/avatars/<owner-uuid>/<asset-uuid>/<kind>.<extension>

memory generic surface:
  media-private/memories/<owner-uuid>/<asset-uuid>/<kind>.<extension>
```

Client filenames never enter commands or derivative paths. Derivative uploads use `upsert: true`; metadata uses the unique `(asset_id, kind)` key. Re-execution repairs partial sets and converges on the same objects/rows. Cleanup verifies every derivative row equals its server-derived owner/asset path before removal. A mismatch fails closed.

Post assets cannot be consumed twice: review attachment validates owner/access/ready state and the database consumption contract. The review API was corrected to keep `media_asset_id` through the root-compatible `review_photos` insert, so Phase 1A authorization remains linked after clean-root deployment.

## Phase 1A visibility integration

- Access class is assigned from the authenticated intent and stored on the asset; the worker reads it from the database.
- All post derivatives, including public-feed posts, stay in `media-private` with `public_url = null`.
- The worker never generates signed URLs or changes post visibility.
- Phase 1A delivery continues to evaluate current public/circle/me, membership, block, suppression, deletion, and account state before issuing a five-minute URL.
- Visibility/bucket mismatch is a permanent fail-closed processing error.
- Review attachment preserves `media_asset_id`; subsequent visibility transition and deletion RPCs retain their original authority.

## Phase 1B account deletion integration

- Upload intent and upload finalisation call `account_is_active`; frozen accounts cannot create/finalize new assets.
- A profile transition to deleting cancels/fences queued, running, and retry-wait jobs and schedules source cleanup.
- Claim excludes frozen/deleting profiles.
- Completion rechecks active profile state under the database transaction. A running worker may have written deterministic partial derivatives before observing a concurrent freeze, but it cannot make them authoritative; the Phase 1B inventory and server-derived cleanup paths remove them.
- Phase 1B inventory already covers `media-sources`, `media-private`, `media-public`, asset derivative paths, partial migration paths, and prefix orphans.
- The media worker never deletes Auth users. Account deletion retains its Storage-first, database-next, Auth-last order and overrides normal retention.

## Phase 1C mobile recovery integration

`mediaUploadRecovery.ts` stores at most 20 v2 records per owner in an owner-specific MMKV namespace. Records contain only the local upload ID, owner scope, local owned file references, asset ID, server-derived bucket/path, media contract, state, timestamps, and ready metadata. They do not contain access/refresh tokens, service credentials, signed URLs, or raw provider errors.

Durable client states are:

```text
prepared -> intent_created -> source_uploaded -> processing -> ready
```

Foreground/startup reconciliation can recreate an intent for `prepared`, repeat an idempotent source upload for `intent_created`, repeat upload finalisation for `source_uploaded`, and query server state for processing/ready records. Polling is bounded to 16 attempts with delay increasing from 1.5 to 8 seconds. Roughly one minute of UI waiting does not mark the server job failed; the record remains `processing` and the user sees a recoverable message.

The active cache owner and generation are checked during reads, updates, polling, and reconciliation. Logout/switch/deletion aborts polls, clears the owner namespace, and deletes owned staged files. A different user sees a different store and cannot resume the old path. Expired records and terminal server failures remove staged/prepared files. A ready record persists until the review API succeeds, preventing loss between media completion and post creation.

This intentionally does not create a broad offline mutation framework or redesign the Create UI. A recovered ready record is reused when the user retries sharing the same owner-scoped draft media.

## Resource limits

| Limit | Default | Valid configuration/rule |
| --- | ---: | --- |
| Post/memory image source | 60 MiB | enforced before processing |
| Avatar image source | 5 MiB | video not permitted |
| Post/memory video source | 100 MiB | enforced before processing |
| Image decoded pixels | 80,000,000 | Sharp input cap and metadata check |
| Video pixels | 16,000,000 | probed width × height |
| Post video duration | 30 seconds | 1.5-second container-rounding tolerance |
| Memory video duration | 60 seconds | 1.5-second tolerance |
| ffprobe timeout | 30 seconds | configurable 5–120 seconds |
| ffmpeg timeout | 240 seconds | configurable 10–900 seconds |
| Source download timeout | 120 seconds | configurable 5–600 seconds |
| Derivative upload timeout | 120 seconds | configurable 5–600 seconds |
| Per-job temporary budget | 512 MiB | configurable 128 MiB–2 GB; disk availability checked |
| Processing concurrency | 2 | configurable 1–8 |
| Claim route limit | 25 | actual claim additionally capped to concurrency |
| Lease | 180 seconds | configurable 15–900 seconds |
| Attempts | 5 | configurable 1–20 |

Signatures are checked before image decode/ffmpeg. MIME declarations are not trusted. ffprobe must find a positive-duration video stream. Commands use `spawn(command, argumentArray)` without a shell, and user-controlled filenames do not enter arguments. Each video job uses a mode-0700 unique directory. The directory is recursively removed in `finally` after success, rejection, retry, lease loss, or cancellation.

The claim loop waits between bounded batches and stops claiming after `SIGTERM`. In-flight HTTP work is aborted on shutdown; its lease/failure state is recoverable. The worker image should receive a shutdown grace period longer than the configured request timeout when graceful completion is desired; safety does not depend on graceful completion.

## Source retention and abandoned cleanup

| Asset condition | Retention/action |
| --- | --- |
| `created`, no confirmed source | intent expires after 10 minutes; cleanup marks expired and removes any object |
| `ready` and consumed by a review | source becomes eligible 24 hours after successful processing; derivatives/metadata remain |
| `ready` but never consumed | after 7 days the source, derivatives, and asset metadata are removed as abandoned |
| permanent rejection/cancel/expiry/failure | source and partial derivatives become eligible after 24 hours (or explicit immediate account-deletion override) |
| account deleting | Phase 1B cleanup overrides retention immediately |

Cleanup claims up to 100 assets with a 15–900 second lease, token, worker identity, and `SKIP LOCKED`. Attempts are capped at ten. Failures release the lease and retry with capped exponential delay. Completion requires the current unexpired cleanup token. Source-only completion sets `source_deleted_at`; terminal/abandoned completion deletes the asset and cascades derivative/job metadata only after Storage removal. Missing-object removal is idempotent. Ownership/path mismatch is never deleted.

The worker runs cleanup every 12 processing-loop iterations by default (about once a minute at the default five-second interval) and claims at most five times the processing batch size. Production can tune the bounded values after measuring source growth.

## Internal-route security

- `/api/internal/media/process`, `/cleanup`, and `/health` require the dedicated `MEDIA_WORKER_SECRET` and return 404 for failed authentication.
- Secret comparison uses equal-length `timingSafeEqual`; production rejects missing, common default, or shorter-than-32-character secrets.
- No fallback to unrelated cleanup secrets exists.
- Process/cleanup JSON bodies are stream-bounded to 4,096 bytes even without `Content-Length`; limits and worker IDs are validated.
- Internal routes return aggregate counts and sanitized codes, not paths, provider errors, configuration, keys, or URLs.
- Worker RPCs require `service_role`; public/anonymous/authenticated roles cannot claim, heartbeat, complete, fail, requeue, cancel, or clean jobs.
- Requeue/cancel are available only through the service-key operator CLI/RPC, not a mobile endpoint.
- The Docker server listens only on container localhost and no port is declared. Do not publish it publicly.
- Expo configuration forbids privileged Supabase/public worker configuration. Android/iOS production exports are scanned for server-only names/values.

## Worker deployment model and artifacts

Artifacts:

- `Dockerfile.media-worker`
- `.dockerignore`
- `scripts/media-worker-entrypoint.mjs`
- `scripts/media-worker.mjs`
- `scripts/media-worker-healthcheck.mjs`

The multi-stage image builds the Next production app, prunes development dependencies, installs Debian `ffmpeg`/`ffprobe`, creates UID/GID 10001, owns only the required app/temp locations, runs as `mediaworker`, and uses the protected readiness route for Docker health. Required configuration is provided at runtime; no `.env` is copied.

Required server-only environment:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
MEDIA_WORKER_SECRET (minimum 32 characters in production)
```

Important bounded options:

```text
MEDIA_WORKER_ID
MEDIA_WORKER_CONCURRENCY
MEDIA_WORKER_LEASE_SECONDS
MEDIA_WORKER_HEARTBEAT_MS
MEDIA_WORKER_MAX_ATTEMPTS
MEDIA_WORKER_RETRY_BASE_SECONDS
MEDIA_WORKER_RETRY_MAX_SECONDS
MEDIA_WORKER_TEMP_DIR
MEDIA_WORKER_MAX_TEMP_BYTES
MEDIA_WORKER_DOWNLOAD_TIMEOUT_MS
MEDIA_WORKER_UPLOAD_TIMEOUT_MS
MEDIA_WORKER_FFPROBE_TIMEOUT_MS
MEDIA_WORKER_FFMPEG_TIMEOUT_MS
MEDIA_WORKER_BATCH_LIMIT
MEDIA_WORKER_INTERVAL_MS
MEDIA_WORKER_CLEANUP_EVERY
MEDIA_WORKER_REQUEST_TIMEOUT_MS
```

Build locally or in the deployment registry pipeline:

```bash
npm run media:worker:build
```

Staging example (inject secrets through the host secret manager, not shell history or an image layer):

```bash
docker run --rm --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=1g \
  --memory=2g --cpus=2 \
  --env-file /secure/runtime/media-worker.env \
  foodreview-media-worker:phase2
```

Use a managed container runtime that supports continuous processes, at least the configured temporary disk, `SIGTERM`, health checks, outbound HTTPS to Supabase, and the configured job timeouts. Run two staging replicas with unique stable `MEDIA_WORKER_ID` values. Do not use a short-lived serverless function for video processing.

## Health and observability

Protected readiness checks database queue access, validates all media configuration, and executes `ffmpeg -version` and `ffprobe -version`. If the loop child exits, the entrypoint terminates the local server, causing the container to exit instead of leaving a falsely healthy API process.

Structured signals include:

- queue depth, oldest queued age, running, retry-wait, and dead-letter counts;
- batch processed/succeeded/rejected/retried/dead-letter/lease-loss counts;
- image/video job duration;
- source-download and derivative-upload duration;
- claim, heartbeat, lease-reclaim, retry, success, rejection, dead-letter, cancel, and audited requeue events;
- stale-reclaim flag/generation and lease-loss events;
- cleanup claimed/succeeded/failed counts and cleanup kind.

Logs contain job/worker IDs and media type where useful. They omit user IDs unless unavoidable, and never include object paths, signed URLs, content, access tokens, service credentials, raw provider errors, or command stderr. Event details are sanitized JSON and the table is service-only.

Recommended initial staging alerts:

| Signal | Warning | Critical |
| --- | --- | --- |
| Oldest eligible queued age | >120 seconds for 5 minutes | >600 seconds for 5 minutes |
| Dead-letter count | any new job | increasing for 10 minutes or >5 |
| Retryable failure ratio | >10% over 10 minutes | >25% over 10 minutes |
| Lease losses/stale reclaims | any sustained occurrence | >5 in 10 minutes |
| Cleanup failures | any repeated asset | >5 total in 10 minutes |
| Worker readiness | 2 consecutive failures | all replicas unavailable |
| Source bucket bytes/object count | >10% daily growth beyond upload trend | unbounded growth for 2 days |
| Video p95 processing time | >70% of lease | >lease without successful heartbeat |

Dashboard and alert wiring are hosted deployment work and were not claimed locally.

## Dead letter and operator recovery

`scripts/media-reconcile.mjs` is read-only by default and requires the service key. It supports bounded pagination, job/asset/user filters, stale-running, missing-job, retry/dead-letter, partial derivative, ready-unattached, expired-intent, and cleanup-candidate reporting. `--scan-storage=true` adds a bounded recursive scan for missing sources, missing derivative objects, ready-metadata mismatch, orphaned source objects, and orphaned derivative objects. If a database or Storage scan hits its configured cap, `completeScan` is false and orphan counts are `null`, not misleading zeroes. User IDs, asset/job samples, and object paths are omitted or hashed.

Examples:

```bash
# Database-only global dry run (default)
npm run media:reconcile -- --page-size=100 --max-pages=20

# Bounded database + Storage consistency scan
npm run media:reconcile -- --scan-storage=true --max-storage-objects=5000

# Authorized filters
npm run media:reconcile -- --job='<job-uuid>'
npm run media:reconcile -- --asset='<asset-uuid>'
npm run media:reconcile -- --user='<user-uuid>' --scan-storage=true

# Explicit eligible dead-letter requeue
npm run media:reconcile -- \
  --requeue='<job-uuid>' --apply --confirm=MEDIA_PIPELINE_RECOVERY

# Explicit cancellation or one bounded cleanup call
npm run media:reconcile -- \
  --cancel='<job-uuid>' --apply --confirm=MEDIA_PIPELINE_RECOVERY
npm run media:reconcile -- \
  --cleanup=true --apply --confirm=MEDIA_PIPELINE_RECOVERY
```

Requeue is service-only, idempotent for already queued work, allowed only for dead-letter retryable jobs, resets attempts, advances fencing generation, and writes the operator/event. Permanent rejections return false. Cancel does not change owner/visibility and is idempotent. There is no automatic destructive production invocation.

## Database migration

One corrective migration was originally added byte-for-byte to both temporary roots. Phase 3 retains the following sole executable copy:

```text
supabase/migrations/202607130003_media_worker_reliability.sql
```

It adds lease/fencing/retry/failure/cleanup columns and indexes, the service-only events table, claim/heartbeat/current-lease/complete/fail/requeue/cancel RPCs, cleanup claim/complete/fail RPCs, the account-freeze cancellation trigger, and atomic uploaded-asset job creation.

Applied migration history was not edited. Legacy `failed` jobs are normalized to `retry_wait` or `dead_letter`. Legacy `running` rows had no fencing identity, so the migration explicitly clears their locks, advances generation, and moves them to due `retry_wait` with `legacy_worker_lease_recovered`. Other non-running rows are normalized to the new lease-shape constraint. The canonical clean reset and SQL lint pass. Phase 3 later retired the second executable copy and preserved its hash.

## Tests and local failure injection

Phase 2 focused behavior tests cover:

- canonical migration/state/RPC/security contracts;
- retryable/permanent classification and invalid configuration;
- two-worker claim race;
- stale completion fencing;
- partial derivative upload and repeat convergence;
- crashes after claim, validation, canonical, thumbnail/poster, each upload stage, metadata, and authoritative finalisation;
- actual ffmpeg video canonical/poster output and temp cleanup after a simulated crash;
- retry exhaustion/dead letter;
- same-owner mobile restart, different-owner isolation, prepared/uploaded resume, terminal cleanup;
- Docker/internal-route/operator bounds.

The real local database validator proves atomic job creation, competing claims, heartbeat, unexpired lease protection, expiry/reclaim, generation/token replacement, stale completion rejection, backoff, retry exhaustion, requeue, cancel, permanent rejection, public denial, cleanup lease crash/reclaim fencing, account freeze/no resurrection, and sanitized event telemetry.

The real processing validator uses local Supabase Auth/PostgreSQL/Storage, a protected local Next server, Sharp, ffprobe, and ffmpeg. It processes a real JPEG and short H.264 MP4, generates exact image thumbnail and video poster/canonical derivatives, persists probed duration, rejects invalid signature, verifies private deterministic objects/no public URL, verifies temp/log containment, runs user-scoped Storage reconciliation, deletes consumed sources while retaining derivatives, deletes terminal invalid assets, and later sweeps seven-day unattached ready assets plus all derivatives.

Unit failure injection covers infrastructure failures without requiring a real outage. Actual hosted database restart, Storage interruption, process `SIGKILL`, and network partition remain staging items.

## Validation result and baseline comparison

| Gate | Result |
| --- | --- |
| Phase 2 focused tests | pass: 11/11 |
| Real local Phase 2 database behaviors | pass: 14/14 |
| Real local image/video/cleanup behaviors | pass: 10/10 |
| Phase 1A focused security | pass: 6/6 |
| Phase 1B focused behavior | pass: 6/6 |
| Phase 1C owner isolation | pass: 8/8 |
| Changed Memory security suites | pass |
| Root/mobile typecheck | pass |
| Root/mobile lint | zero errors; existing warnings only |
| Next production build | pass |
| Android/iOS production Expo exports | pass; server-only name/value scans clean |
| Worker Docker build/runtime | pass locally; ffmpeg/ffprobe, UID 10001, health metadata, temp write, missing-config failure |
| Root clean Supabase reset / SQL lint | pass |
| Canonical manifest / syntax / contract checks | pass |
| Full root suite | 1,061/1,081; same 20 PH-002 failures |
| Memory hardening | 71/72; same one PH-002 failure |

The Phase 1C before-count was 1,050/1,070. Phase 2 adds eleven passing tests and no failures, producing 1,061/1,081 with the exact same 20 pre-existing PH-002 assertions. The combined focused run still shows the documented stale in-app-camera source-regex assertion; it is not a Phase 2 runtime regression. Memory remains unchanged at 71/72.

The production image's `npm ci` reported three dependency audit advisories (one moderate, two high). The environment did not authorize the external advisory metadata query needed to attribute/remediate them, so this is recorded as an unverified dependency risk rather than silently claimed clean. No dependency was changed opportunistically in Phase 2.

## Hosted staging gate

No hosted worker or production scheduler was deployed. Execute this matrix in a disposable linked staging project:

1. Run the hosted read-only drift audit and verify the canonical migration IDs/checksums match the deployment plan.
2. Deploy two worker replicas with different IDs, equal validated configuration, secret-manager injection, no public port, a persistent process supervisor, and at least 1 GiB temp disk/2 GiB memory initially.
3. Verify readiness, container restart policy, `SIGTERM` grace period, and alert ingestion.
4. Upload real supported image/video/invalid/over-duration/large-dimension fixtures from Android and iOS.
5. Kill one worker after claim, source download/probe, first derivative upload, all uploads, before completion, after completion, and before cleanup. Let the lease expire where required.
6. Race two workers and prove one authoritative derivative set and one successful completion.
7. Interrupt database connectivity, Storage download, Storage upload, and network egress. Verify sanitized retry/backoff/dead-letter behavior.
8. Requeue an eligible dead letter and refuse a permanent rejection. Cancel a queued/running job.
9. Exercise expired intent, ready unattached seven-day policy (with staging time control), consumed-source retention, missing-object idempotency, and orphan scan.
10. Freeze and delete an account during queued, running, retry-wait, dead-letter, ready-unattached, and cleanup states. Verify no resurrection and another user's objects remain.
11. Kill the mobile process during each durable client state; restart the same account and then a different account on both platforms.
12. Verify public/circle/me transitions, block/membership/suppression/deletion revocation, and five-minute URLs remain Phase 1A-correct.
13. Inspect temp disk after every terminal/restart case and reconcile database/Storage to zero unexplained objects.
14. Confirm queue-age, failure, dead-letter, lease, cleanup, health, and source-growth dashboards/alerts fire at the chosen thresholds.
15. Run production-like upload concurrency and source-mix tests before selecting replica/concurrency/autoscaling values.

For every scenario prove no permanent `running`, no duplicate authoritative asset, no permanent public post URL, no cross-account processing, no post-deletion resurrection, bounded temp/source growth, and operator-visible failure state.

## Production rollout

1. Complete the hosted staging gate and earlier Phase 1A/1B/1C release blockers.
2. Back up and inspect migration state; confirm PH-301's deployment plan without editing applied history.
3. Deploy the database migration first.
4. Deploy at least two healthy worker replicas before directing production mobile uploads to the path. Keep concurrency conservative.
5. Deploy API/mobile compatibility changes through the normal signed release process.
6. Watch queue age, retries, dead letters, cleanup, Storage growth, CPU, memory, disk, and video latency during a canary window.
7. Expand replica count only from observed capacity. Do not raise per-worker concurrency beyond eight or beyond host CPU/disk capacity.
8. Run reconciliation database-only daily and a bounded Storage scan on an operator-approved schedule; destructive actions remain manual.

## Rollback and roll-forward

The migration introduces states and fencing that the pre-Phase-2 worker does not understand. Do not roll back to the legacy worker after applying it.

Emergency procedure:

1. Stop all worker replicas to stop claims. The durable queue may grow but remains recoverable.
2. Leave the corrective migration and data in place.
3. Disable new media upload entry only if queue/source growth threatens capacity; do not expose sources or bypass processing.
4. Diagnose using protected health/events and dry-run reconciliation.
5. Roll forward with a corrected Phase 2-compatible image. Expired leases will reclaim interrupted jobs.
6. If an API rollback is unavoidable, retain job-trigger behavior and Phase 1A/1B contracts; never restore the select-then-update claim path.

Derivative upserts and fenced completion make worker image roll-forward safe. Database down-migration or deletion of lease/event state is not an approved rollback.

## Unverified items and remaining risks

- No hosted worker, scheduler/process supervisor, hosted Storage/CDN, alert, or dashboard was configured.
- No production-like throughput/capacity test was run; 1,000-user readiness is not claimed from local functional tests.
- Actual hosted worker `SIGKILL`, database restart, network partition, Storage outage/throttling, and out-of-memory behavior remain unverified.
- Android/iOS production bundles pass, but a physical two-account mobile process-kill/background/restart matrix was not repeated specifically for Phase 2.
- The retired mobile-only history remains an unsupported ambiguous hosted state unless explicitly reconciled through the Phase 3 operator process.
- PH-001 credential-owner assessment/rotation, PH-002 baseline adjudication, and prior hosted/native gates remain open.
- The container dependency advisories require authorized registry/audit review and normal dependency remediation.
- A worker can upload deterministic partial derivatives immediately before a concurrent account freeze; completion is fenced and Phase 1B/cleanup inventory removes them, but hosted race cleanup must still be exercised.
- OS/framework media caches remain outside the owner-scoped file store's purge guarantees; Phase 1A signed URL expiry limits future access but cannot revoke bytes already downloaded.
- Source/object counts must be monitored. Retention is durable only if at least one healthy worker/scheduler continues running.

## Phase gate

```text
PASS locally
```
