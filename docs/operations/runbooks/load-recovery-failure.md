# Load failure-recovery failure

## Symptoms and alert

A controlled failure cannot be restored, worker leases do not recover, queues keep growing, the API remains unhealthy past budget, rollback fails, or post-recovery reconciliation detects drift.

## Immediate checks

Confirm the chaos-controller protocol/case restore acknowledgement and every case-specific evidence field from `config/failure-injection-matrix.json`, plus the affected staging component, release, lease owner/expiry, scheduler heartbeat, database/pool state, queue oldest age and privacy probe. Ensure the target is disposable staging before any further action.

## Commands and evidence

Run `npm run load:failure -- --case=<approved-case>`, `npm run operations:health`, and `npm run load:reconcile`. Preserve controller action IDs, timestamps and safe aggregate state; do not preserve credentials or private content.

## Containment

Stop additional injections and traffic. Restore the failed dependency, disable only the affected staging trigger if necessary, and retain durable jobs for fenced recovery. Escalate immediately if authorization behavior changes.

## Recovery and rollback

Use the component runbook referenced by `config/failure-injection-matrix.json`. Prefer API/worker rollback, expire stale leases safely, restore schedulers, and use reviewed roll-forward database repair rather than destructive migration rollback.

## Verification, escalation, follow-up

Health and authenticated probes pass, queues drain, stale workers cannot complete, alerts fire/resolve, reconciliation is clean and the exact failure case passes on repeat. Escalate to platform and the component owner; block capacity proof until resolved.
