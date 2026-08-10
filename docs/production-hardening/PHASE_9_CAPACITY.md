# Witoh production hardening — Phase 9 capacity

Date: 2026-07-14

Branch: `hardening/11-load-capacity`

Source commit: `f9321a9ce43be75cc31eca0135ad3f3beb5dc718`

## Capacity conclusion

**NOT PROVEN — harness complete, hosted execution blocked.**

The implementation target is `PASS LOCALLY — HOSTED CAPACITY NOT PROVEN`. No claim that Witoh supports the launch profile is allowed until the complete hosted and physical-device matrix passes on one recorded production-like topology.

## Required profile

- 1,000 registered users.
- 500 monthly and 200 daily active users.
- 100 peak concurrently active sessions.
- 30 concurrently active Memory rooms.
- 20 concurrent image/video uploads and processes, using 80% images and 20% short videos.
- Stress at 200 concurrent sessions, 60 rooms and 40 uploads.
- Soak at launch load for at least four hours.

Registered population is not treated as concurrent population. Capacity can be proven only for the exact tested topology, release, migration head and traffic distribution.

## Pre-change baseline

The clean Phase 8 branch and required commit history were verified before edits. Local shell Node was v26.0.0 while repository CI/release workflows target Node 22. Docker client was 29.6.0. No k6 or Artillery executable was installed, so Phase 9 uses the repository-owned Node 22 harness `circlebites-node-load` 1.0.0. The Supabase CLI remains repository-pinned to 2.109.1; one direct sandbox probe failed because the CLI attempted to write its telemetry file outside the writable workspace.

All staging identifiers, API/worker releases, topology/tier/region fields were unconfigured. That absence is a hard evidence blocker, not a value inferred from local Supabase.

## Test architecture

`config/load-capacity.json` is the model, threshold and safety authority. The Node harness uses built-in HTTP/fetch/FormData primitives and the existing Supabase SDK for authenticated actors, REST/RPC, private Storage and Realtime. It supports closed concurrent-user and arrival-rate modes, weighted scenarios, correlation IDs, expected Auth/rate-limit outcomes, multipart/binary upload, JSON results, threshold exit codes and cross-run aggregation.

Actors use independent sessions, stable mobile-shaped install UUIDs and resource manifests. Launch and soak actors are paced to the time-scaled 42-request-per-15-minute budget; stress arrives at four weighted activity steps per second, twice the modeled launch activity rate, with 200 actors. Tokens/passwords/service keys never enter results. API response bodies, private paths, signed URLs, room messages and media bytes are not logged. Results retain safe hostnames, releases, topology labels, aggregate counts/latency/bytes and bounded violation codes. Long-run latency samples are capped at 50,000 per endpoint group while total requests, errors and maximum payload bytes remain exact, preventing the measurement harness itself from leaking memory during a four-hour soak.

## Safety

All network runs require staging environment, HTTPS, an explicit hostname allowlist, staging ID, distinct API/worker releases, Git commit, migration head, database/API/worker topology and regions. Known production suffixes are rejected. Runtime caps are 250 users, 50 concurrent uploads and eight hours. Local-contract, normal, seed, cleanup, deletion and failure operations have six different confirmation strings; failure injection additionally requires an allowlisted HTTPS controller and a case from the checked-in matrix.

Safety stops are 5% unexpected errors, 85% database CPU, 1-second pool-wait p95, 15-minute oldest media queue, corruption or any privacy/authorization violation. Launch, stress, soak, Realtime and media executions require a separately allowlisted safety-telemetry endpoint; missing/invalid telemetry fails closed, and its token is never retained. The harness never disables RLS, signed-media rules, moderation or rate limiting.

## Deterministic data

Seed tooling creates synthetic Auth users and service-role setup rows with deterministic IDs/distribution for profiles, Circles, blocks, public/Circle/owner posts, social state, notifications/views, Memory rooms/members/messages/dishes, normalized dish mentions, moderation reports and deletion fixtures. The result distinguishes planned counts, rows actually inserted and media counts still deferred; planned counts are never presented as inserted evidence. Full counts are in `LOAD_TEST_MODEL.md`.

Real source Storage and worker throughput are populated through `load:media` with repository-generated Sharp/FFmpeg fixtures. A full capacity report requires 3,000 real uploads at bounded 20 concurrency: 1,920 image posts, 480 short-video posts and 600 Memory-room media objects. A metadata-only seed cannot satisfy the gate. The normal limiter remains active; full-volume population therefore needs approved distributed staging egress or normal rate-window pacing, and a single-source 429 is retained rather than bypassed. Cleanup scopes to `load9_` users and known owned Storage paths and requires separate confirmation. The local database contract creates ten real Auth users at 0.1% scale, seeds all relationship domains, cleans them, and verifies that profiles/posts/rooms/Auth users leave no residue.

