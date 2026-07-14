# Capacity results

## Current conclusion

**NOT PROVEN — harness complete, hosted execution blocked.**

No disposable hosted staging identifiers, API/worker releases, topology, provider credentials or physical-device evidence were available during implementation. Therefore there are no launch, stress, soak, Realtime, media, failure, restore or mobile-under-load measurements and no valid 1,000-registered-user launch claim.

## Implementation baseline

| Item | Recorded value |
| --- | --- |
| Source | Phase 8 commit `f9321a9ce43be75cc31eca0135ad3f3beb5dc718` |
| Branch | `hardening/11-load-capacity` |
| Local shell Node | v26.0.0; hosted/CI harness requires Node 22 |
| Supabase CLI | Repository pin 2.109.1; direct sandbox probe could not write its telemetry file |
| Load tool | `circlebites-node-load` 1.0.0; no k6/Artillery binary installed |
| Docker client | 29.6.0 |
| Staging ID/topology/regions | Unconfigured |
| API/worker release | Unconfigured |
| Migration head expected | `202607130010` |

Local CI smoke exercises scheduling, correlation IDs, expected Auth/rate-limit statuses, percentiles, payload/error accounting and threshold failure behavior against a deterministic loopback server. The Phase 9 gate currently has 83/83 configuration/source checks, 23/23 focused tests, 62 successful loopback requests, a decoded deterministic JPEG/H.264 fixture check and a passing ten-user real Auth seed/cleanup residue check. Memory remains 72/72; the full root suite is 1,143/1,163 with the same 20 registered PH-002 failures; Next, Android APK/AAB and unsigned generic-iPhone arm64 Release builds pass; and their release artifacts pass the secret/local-endpoint scanner. None of this is backend capacity or physical-device evidence.

## Required hosted result table

| Domain | Current result |
| --- | --- |
| Circle, Explore, restaurant/dish, Profile | Blocked: no hosted staging |
| Comments and notifications | Blocked: no hosted staging |
| Memory list/chat | Blocked: no hosted staging |
| Realtime fanout | Blocked: no hosted project/tier evidence |
| Media upload/processing and moderation | Blocked: no hosted Storage/workers/providers |
| Account deletion and push | Blocked: no hosted workers/providers |
| Rate limits across replicas | Blocked: no API replicas |
| Database/pool/Storage metrics | Blocked: no hosted topology |
| Android/iOS under load | Blocked: no signed physical-device run |
| Four-hour soak and 2× breakpoint | Blocked |
| Failure injection | Blocked: no allowlisted chaos controller |
| Backup/restore/RPO/RTO | Blocked: no isolated provider restore |
| Reconciliation | Blocked until hosted seed/load exists |

Generated run evidence belongs in ignored `load-results/`; `npm run load:report` produces JSON/Markdown and fails nonzero while required evidence is missing. It requires all launch/stress sub-tiers and external attestations, checks active safety telemetry, and compares latest-versus-previous p95/error-rate deltas for repeated runs. Failed thresholds must remain in the retained results.

## Final 1,000-user statement

The current architecture is **not proven** for the defined profile of 1,000 registered users, 200 DAU, 100 peak concurrently active users, 30 active Memory rooms and 20 concurrent uploads. Local database/query/native gates from earlier phases reduce risk but cannot establish hosted capacity, soak stability, Realtime/Storage/provider limits, failure recovery or physical-client behavior.
