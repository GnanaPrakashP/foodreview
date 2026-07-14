# Capacity SLO breach

## Symptoms and alert

The launch or soak workload breaches API latency/error, queue-age, pool-wait, worker-growth, mobile, or zero-correctness thresholds. A stress-tier breach is expected only when it identifies a controlled breakpoint and the system subsequently recovers.

## Immediate checks

Stop load at the configured safety threshold. Confirm the staging ID, release, migration head, workload tier, actor count and result hash. Compare API replicas, database/pool, Realtime, Storage, media/deletion/push queues, scheduler and provider metrics without inspecting private payloads.

## Commands and evidence

Run `npm run load:report`, `npm run load:reconcile`, `npm run operations:health`, and the read-only provider dashboards. Preserve `load-results` JSON, topology, release, migration head, alert timestamps and aggregate query fingerprints.

## Containment

Stop new arrivals, leave durable jobs intact, and pause only nonessential staging schedules if they amplify the incident. Never disable RLS, rate limits, moderation, signed-media authorization, or worker fencing to make a benchmark pass.

## Recovery and rollback

Allow queues to drain and verify latency, connections, worker memory and oldest-job age return below warning. Roll back the implicated API/worker release or roll forward an additive fix. Re-run the exact failed tier; do not merely raise timeouts or thresholds.

## Verification, escalation, follow-up

Reconciliation has zero unexplained drift, privacy probes pass, queues recover, and two monitoring windows are healthy. Escalate to platform plus the saturated component owner. Record the first SLO breach, bottleneck, stable throughput and scaling trigger.
