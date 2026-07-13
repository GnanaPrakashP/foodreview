# API 5xx or latency spike

## Symptoms and alert

API 5xx exceeds 1%/3%, p95 exceeds 800/1500ms, p99 exceeds 1500/3000ms, or mobile reports clustered request timeouts.

## Immediate checks

Group by bounded endpoint, status category, release, environment, safe error code, duration, and correlation ID. Check database saturation, Supabase/provider status, scheduler bursts, and the last deployment.

## Commands and evidence

Run `npm run operations:health`, `npm run operations:release`, and the relevant focused test/report. Preserve request IDs and aggregate rates; never copy authorization or response bodies.

## Containment

Pause deployment, reduce only optional scheduled load, and rate-limit abusive paths using existing policies. Keep required authorization and idempotency enabled.

## Recovery and rollback

Rollback the API release or deploy a reviewed forward fix. For database plan regression, use a forward index/query repair and re-run EXPLAIN gates.

## Verification, escalation, follow-up

Require health checks, representative authenticated flows, error-rate and p95/p99 recovery for two windows. Page API on-call, then database/platform or provider owner. Add a reproduction and capacity/postmortem action.
