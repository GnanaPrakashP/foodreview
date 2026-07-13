# Push delivery failure

## Symptoms and alert

Push oldest queued age exceeds 15/60 minutes, dead letters grow, receipts stall, invalid-token rate spikes, or Expo errors rise.

## Immediate checks

Inspect send/receipt backlog, oldest age, dead/permanent counts, scheduler heartbeats, safe provider error distribution, credentials, and release. Never log or copy Expo tokens or notification bodies.

## Commands and evidence

Run `npm run operations:health:push` and `npm run push:reconcile` first. Apply `npm run push:reconcile:apply` only after confirming stale leases and incident approval.

## Containment

Keep notifications durable, pause excessive producers if the backlog threatens limits, and let invalid tokens disable automatically. Do not replay delivered tickets or bypass dedupe keys.

## Recovery and rollback

Restore credentials/provider/scheduler, requeue stale leases through the fenced reconciliation RPC, and allow bounded retry/dead-letter policy. Rollback a bad producer or worker release.

## Verification, escalation, follow-up

Send ticket persisted, delayed receipt delivered, duplicate safe, invalid device disabled, queue age healthy for two windows. Page push/platform, then provider owner. Review retry/dedupe capacity and add provider fixtures.