## Workloads

### Auth

Session status and bounded refresh pressure run in the weighted workload. The separate abuse scenario verifies account switching, sign-in, logout/revoked-token denial, invalid and expired-shaped tokens, non-deliverable recovery throttling and deleting/frozen denial without driving real email delivery. Expected 401/429 results are classified separately from unexpected failures.

### Circle

First/next page, cursor overlap, seen batching and viewer-specific state use actual mobile API contracts. Duplicate page IDs become correctness violations. Feed/private-media authorization remains enabled.

### Explore, restaurant and dish

Explore calls the canonical hosted RPC with a bounded location/limit. Restaurant and dish feeds use the bounded mobile endpoint and normalized dish contract. Payload and percentile budgets are evaluated independently.

### Profile, comments and notifications

Current-profile shell/posts, other-profile row/stats/posts, liked/saved pages, hot comments with cursor paging, notification pages/unread counts/mark-read and bounded post-view mutations execute with actor sessions. Seed/reconciliation include suppressed/deleting profiles, high engagement and notification bursts.

### Memory and Realtime

Room summaries, bootstrap/chat pages and cursors execute through the mobile read endpoint. The dedicated fanout harness creates room-scoped subscriptions with actor JWTs, sends real messages, measures subscribe/delivery/reconnect, queries the missed interval after reconnect, verifies a post-reconnect delivery and counts missed, duplicate and forbidden deliveries. Non-member receipt is a release-blocking privacy violation.

### Media and workers

The media harness creates a real `/api/media/upload-intent`, uploads bytes to the returned private Storage source path, finalizes, and polls owner-only status until ready or terminal. It also executes two launch or four stress avatar replacements through the mobile quarantine/moderation endpoints. Concurrency, upload/processing p95, terminal/dead-letter state, publication completeness and unfinished work are retained. Moderation is not bypassed.

### Failure recovery

Fifteen cases cover API/media/deletion/scheduler/database/pool/Storage/network/Realtime/push/Places/moderation/telemetry and bad API/worker releases. The external controller must acknowledge matching protocol/case inject and restore actions and return every case-specific evidence field in the matrix, including applicable lease fencing, bounded retry, queue recovery, fail-closed, alert and runbook outcomes. The harness always attempts restore, then measures health/auth recovery and reruns a forbidden-room privacy probe.

### Deletion, push and moderation

The deletion harness concurrently requests ten fixture deletions, measures freeze p95, verifies write denial, polls durable jobs for up to two hours and fails on incomplete, failed or ambiguous work. Push and moderation/provider measurements are imported as release-bound, attested external evidence because they require isolated provider credentials and operator dashboards. Both are mandatory in the capacity report.

### Reconciliation

The read-only service-role report checks duplicate social/member/job relationships, orphan reviews/rooms/assets, ready media without canonical derivatives, access-class/visibility mismatches, job-attempt bounds, notification projection drift and zero unexplained violations. It runs dry-read only and never repairs data.

## Thresholds and SLOs

Launch/soak HTTP p50/p95/p99 are 300/800/1,500 ms, unexpected errors under 1% and payload at most 256 KiB. Stress is 500/1,500/3,000 ms and under 3%, while correctness remains zero. Realtime delivery p95 is one second at launch; miss/duplicate rate is at most 0.1%. Media upload/processing p95 are 15/120 seconds and oldest queue age is five minutes.

`docs/performance/SLOS.md` adds measurement source, window, warning/critical, owner and runbook for API, database/pool, mobile, media, Realtime, deletion, push, moderation and correctness.

## CI and manual execution

Application CI validates config/source/docs, runs Phase 9 unit/static tests and executes a deterministic loopback smoke with expected 401/429 classification and threshold enforcement. It does not claim capacity.

`.github/workflows/hosted-capacity.yml` is manual and bound to the protected `capacity-staging` environment. Inputs include environment, exact API and worker releases, scenario, launch/stress sub-tier, duration, concurrency, media total and confirmations. Secrets remain protected; JSON results are retained 90 days. Plaintext actor manifests are excluded from artifacts and the seed manifest is retained only after AES-256/PBKDF2 encryption with a protected password. Media files are generated ephemerally from deterministic repository recipes instead of being stored in size-limited workflow secrets. The workflow has no schedule and no production environment or deployment/store action. Realtime and media can each produce both required launch and stress evidence.

## Capacity aggregation

