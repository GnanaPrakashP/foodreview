# Media queue stuck or dead-letter growth

## Symptoms and alert

Oldest queued media exceeds 300/900 seconds, dead letters grow, ready-unattached assets grow, or user uploads remain processing.

## Immediate checks

Inspect queue counts/age, worker heartbeat, failure-code distribution, lease expiry, Storage/provider health, CPU/memory, and release. Do not inspect object paths or media content in general dashboards.

## Commands and evidence

Run `npm run operations:health:media`, `npm run media:reconcile`, worker health, and Phase 2 processing validation. Preserve aggregate job status and safe failure codes.

## Containment

Pause new upload rollout if capacity is exhausted, keep durable jobs, and reduce concurrency if dependencies are throttling. Never mark unprocessed media ready.

## Recovery and rollback

Restore worker/dependency, rollback bad image, then allow leases to reclaim and bounded retries to drain. Requeue only with the reviewed reconciliation path; permanently invalid media remains rejected/dead-lettered.

## Verification, escalation, follow-up

Fresh heartbeat, oldest age below warning, no unexpected dead-letter growth, canonical derivatives and authorization tests pass. Page media/platform; page security for private-object errors. Add failure fixture/capacity action.
