# CircleBites production SLOs and capacity gates

These are initial release gates. Hosted Phase 9 evidence must validate them before launch; tuning requires owner approval, measured evidence and a runbook update.

| Domain/SLO | Source and window | Warning | Critical/release gate | Owner | Runbook |
| --- | --- | ---: | ---: | --- | --- |
| API p50 | load/Sentry, scenario + rolling 15m | 300 ms | 500 ms | API | api-5xx-spike |
| API p95 | load/Sentry, scenario + rolling 15m | 800 ms | 1,500 ms | API | api-5xx-spike |
| API p99 | load/Sentry, scenario + rolling 15m | 1,500 ms | 3,000 ms | API | api-5xx-spike |
| Unexpected 5xx | load/Sentry, scenario + rolling 15m | 1% | 3%; safety stop 5% | API | api-5xx-spike |
| API availability | external check, rolling 30d | 99.9% | 99.5% | Platform | supabase-outage |
| DB connections | provider/health, 5m | 70% | 85% | Platform | database-saturation |
| Pool wait p95 | provider, 5m | 500 ms | 1,000 ms | Platform | database-saturation |
| DB CPU/memory | provider, 5m | 70%/75% | 85%/90% | Platform | database-saturation |
| Mobile crash-free sessions | Sentry, release/24h | 99.5% | 99.0% | Mobile | mobile-crash-spike |
| Android ANR | Sentry/Play, release/24h | 0.3% | 1.0% | Mobile | mobile-crash-spike |
| Cold useful content p95 | physical release/Sentry, release/24h | 2.5 s | 4 s | Mobile | bad-mobile-release |
| Warm tab response p95 | physical release/Sentry, release/24h | 500 ms | 1 s | Mobile | bad-mobile-release |
| Media upload p95 | load, scenario | 15 s | 30 s | Media | media-queue-stuck |
| Media processing p95 | queue/load, scenario | 120 s | 240 s | Media | media-queue-stuck |
| Oldest media queue | health, 5m | 300 s | 900 s | Media | media-queue-stuck |
| Media success/dead letter | health, 15m | <99% / >0 | <97% / >4 | Media | media-queue-stuck |
| Realtime subscribe p95 | load/Sentry, scenario | 2 s | 3 s | Platform | realtime-fanout-degradation |
| Realtime delivery p95 | load, scenario | 1 s | 2 s | Platform | realtime-fanout-degradation |
| Realtime miss/duplicate | load, scenario | 0.1% | 0.5% | Platform | realtime-fanout-degradation |
| Realtime unauthorized delivery | reconciliation, every run | 0 | 1 blocks release | Security/Platform | realtime-fanout-degradation |
| Deletion freeze | API/load, every request | 2 s | 5 s | Privacy | account-deletion-stuck |
| Deletion completion | health, per job | 30 min | 2 h | Privacy | account-deletion-stuck |
| Deletion failed/ambiguous | health, 5m | 0 | 2 failed / any ambiguity | Privacy | account-deletion-stuck |
| Push ticket queue | health, 5m | 15 min | 60 min | Push | push-delivery-failure |
| Push receipt backlog | health, 5m | 30 min | 2 h | Push | push-delivery-failure |
| Push permanent failure | health, 15m | 5% | 15% | Push | push-delivery-failure |
| Moderation oldest pending | health, 5m | 15 min | 60 min | Trust & Safety | moderation-backlog |
| Correctness drift | post-load reconciliation | 0 | any violation blocks release | Platform/Security | load-slo-breach |
| Worker memory growth | hosted dashboard, hourly during soak | 10% | 20% | Media/Platform | load-slo-breach |

Launch must meet launch thresholds. Stress documents controlled degradation and recovery; it never relaxes correctness/privacy. Soak additionally requires no monotonic connection/memory/latency/backlog growth beyond checked budgets.
