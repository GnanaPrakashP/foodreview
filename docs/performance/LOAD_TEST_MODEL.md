# Witoh load-test model

The machine-readable authority is `config/load-capacity.json`. This model describes the initial launch profile; it does not assert that the profile has passed.

## Population and concurrency

| Population | Model |
| --- | ---: |
| Registered users | 1,000 |
| Monthly active users | 500 |
| Daily active users | 200 |
| Peak concurrently active users | 100 |
| Active Memory rooms at peak | 30 |
| Concurrent media uploads/processes | 20 |
| Typical session | 15 minutes / 18 weighted activity steps / 42 HTTP requests |
| Feed pages per session | 3 |
| Messages per active room/minute | 4 |
| Post creates | 8 per 100 sessions |
| Comments | 35 per 100 sessions |
| Reactions | 60 per 100 sessions |
| Media uploads | 10 per 100 sessions; capacity burst tested separately |
| Notifications generated | 6 per DAU/day |
| Avatar updates | 2 per 100 sessions |

Registered users are storage/data volume, not simultaneous virtual users. Stress is 200 concurrent users, 60 rooms and 40 uploads. Soak is the launch tier for at least four hours.

## Weighted session

Circle feed is 24%, Explore 12%, restaurant/dish 8%, Profile 10%, comments 8%, notifications 7%, Memory list 8%, Memory chat 12%, Auth 5%, bounded mutations 4%, and media-intent pressure 2%. Media capacity also runs independently with an 80% image/20% bounded-short-video mix so API latency cannot hide worker or Storage saturation.

The closed launch/soak model preserves concurrently active sessions and paces each actor to the 42-request budget instead of running an unbounded tight loop. Composite activity steps may issue several real requests; the harness records each actor's actual request range and fails if the minimum does not reach the time-scaled model. Stress uses four weighted activity arrivals per second with a 200-session ceiling, exactly twice the modeled launch activity rate of 18 steps × 100 users / 900 seconds. Each actor owns an authenticated session, stable install UUID and account-scoped resource manifest; tokens are never shared between actors or written to results.

## Dataset

The deterministic full seed targets 1,000 profiles, 5,000 Circle memberships, 120 blocks, 12,000 posts, 24,000 likes, 6,000 bookmarks, 6,000 reactions, 18,000 comments, 30,000 notifications, 50,000 views, 120 Memory rooms, 900 memberships, 30,000 messages, 1,200 Memory dishes, 18,000 normalized dish mentions, 400 places, 300 moderation reports and 10 deletion candidates plus 10 frozen-account fixtures. Seed evidence separately records planned counts, rows actually inserted and media counts deferred to the real pipeline. The real media workload supplies exactly 3,000 repository-generated synthetic objects through normal intent/Storage/finalize/worker contracts: 1,920 image posts, 480 short-video posts and 600 Memory-room media objects.

Distribution is deliberately uneven: 2% high-engagement posts, 5% large-circle users, 5% popular rooms, an explicit 50-room user, 10% owner-only posts, 25% Circle posts, 35% unread notifications, blocked pairs and suppressed/deleting fixtures. All names, emails, text and files are synthetic; setup uses service role only for administration. Workloads use normal Auth, RLS, Storage and API contracts.

## Scenario contracts

- Auth: session status, bounded refresh pressure, expired/invalid credentials, frozen/deleting denial and rate limits without email delivery load.
- Circle: first/next/refresh, cursor overlap, seen batching, explicit blocked-author absence and viewer/privacy/media state.
- Explore/restaurant/dish: canonical RPC, location, normalized dish identity, pagination and bounded payloads.
- Profile/liked/saved: shell, post pages, stats and actor isolation.
- Comments/notifications: hot-post pages, blocked-read denial, own create/delete, foreign-delete denial, counts, unread/read and push queue consequences.
- Memory: bounded room summary, bootstrap/chat/media pages and no per-room list fanout.
- Realtime: member subscriptions, non-member silence, message delivery, duplicate/miss rate, reconnect subscription, bounded database reconciliation and delivery after reconnect.
- Media: real private Storage source upload, finalize, worker queue and ready/terminal state for 80/20 post/Memory fixtures, plus two launch or four stress avatar updates through the mobile quarantine/moderation contract.
- Failure: one allowlisted chaos case at a time under normal load, followed by restoration, privacy/correctness probes and case-specific controller evidence for leases, queues, backpressure, fail-closed behavior, alerts and runbook execution.

## Acceptance thresholds

Launch and soak use HTTP p50/p95/p99 of 300/800/1,500 ms, unexpected errors below 1%, response payloads at or below 256 KiB and zero correctness drift. Realtime subscribe/delivery p95 are 2,000/1,000 ms with miss/duplicate rates at or below 0.1%. Media upload/processing p95 are 15/120 seconds and oldest queue age is at most five minutes.

Stress permits 500/1,500/3,000 ms and 3% unexpected errors while still requiring zero correctness/privacy violations. The first SLO breach, saturation point, maximum stable throughput and recovery must be retained; stress does not need to meet launch latency after the recorded breakpoint.

Safety aborts are 5% unexpected errors, 85% database CPU, 1-second pool-wait p95, 15-minute media queue age, data corruption, unauthorized delivery or privacy failure.

HTTP timing uses a bounded 50,000-sample ring per endpoint group during long soaks while request counts, unexpected errors and maximum payload bytes remain exact. Every launch, stress, soak, Realtime and media run requires an allowlisted external safety-telemetry endpoint; loss of that monitor fails closed and aborts the run.
