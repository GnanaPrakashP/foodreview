# CircleBites development load diagnostic — 2026-07-16

## Verdict

**Failed the launch latency targets. Production capacity is not proven.**

The controlled 100-concurrent-user run completed 1,539 requests with no unexpected HTTP errors and no correctness violations, but aggregate latency exceeded every launch percentile budget:

| Measure | Target | Observed | Result |
| --- | ---: | ---: | --- |
| HTTP p50 | <= 300 ms | 672 ms | Fail (2.24x target) |
| HTTP p95 | <= 800 ms | 4,569.136 ms | Fail (5.71x target) |
| HTTP p99 | <= 1,500 ms | 7,270.162 ms | Fail (4.85x target) |
| Unexpected error rate | <= 1% | 0% (0/1,539) | Pass |
| Correctness violations | 0 | 0 | Pass |
| Maximum JSON payload | <= 262,144 bytes | 58,739 bytes | Pass |
| Requests per actor | >= 14 | minimum 14 | Pass |

This result is useful as a development diagnostic, but it is not evidence that the database alone is the bottleneck and it is not an App Store or Play Store release-capacity result.

## Measured topology

- API: a production-built Next.js application running as one local process on `127.0.0.1:3025` on the developer Mac.
- Database/Auth: the current hosted non-production Supabase project.
- Database migration head: `202607160001`.
- Runtime: Node.js 22.
- Workload: closed model, 100 concurrent authenticated actors, 300 measured seconds.
- Request model: 14 target requests per actor; 1,538 actor requests plus one release-health request.
- Effective measured request rate: 5.13 requests/second across the five-minute interval.
- Fixture model: 120 synthetic users, 1,440 reviews, 2,880 likes, 2,160 comments, 3,600 initial notifications, 14 shared-memory rooms, and 3,600 memory messages.
- Worker topology: not running.
- Platform safety telemetry: unavailable for this development topology.

The measured workload ran from `2026-07-15T21:43:36.788Z` to `2026-07-15T21:48:36.796Z` (`2026-07-16 03:13:36` to `03:18:36` IST).

## Smoke gate

The corrected four-user smoke run completed 36 requests with zero unexpected errors and zero correctness violations. Its p50 was 240.071 ms, p95 was 863.038 ms, and p99 was 874.042 ms. It failed only the 800 ms p95 launch target.

The smoke result was retained as a failure instead of relaxing the threshold. The larger run proceeded only because the target was explicitly confirmed as non-production and the diagnostic harness retained its correctness and unexpected-error abort conditions.

## 100-user result

The workload ran for exactly 300 measured seconds. All 100 actors reached at least the required 14 requests; the busiest actor completed 21, for 1,538 actor requests total.

Routes with the clearest latency impact were:

| Route group | Samples | p50 | p95 | p99 | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| Circle feed (first page) | 127 | 2,010.959 ms | 6,035.809 ms | 8,385.187 ms | 0 |
| Profile shell | 65 | 2,831.664 ms | 6,480.123 ms | 7,352.515 ms | 0 |
| Restaurant feed | 42 | 3,213.348 ms | 7,519.227 ms | 7,674.987 ms | 0 |
| Notifications | 29 | 1,975.295 ms | 6,277.397 ms | 7,270.162 ms | 0 |
| Comments | 47 | 1,863.954 ms | 6,251.665 ms | 7,648.927 ms | 0 |
| Memory room list | 53 | 1,228.852 ms | 6,237.932 ms | 7,211.648 ms | 0 |
| Explore RPC | 66 | 484.463 ms | 4,491.339 ms | 5,078.302 ms | 0 |
| Memory chat | 51 | 1,262.193 ms | 4,474.871 ms | 6,291.525 ms | 0 |
| Media upload intent | 6 | 2,140.114 ms | 7,733.410 ms | 7,733.410 ms | 0 |

The zero error rate shows that the tested routes remained functionally available at this request model. It does not compensate for multi-second response times.

## Authentication setup finding

Before the timed workload, provisioning 100 fresh OTP-derived sessions triggered Supabase Auth `429 over_request_rate_limit`. The harness had to reduce verification to two actors at a time and use bounded backoff before all distinct sessions could be prepared.

This is evidence about a fresh-login burst, not normal traffic from returning users with restored sessions. Future API capacity runs should pre-provision short-lived non-production sessions outside the measured interval. A separate login-storm test should validate the intended production Auth quotas and user-facing resend/backoff behavior.

## Correctness and cleanup

- Post-load reconciliation passed with zero violations.
- The expected synthetic data remained internally consistent after the run.
- Cleanup processed all 120 prefixed synthetic Auth users with zero cleanup failures.
- A final reconciliation found zero remaining synthetic profiles, reviews, likes, comments, notifications, rooms, messages, media jobs, deletion jobs, or reports.
- No ordinary user account was selected by the fixture cleanup scope.

## What this run did not measure

- A hosted API deployment in the same region/topology intended for release.
- Database CPU, memory, cache hit rate, I/O, connection-pool wait, lock wait, or query plans.
- Multiple API replicas, autoscaling, CDN behavior, or production network paths.
- Realtime connections and message delivery.
- Real Storage uploads, media processing, moderation, or the background worker.
- Push notification delivery.
- A 15-minute launch run, stress breakpoint, long soak, failure recovery, or restore drill.
- Android/iOS release-client performance on physical devices.

Because the local API and hosted database were separated by the developer's network and no database telemetry was captured, the multi-second tail latency cannot be attributed solely to Supabase or solely to application code from this result.

## Required next actions

1. Instrument the real staging API and Supabase project with API CPU/memory, database CPU/I/O, pool wait, connection count, lock wait, and slow-query/query-plan evidence.
2. Deploy the exact release API build to staging in its intended region and rerun the smoke gate. Do not proceed while p95 exceeds 800 ms.
3. Profile and optimize the first-page Circle feed, profile shell, restaurant feed, notifications/comments, and memory room-list paths; these are the highest-impact route groups in this run.
4. Pre-provision reusable non-production actor sessions for API tests, then run a separate bounded OTP/login-storm scenario against configured Auth quotas.
5. Populate real media fixtures and run the worker, Storage, Realtime, push, 15-minute launch, stress, and soak scenarios with mandatory telemetry.
6. Complete physical Android and iOS release-build performance checks before making a store-release capacity claim.

## Evidence artifacts

- Seed: `load-results/1784150721412-seed.json`
- Corrected smoke: `load-results/1784150619561-smoke.json`
- 100-user diagnostic: `load-results/1784152116797-development.json`
- Post-load reconciliation: `load-results/1784152139798-reconciliation.json`
- Cleanup: `load-results/1784152181778-cleanup.json`
- Final zero-fixture reconciliation: `load-results/1784152198196-reconciliation.json`

These raw artifacts are local, git-ignored, and contain no reusable production credentials.
