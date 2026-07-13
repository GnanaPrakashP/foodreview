# Database saturation

## Symptoms and alert

Connections exceed 70%/85%, waiters exceed 5/20, latency rises, or health queries cannot acquire capacity.

## Immediate checks

Inspect connection utilization, wait event categories, long transactions, slow-query samples, scheduler concurrency, queue claims, and the release that changed traffic. Do not terminate sessions until ownership and transaction impact are known.

## Commands and evidence

Run `npm run operations:health` and approved read-only PostgreSQL activity/EXPLAIN queries from the database dashboard. Preserve query fingerprints, not bind values or content.

## Containment

Pause nonessential bounded jobs, lower worker concurrency, and stop a runaway deployment. Maintain deletion/security-critical work unless it is the proven cause.

## Recovery and rollback

Rollback offending code, repair indexes/queries forward, or scale the provider tier under change control. Never disable RLS or widen grants for performance.

## Verification, escalation, follow-up

Connections below warning, no persistent waiters, normal API latency, and queues draining for two windows. Page platform/database on-call and privacy owner if deletion is delayed. Record peak capacity and revise load tests/budgets.
