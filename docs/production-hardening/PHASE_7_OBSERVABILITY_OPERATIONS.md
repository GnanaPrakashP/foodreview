# Phase 7 — Production observability, scheduled operations and recovery

Date: 2026-07-13
Branch: `hardening/09-observability`
Parent: `bee3d9157913575e11ec3a41243770d152dc0ad6`
Implementation status: PASS locally
Release verification status: BLOCKED

## Executive result

Phase 7 establishes a privacy-safe operational control plane for the React Native application, Next.js APIs, media/account-deletion workers, canonical Supabase database, scheduler, moderation, and Expo push delivery. Sentry captures application failures and bounded traces, JSON logs provide searchable aggregate events, and service-role-only database contracts provide durable queue/heartbeat/health truth. Telemetry is fail-open; job and application success never depend on Sentry or a log sink.

The local gate passes. Phase 7 focused tests pass 17/17, the real database operational runtime passes 9/9, pgTAP passes 88/88, real Auth/RLS/Storage policy tests pass 10/10, the local restore drill succeeds, and production exports/native compiles contain Sentry and source-map artifacts. Phases 1A–6 focused and runtime regressions remain green.

This does not prove production alert delivery, hosted telemetry, Expo provider delivery, hosted PITR/Storage recovery, a staging restore, or a production canary/rollback. Those release checks remain blocked and must be executed in disposable production-like staging before launch. Phase 9 capacity/load evidence is also intentionally absent; no 1,000-user capacity claim is made.

## Architecture selected

The architecture has three bounded layers:

1. Sentry for React Native native/JavaScript crashes, ANRs/app hangs, watchdog termination, sessions, app start/native frames, Next.js exceptions, and worker exceptions.
2. A shared structured JSON contract for safe operational logs with environment, service, release, event, severity, correlation, bounded status/duration/count fields, recursive redaction, and fail-open emission.
3. Canonical Supabase operational state for jobs, Expo tickets/receipts, scheduler runs/heartbeats, service heartbeats, retry/dead-letter state, retention, and a read-only health snapshot.

The database remains authoritative for work. Logs do not contain enough private data to replay a request, and telemetry loss cannot mark a job successful or prevent normal application behavior.

## Telemetry tools and runtime identity

- Next.js/API: `@sentry/nextjs` with server and Edge initialization.
- Workers: `@sentry/node` through the shared worker bootstrap.
- Mobile: `@sentry/react-native` with the Expo configuration plugin and native autolinking.
- Database: `production_operations_health()` plus existing Phase 3 drift/schema contracts and provider dashboards.
- Configuration: `config/observability-inventory.json`, `config/operations-alerts.json`, and `config/operations-schedules.json`.

Production configuration requires a valid environment, non-local release, and Sentry DSN. Safe release output includes environment, application version/build, API/worker release, Git release ID, and expected database migration head `202607160001`. API and worker health surfaces do not expose secrets.

## Structured logging and redaction

`lib/observability/structured-log.mjs` owns serialization, environment/release normalization, safe error classification, recursion limits, field count/array limits, URL query removal, and secret/content filtering. Service loggers are `foodreview-api`, `foodreview-scheduler`, `foodreview-push`, `foodreview-media-worker`, and `foodreview-account-deletion`.

Forbidden fields include authorization/cookies/JWTs, credentials, API/service keys, DSNs, raw/signed URLs, Storage paths, push tokens, email, precise IP/location, profile data, review/comment/chat/notification content, room/restaurant names, screenshots, view hierarchy, request/response bodies, and raw provider responses. Sentry `sendDefaultPii` is false; request/user context is removed; breadcrumbs are reduced to safe metadata; screenshots and view hierarchy are disabled. Logger and telemetry-provider exceptions are caught so the caller continues.

Phase 7 attaches no Sentry user and emits no account identifier or actor hash. Logout, account switching, local cleanup, and deletion clear any SDK association defensively.

## Correlation design

API middleware accepts only bounded safe `X-Request-Id` values or generates a UUID. It overwrites the internal request-start header so callers cannot forge duration, propagates the ID to route context, and returns `X-Request-Id` plus `X-Correlation-Id`. The mobile API client generates and sends a request ID, captures the returned correlation ID on safe failures, and never treats it as authority. Schedulers, workers, push jobs, and provider calls use bounded run/job correlation identifiers.

