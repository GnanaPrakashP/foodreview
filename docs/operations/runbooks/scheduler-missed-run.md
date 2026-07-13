# Scheduler missed or failing run

## Symptoms and alert

One or more `next_expected_at` deadlines pass without success, consecutive failures rise, or a job has no durable heartbeat.

## Immediate checks

Identify job/owner, last start/success/failure, safe error code, configured interval/cron, API deployment, `CRON_SECRET`, overlap/lease behavior, and dependent service health.

## Commands and evidence

Run `npm run operations:health:scheduler`, compare `config/operations-schedules.json` with `vercel.json`, and invoke the protected job once only under approved staging/production operations access.

## Containment

Prevent overlapping manual triggers, pause a repeatedly failing nonessential job, and preserve durable queue state. Privacy/security-critical missed jobs require immediate domain escalation.

## Recovery and rollback

Restore trigger/secret/dependency, run one bounded idempotent catch-up, and verify the next automatic heartbeat. Rollback the scheduler/API release if it introduced failure.

## Verification, escalation, follow-up

No missed/failing jobs for two expected intervals, run history records success, and affected backlog drains. Page platform and job owner. Fix schedule-as-code drift and add trigger monitoring.
