# Bad API or worker release

## Symptoms and alert

5xx/latency, queue failures, heartbeat errors, or mobile flow failures begin with a specific API/worker release.

## Immediate checks

Confirm release identity across API/workers/database, endpoint/job concentration, migration compatibility, error codes, canary results, and prior release health.

## Commands and evidence

Run `npm run operations:release`, `npm run operations:health`, focused contracts, and `/api/health`. Preserve deployment ID, image digest, request/run IDs, and contract output.

## Containment

Pause deployment and affected scheduler/worker. Preserve queues and idempotency; do not modify applied migration files or skip authorization.

## Recovery and rollback

Rollback application/image to known good if schema remains compatible, or deploy a reviewed forward fix. Additive database changes remain; repair them forward if necessary.

## Verification, escalation, follow-up

Core API flows, workers, heartbeats, queue drain, release/head, privacy gates, and alerts healthy for two windows. Page API/platform plus affected domain. Add canary/regression and postmortem actions.