Every instrumented API request emits one completion/rejection/failure record with bounded endpoint, status category, duration, serialization duration, and payload-size category. High-cardinality URL paths, query strings, database IDs, and content are excluded.

## Mobile crash and performance telemetry

Production mobile initialization enables native crashes, Android NDK crashes, iOS watchdog termination, ANR/app-hang tracking, sessions, app start, native frames, release/environment tags, and configurable trace sampling. A watchdog flow provides an additional bounded main-thread responsiveness signal. Root error capture wraps the Expo Router application.

Safe flow signals cover session resolution, cache-owner change, owner cache hydration, cleanup duration/failure, account-boundary readiness, cold/warm lifecycle, connectivity, API latency/status, Circle/Explore/Profile cached/fresh markers, media intent/source/finalize/processing/recovery, comments, Memory room/chat/realtime, and account deletion request. They report outcome/duration/count/category only.

The Android release build compiled the `sentry_react-native` module and produced the Hermes packager map plus native-debug-symbol archive. A disposable generated iOS project installed `RNSentry` and compiled a code-signing-disabled arm64 release target with a Hermes map and dSYM. The local iOS compile set `SENTRY_DISABLE_AUTO_UPLOAD=true` because no hosted Sentry organization/project/upload credential is configured; the generated upload phases are present and the first attempt correctly refused an unauthenticated upload. Controlled hosted crashes, actual uploads/symbolication, ANR/watchdog capture, and physical-device performance remain staging/Phase 8 work.

## API and worker telemetry

API security owns bounded request context and classification for expected 4xx, rate limits, auth failures, dependency timeouts, and unexpected 5xx. Sentry capture uses sanitized exceptions. Server and Edge Sentry setup share the same privacy filter and are environment/release scoped.

Media processing logs claim/batch/provider outcome and duration and records a durable `media-worker` heartbeat. Account deletion records a durable worker heartbeat and safe batch/failure outcome. Scheduled jobs persist started/succeeded/failed state, release, correlation, timing, and next expected time. Worker startup/readiness distinguishes initial startup from normal claim-loop health so a process that never works is detectable.

## Database and queue health

`production_operations_health()` reports migration head; database size, connections, active waits, lock waits, invalid indexes, and unvalidated constraints; media queued/running/retry/dead-letter by media type, oldest age, recent processing/cleanup/reclaim failures, worker heartbeat, and ready-unattached assets; account deletion pending/failed/frozen/ambiguous state; moderation outcomes/provider failure/quarantine backlog; push queued/receipt/dead-letter/failure/disabled-token state; scheduler missed/failing jobs; and bounded operational table row counts.

Operational tables and functions are service-role only with explicit RLS, revokes, and grants. The health CLI is read-only by default, sanitizes output, verifies migration head, and exits nonzero for critical or unavailable health. The final local snapshot reports 28 healthy checks and zero warning, critical, or unknown checks.

## Durable Expo push delivery

Notification creation now enqueues a durable job per active push-token record using a dedupe key; it no longer sends directly to Expo. The queue stores notification/token IDs and safe type/correlation metadata, not notification text or token material. The sender resolves current token/notification data only while holding a fenced lease, sends at most 100 messages, persists unique Expo ticket IDs, and schedules receipt checks after a delay.

Receipt batches are capped at 1,000. Timeouts, HTTP 429/5xx, provider unavailability, and retryable ticket/receipt errors use durable exponential backoff. Duplicate ticket IDs cannot duplicate work. `DeviceNotRegistered` disables the token. Permanent failures and exhausted retries reach visible terminal/dead-letter states. Reconciliation is dry-run by default and requires an explicit confirmation token to requeue stale leases.

Local tests cover ticket success, delivered receipt, temporary failure, invalid device token, duplicate ticket, timeout, and retry exhaustion. No real Expo provider call or credential was used, so hosted provider verification remains blocked.

## Scheduled operations

`config/operations-schedules.json` declares 16 operations with owner, cadence, timeout/lease expectations, runbook, and trigger type. Protected Vercel cron routes cover push sends/receipts; deletion processing/reconciliation/media cleanup; abandoned media, media supervision/dead-letter handling; moderation; expired Memory uploads; API state cleanup; disabled token cleanup; operational retention; and read-only orphaned Storage reconciliation. Dish curation uses its existing GitHub workflow and continuous media processing remains worker-owned rather than pretending to be a cron.

