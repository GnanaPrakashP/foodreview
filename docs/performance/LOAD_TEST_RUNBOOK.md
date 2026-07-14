# Hosted load-test runbook

## Preconditions

Use a disposable, allowlisted staging project with canonical migrations, production RLS/private buckets/Realtime, production-like API and database/pool sizes, workers, schedules, telemetry and a restorable snapshot. Never point the harness at production or reuse production credentials/data/providers.

Record `LOAD_STAGING_ID`, API/Supabase hosts, API/worker release, migration head, database tier, API/worker replicas and CPU/RAM, regions and network placement. Node 22 is required. The checked-in Node harness is version 1.0.0; CI and hosted workflow pin Node 22.

Protected values are `LOAD_STAGING_SUPABASE_ANON_KEY`, `LOAD_STAGING_SERVICE_ROLE_KEY`, `LOAD_ACTOR_PASSWORD`, actor manifest, actor-manifest encryption password, safety-telemetry token and chaos-controller token. Image/video fixtures are generated in the runner with checked-in deterministic Sharp/FFmpeg recipes, contain no third-party content and are not secrets. Results contain only hostnames, topology labels, aggregate metrics, safe codes and hashes.

## Safety confirmations

- Normal traffic: `LOAD_CONFIRMATION=CIRCLEBITES_STAGING_LOAD`
- Local database contract only: `LOAD_LOCAL_CONFIRMATION=CIRCLEBITES_LOCAL_SEED_CONTRACT`
- Seed: `CIRCLEBITES_STAGING_SEED`
- Cleanup: `CIRCLEBITES_STAGING_CLEANUP`
- Deletion: `CIRCLEBITES_STAGING_DELETION`
- Failure traffic uses normal confirmation and additionally `LOAD_FAILURE_CONFIRMATION=CIRCLEBITES_STAGING_FAILURE`

`LOAD_ALLOWED_STAGING_HOSTS` must contain both API and Supabase hostnames. HTTPS and staging metadata are mandatory. Known production host suffixes are rejected. Failure controllers require their own allowlisted HTTPS host. Launch/stress/soak/Realtime/media also require an HTTPS `LOAD_SAFETY_TELEMETRY_URL`, `LOAD_ALLOWED_SAFETY_HOSTS` and protected token. Its response must contain nonnegative database CPU, pool-wait p95 and media queue-age values plus corruption and authorization-violation fields. Missing telemetry aborts the run.

## Execution order

1. Run `npm run validate:load-capacity`, `npm run test:load-capacity`, and `npm run load:ci-smoke`.
2. Verify migration/drift, RLS/Storage tests, operations health, alerts, schedules and snapshot.
3. Preview `npm run load:seed`; then explicitly run `npm run load:seed -- --apply`. Retain the generated mode-0600 actor manifest outside artifacts that are shared broadly. The hosted workflow excludes plaintext `actors.json` and uploads only an AES-256/PBKDF2-encrypted copy using the protected environment password; decrypt it offline, load it into the protected actor-manifest secret, and do not commit it.
4. Run `npm run load:fixtures -- --output=<protected-temp-directory>`, then populate and measure all 3,000 real media fixtures with `npm run load:media -- --tier=launch --concurrency=20 --total=3000`; require 1,920 image posts, 480 short-video posts and 600 room-media successes. The repository-generated synthetic licence declaration is mandatory. Do not disable or bypass the shared limiter: a single-egress generator may legitimately hit the IP bucket, so use approved distributed staging generators or respect the normal rate windows and retain any limiter failure as evidence.
5. Run `npm run load:smoke`, `load:launch`, `load:realtime -- --tier=launch --rooms=30`, `load:media -- --tier=launch --concurrency=20 --total=3000`, `load:abuse`, and `load:deletion -- --users=10`. Deletion uses its own confirmation.
6. Run `npm run load:stress`, `load:realtime -- --tier=stress --rooms=60`, and `load:media -- --tier=stress --concurrency=40`; stop at safety abort and record the progressive breakpoint and recovery.
7. Run `npm run load:soak` for at least 14,400 seconds while dashboards and signed Android/iOS staging devices remain active.
8. Execute every failure case separately with `npm run load:failure -- --case=<id>` and its extra confirmation; reconcile between destructive cases.
9. Restore the staging-sized snapshot into an isolated project, test database and Storage separately, and import the attested result with `npm run load:evidence -- --scenario=restore --input=<safe-json>`.
10. Import release-bound external evidence for `mobile-android`, `mobile-ios`, `platform-telemetry`, `soak-telemetry`, `stress-recovery`, `push`, `moderation` and `operations-alerts` using `load:evidence`.
11. Run read-only `npm run load:reconcile`. Download all 90-day workflow artifacts into one protected directory and run `npm run load:report -- --input=<directory>` locally; an individual workflow run cannot aggregate artifacts from prior runs.
12. Preview `npm run load:cleanup`; then explicitly clean only the disposable fixture namespace with `--apply`.

The hosted workflow exposes environment, separate API/worker release, scenario, launch/stress sub-tier, duration, concurrency, media total and confirmations. It never schedules load or submits/mutates production.

## Required dashboards

Capture API p50/p95/p99/5xx/replicas; PostgreSQL CPU/memory/I/O/cache/connections, Supavisor mode/size/wait, locks/deadlocks/transactions; Storage throughput/errors; Realtime connections/subscription/delivery/reconnect and provider tier limits; worker CPU/RAM/temp disk/queue age/dead letter; deletion/push/moderation/scheduler backlogs; and mobile release cold/warm/useful-content, crash/ANR, JS/UI stalls, frames and memory.

Use correlation/run IDs, never response bodies, signed URLs, tokens, room content or private paths. Keep abuse-rate-limit results separate from normal latency.

## Failure and breakpoint rules

The controller accepts only IDs in `config/failure-injection-matrix.json` and must return the matching case ID and `circlebites-staging-chaos-v1` protocol on both injection and restoration. Injection returns `accepted: true`; restoration returns `restored: true` plus the exact case-specific `requiredEvidence` values from the matrix. Missing lease/queue/backpressure/fail-closed/alert/runbook evidence fails the case even when `/api/health` recovers. Stop immediately on authorization drift, cross-account events, corruption, uncontrolled queue growth or safety abort. Do not fix a result by disabling RLS/moderation/rate limits, increasing timeouts indefinitely, or silently discarding the run.

After load removal, measure time until API, pool, queues, worker memory and Realtime return below warning. Reconciliation must be zero before another destructive case.

## Evidence import schema

External evidence JSON must contain `schemaVersion: 1`, matching `scenario`, `executed: true`, measurement time, attester, exact staging ID, Git commit, API/worker release, migration head, safe aggregate `metrics`, `thresholds`, `thresholdFailures`, duration and correctness. Required metrics are scenario-specific in `config/load-capacity.json`; mobile evidence additionally requires a physical device and release build. Import records a SHA-256 of the source and does not copy credentials/private payloads.

## Final decision

`load:report` refuses proof unless launch, 2× stress, four-hour soak, launch/stress Realtime and media, all real-media volumes, abuse, deletion, all failure cases, restore, platform/soak/recovery/provider/alert attestations, both physical platforms and reconciliation share one staging/Git/API/worker/migration identity and all pass. It also requires active external safety-monitor samples for load, Realtime and media. Otherwise the conclusion is `NOT PROVEN`.