`load:report` requires matching seed, launch, stress, four-hour soak, Realtime launch/stress, media launch/stress, abuse, deletion, all fifteen failure cases, restore, physical Android/iOS, platform and soak telemetry, stress recovery, push, moderation, alert/runbook and reconciliation evidence. It verifies the 100/30/20 launch and 200/60/40 stress models, exact seed and real-media minimums, active safety-monitor evidence, shared staging/Git/API/worker/migration metadata and zero threshold failures. Its JSON also groups repeated scenario/tier runs and records latest-versus-previous p95 and error-rate deltas.

Restore, device, platform, soak, recovery, push, moderation and alert evidence must be independently executed and attested. `load:evidence` validates required metrics, physical/release-device assertions where applicable, exact staging/Git/API/worker/migration identity, and stores a source SHA-256 without copying private evidence. Missing evidence always produces `NOT PROVEN` and a nonzero report exit.

## Local validation evidence

The Phase 9 validator currently passes 83 checks, the focused suite passes 23/23, the deterministic loopback smoke passes 62 requests, the deterministic JPEG/H.264 generator passes decode inspection, and the real local seed/cleanup contract passes with ten users and zero fixture residue. Canonical reset/drift, pgTAP 88/88, database runtime gates and Phase 1A–8 focused regressions also remain green. Memory is 72/72; root/mobile typechecks pass; lint has zero errors; and the Next production build generates all 92 routes/pages. The full root suite is 1,143/1,163 with exactly the 20 pre-existing PH-002 static/UI failures recorded by Phase 8, so Phase 9 adds no new full-suite failure.

Fresh native compatibility validation also passes: Android `assembleRelease` and `bundleRelease` completed with R8/shrinking and an explicitly disposable two-day local key; the generic-iPhone arm64 Release build completed with signing disabled; native inventory is 72/72 and the 17-case device matrix remains structurally complete but physically unexecuted. APK, AAB, iOS binary, Hermes bundle and source-map scans pass. These local results remain implementation evidence only; none may populate hosted latency, CPU, pool, Storage, worker, Realtime, soak, RPO/RTO or physical-device result fields.

## Hosted result status

| Required result | Status |
| --- | --- |
| Staging topology/tier/regions/releases | BLOCKED — unconfigured |
| Launch tier | BLOCKED — not executed |
| 2× stress/breakpoint/recovery | BLOCKED — not executed |
| Four-hour soak/leak/backlog trend | BLOCKED — not executed |
| Realtime fanout/provider tier limit | BLOCKED — not executed |
| Media/Storage/worker/moderation | BLOCKED — not executed |
| Deletion/push/rate limit across replicas | BLOCKED — not executed |
| Database CPU/memory/I/O/pool | BLOCKED — no hosted topology |
| Failure matrix and alert delivery | BLOCKED — no controller/staging alerts |
| Restore and achieved RPO/RTO | BLOCKED — no provider restore |
| Android/iOS under backend load | BLOCKED — no signed physical devices |
| Post-load correctness | BLOCKED until hosted load exists |

## Recommended launch topology and scaling

No final topology recommendation can be evidence-based yet. Before testing, the owner must record database compute/pool mode/size, API CPU/RAM/replicas/concurrency, worker CPU/RAM/disk/replicas/concurrency, Realtime tier/limits, regions and provider quotas. Use at least two API replicas for cross-replica limiter/pool tests and enough worker isolation to test bounded 20-way processing without starving API traffic.

Candidate scaling triggers are 70% database CPU/connections, 500-ms pool wait, API p95 800 ms, media queue age five minutes, worker memory growth 10%/hour, Realtime delivery one second or subscription failures 0.5%. These are triggers to investigate/scale, not proof that a larger tier will pass.

## Manual production steps

1. Resolve Phase 8 credential, hosted telemetry, legal and physical-device blockers.
2. Provision disposable production-like staging and separate provider credentials.
3. Record snapshot, topology, releases, regions and migration/drift.
4. Execute the ordered runbook without weakening security.
5. Retain all successes and failures, reconcile after every destructive case and prove restore.
6. Obtain Android/iOS signed-device evidence under launch and p95 backend conditions.
7. Generate the final report and obtain platform, security/privacy, mobile and release-owner approval.
8. Manually release only if Phase 1A–8 and the complete Phase 9 gate pass.

## Remaining risks

- PH-001/002/003 and Phase 7/8 hosted, credential, scheduler, alert, provider, legal and physical blockers remain.
- Supabase/Realtime/Storage/provider quotas and cost behavior are unknown for the intended tier.
- API/database/worker saturation point, graceful degradation and recovery are unknown.
- Queue, pool, connection, worker-memory and operational-table growth over four hours are unknown.
- RPO/RTO and Storage recovery remain unverified at production-like volume.
- The registered-user launch profile remains unproven.

## Phase gate

```text
PASS LOCALLY — HOSTED CAPACITY NOT PROVEN
```