Every API-triggered run is authenticated by `CRON_SECRET`, bounded, correlated, recorded, and heartbeat-monitored. Missed-run detection compares last success/next expected time against schedule tolerance. No local command claims that Vercel/GitHub/worker schedules are deployed.

## Alerts and dashboards

There are 43 machine-readable warning/critical alerts and 16 inventoried signal groups. Initial thresholds are explicitly tunable. Coverage includes mobile crash-free sessions, ANR and startup; API 5xx/latency/auth/rate/provider failure; database CPU/memory/slow queries/connections/waits/locks/migration/operational growth; media queue/type-specific dead letter/worker/cleanup; deletion backlog/ambiguity; push queue/receipt/invalid token; moderation; and scheduler failure/misses.

Every alert has an owner, source, actionable threshold, and checked-in runbook. Alert dimensions are bounded to environment/release/endpoint or job category. Local alert-condition tests and health classification pass; real delivery/routing/escalation remains unverified.

## Runbooks

Seventeen runbooks cover mobile crash spike, API 5xx, database saturation, migration failure, private-media authorization failure, media queue stuck, media worker unavailable, account deletion stuck, push delivery failure, moderation backlog, Storage outage, Supabase outage, provider outage, bad mobile release, bad API release, credential exposure, and scheduler missed run.

Each includes symptoms, alerts, first checks, safe commands, containment, recovery, rollback/roll-forward, verification, escalation, and post-incident follow-up. Commands do not contain secret values.

## Backup, restore, RPO and RTO

Required production coverage is a database RPO of 15 minutes with PITR, RTO of four hours, at least seven rolling days of PITR, and 30 days of daily recovery points or a tested equivalent. Configuration has a 24-hour RPO/four-hour RTO. Drill evidence is retained one year. Database backup does not cover Storage bytes, secrets, provider state, telemetry, DNS, images, or store-distributed binaries.

The disposable local restore drill performs a real custom-format `pg_dump`, creates a randomly named clean database, restores as local `supabase_admin` so managed Realtime settings are preserved, verifies expected migration head, canonical/operations schema contracts, service-only RLS, and Phase 1A–5 critical domains, then drops the database and dump. The final drill passes. Hosted PITR, isolated-project restore, Storage sample recovery, and achieved production RPO/RTO remain unverified.

## Rollback and roll-forward

Deployment order is backup/restore point, additive migration/contracts, API canary with schedules disabled, worker canary with fencing, scheduler canary, then mobile after source-map verification. The compatibility window supports the prior API/worker release and at least one prior mobile version only when the active migration head is within the binary's declared contract.

API/worker rollback is preferred; migrations are roll-forward only through a reviewed corrective migration. Worker rollback stops claims, drains/expires leases, verifies fencing, and starts a compatible image with a new worker ID. Scheduler rollback disables the changed trigger before restoring its prior definition and preserves jobs/history. Store-distributed mobile binaries cannot be recalled.

Emergency procedures cover disabling upload intents, media worker claims, new deletion requests, provider-backed APIs, and moderation publication while preserving durable state and fail-closed privacy behavior.

## Migration and operational tooling

One additive canonical migration was added: `202607130010_observability_operations.sql`. It adds push delivery/receipt state, scheduler runs/heartbeats, service heartbeats, moderation leases/retries, disabled push-token state, bounded retention/reconciliation helpers, health/contracts, indexes, RLS, and explicit grants. No applied migration was edited.

Operator commands:

- `npm run validate:observability`
- `npm run operations:health` and scoped media/deletion/push/scheduler forms
- `npm run operations:release`
- `npm run push:reconcile` and explicitly confirmed `push:reconcile:apply`
- `npm run backup:restore-drill:local`

The scripts default to read-only/dry-run and never print service credentials.

## Tests and local validation

Phase 7 adds structured-log/redaction/fail-open, Sentry configuration, correlation, schedule/tool/runbook, mobile/API/worker signal, alert-condition, push ticket/receipt, pgTAP, real runtime, and restore tests. Changed legacy VM harnesses received inert mocks for the new telemetry/queue dependencies; no security or product assertion was weakened. The former direct-Expo source assertion now verifies durable queuing and receipt ownership.

Final local results:

