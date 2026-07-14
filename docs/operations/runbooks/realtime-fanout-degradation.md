# Realtime fanout degradation

## Symptoms and alert

Subscriptions fail, delivery p95 exceeds 1 second at launch load, reconnect exceeds budget, events are missed/duplicated, or a non-member receives a Memory event.

## Immediate checks

Stop the fanout test immediately for any unauthorized delivery. Confirm project tier/Realtime limits, connection count, channel count, JWT/RLS state, database replication lag, network errors and recent schema/API/mobile releases.

## Commands and evidence

Run `npm run load:realtime`, `npm run load:reconcile`, and `npm run operations:health`. Retain counts and latency only; never retain message bodies, room titles, user tokens or Realtime payloads.

## Containment

For privacy failure, disable the affected staging Realtime publication/channel path and use bounded authorized API reconciliation. For capacity failure, stop new load arrivals and reduce test concurrency without changing production security policy.

## Recovery and rollback

Restore the provider/network or roll back the responsible release. Reconnect a bounded sample, reconcile through the API, and repeat member, removed-member and non-member delivery checks.

## Verification, escalation, follow-up

Subscription success, delivery/reconnect p95, zero unauthorized events, missed/duplicate rates and API reconciliation meet the checked-in SLO. Page platform immediately for privacy failures and involve Supabase support for documented tier-limit issues.