- Phase 7 focused tests: 17/17.
- Phase 7 real operational runtime: 9/9.
- Observability inventory: 16 signals, 16 schedules, 43 alerts.
- Local health: 28 healthy; 0 warning; 0 critical; 0 unknown.
- Migration manifest: 67 migrations, 85 history entries, two documented historical conflicts.
- Clean Supabase reset: pass.
- SQL lint: pass.
- pgTAP: 88/88.
- Real Auth/RLS/Storage policies: 10/10.
- Upgrade fixtures: 7/7.
- Drift: zero.
- Root/mobile TypeScript: pass.
- ESLint: zero errors; 95 existing warnings.
- Memory hardening: 72/72.
- Next production build: pass.
- Android/iOS production Expo exports with Hermes maps: pass.
- Android Gradle release with native Sentry: pass.
- Disposable iOS Release compile with RNSentry: pass.
- Local database restore drill: pass.
- Secret/configuration/artifact scans and `git diff --check`: pass.

## Phase 1A–6 regression status

- Phase 1A static 6/6 and real runtime 13/13: pass.
- Phase 1B static 6/6 and real runtime 9/9: pass.
- Phase 1C 8/8: pass.
- Phase 2 static 11/11, real database 14/14, and processing 10/10: pass.
- Phase 3 canonical static 6/6, pgTAP/policies/upgrades/drift: pass.
- Phase 4 static 10/10, real database 9/9, and HTTP API 10/10: pass.
- Phase 5 static 8/8, real 10k-review/5k-message database fixture, and HTTP API: pass.
- Phase 6 static 12/12, production exports, and native release compiles: pass.

## Baseline failure comparison

The Phase 6 baseline was 1,085/1,105 with 20 PH-002 failures. Phase 7 final is 1,103/1,122 with 19 failures. Seventeen Phase 7 tests were added, all pass; telemetry/queue integration regressions were corrected; and one changed-path stale direct-Expo assertion was replaced by the durable queue/receipt contract. Every remaining failure is an unchanged registered PH-002 mobile UI/source-contract test. No Phase 7 failure remains. PH-002 stays open until owning product work replaces those implementation-regex tests with behavior-level proof.

## Hosted staging gate

Do not mutate production automatically. In disposable production-like staging:

1. Configure separate Sentry projects/DSNs/upload token, environment, release, sampling, retention, access, and processors.
2. Deploy migration, API release metadata, worker release metadata, schedule definitions, and operations-health polling.
3. Build signed internal Android/iOS releases and upload matching Hermes source maps, ProGuard/R8 mapping, native debug symbols, and iOS dSYMs.
4. Trigger controlled mobile JavaScript/native crash, ANR/app hang/watchdog where supported, API 5xx, worker failure, scheduler miss, provider timeout, invalid push token, and queue retry.
5. Verify symbolication, release/environment grouping, end-to-end correlation, actionable alert delivery, deduplication, escalation, and runbook commands.
6. Process real Expo tickets and receipts using non-production test recipients; verify invalid-token disablement and no content in durable queue rows.
7. Restore a provider backup into an isolated project, run contracts/RLS/Storage/private-media/application checks, and measure achieved RPO/RTO.
8. Execute API/worker/scheduler canary and rollback/roll-forward drills without editing applied migrations.

## Unverified items and remaining risks

- Sentry projects, source-map credentials, dashboards, retention, access, symbolication, ANR/watchdog delivery, and real alerts are not deployed.
- Vercel/GitHub/worker schedules and missed-run paging are not configured in a hosted environment.
- Expo provider ticket/receipt delivery and credential handling were not exercised.
- Supabase production backup/PITR plan, retention, restore authority, and Storage recovery are not verified.
- Production-like restore/canary/rollback incident exercises are not executed.
- Physical Android/iOS behavior and signed artifacts remain Phase 8 work.
- PH-001 credential adjudication, PH-002 stale tests, earlier hosted Phase 1A–6 blockers, PH-603 draft survival, and PH-902 component debt remain open/blocked as recorded.
- The final online production dependency audit reports four root advisories (two moderate, two high) and 18 mobile moderate advisories. Root Next.js 15.5.15 has a non-major 15.5.20 remediation path; the reported mobile Expo paths are semver-major. PH-003 tracks reviewed upgrades and complete regression/native validation rather than applying an opportunistic framework change inside Phase 7.
- Phase 9 load/soak/recovery testing is not started; operational correctness is not capacity proof.

## Phase gate

Implementation status: PASS locally.

Release verification status: BLOCKED pending hosted telemetry, real alert delivery, production scheduler configuration, real push-provider delivery, hosted backup/PITR and Storage recovery, a staging restore, canary/rollback drills, and signed physical-device evidence.
