# Table Memory Room blocker-fix implementation

Date: 2026-08-03
Scope: targeted continuation of the two-device acceptance audit
Verdict: `NO-GO` pending hosted deployment, Firebase validation build and two connected phones

## Outcome

The previously identified video, offline-text, non-chat unread and activity-notification blockers now have targeted source fixes. The unread and notification-outbox database migrations are deployed to the linked hosted project. Focused automated checks pass, but the corrected user flows are not marked PASS because Phone B disconnected before physical retesting and the two required environment-owned deployment inputs are unavailable.

## Implemented changes

- Video preview uses the same local poster helper as Share a dining experience. The Table Memory optimistic item keeps the local source/poster, aspect metadata, stable slot and staged Preparing/Uploading/Processing UI until canonical reconciliation.
- Client and worker telemetry now records privacy-safe preparation, intent, transfer/throughput, acknowledgement, download, moderation, probe, transcode, poster, derivative-upload and finalization durations.
- The worker no longer misclassifies a missing audit HMAC as a moderation-provider outage. Readiness fails with a specific hashing-configuration error. `render.yaml` declares `API_RATE_LIMIT_HMAC_SECRET` as an environment-owned secret without storing a value.
- Offline text is persisted immediately as `waiting_for_connection`, automatically replayed in sequence on reconnect with bounded backoff and the original idempotency identity, and cannot be cancelled after server acknowledgement. Compose time remains metadata; acknowledged display/order uses server commit time.
- Migration `202608030001_table_memory_activity_unread.sql` adds monotonic chat/media/dish read positions, per-surface server-authoritative unread counts and supporting indexes. The UI exposes per-tab badges and opening a surface acknowledges only that surface.
- Migration `202608030002_table_memory_notification_outbox.sql` atomically creates deduplicated recipient notifications for chat/media/dish activity and durable push jobs for chat. Sender, nonmember, blocked and push-disabled recipients are excluded. Client fire-and-forget notification calls were removed; the legacy route is a compatibility no-op.
- Foreground notification presentation is suppressed while the recipient is viewing the exact active room Chat surface.
- Android Firebase configuration is accepted only from an environment-owned file path. Validation profiles fail closed when push registration is required but configuration is absent. Token refresh replaces stale installation tokens safely.

## Verification

| Check | Result |
| --- | --- |
| Focused blocker/durable-replica/rapid-send/media-latency/push-worker tests | PASS, 47/47 |
| Mobile TypeScript check | PASS |
| Root TypeScript check | PASS |
| Migration manifest | PASS, 95 canonical / 113 historical / 2 documented conflicts |
| Hosted migration ledger | PASS; `202608030001` and `202608030002` match local |
| Phone A latest-bundle launch, authenticated restore, room list/detail | PASS as a single-phone smoke only |
| Corrected two-phone video/offline/unread/notification matrix | BLOCKED; Phone B disconnected |
| Hosted video worker deployment/retest | BLOCKED; HMAC secret and deploy access unavailable |
| Firebase-provisioned Android build/push retest | BLOCKED; environment-owned Firebase file unavailable |

The A-only network-off attempt is not acceptance evidence. ADB reverse still exposed the local API path, so the acknowledged synthetic message did not prove automatic queue/reconnect behavior.

## Security and privacy

No authentication, membership, RLS or private Storage policy was weakened. The migrations are member-scoped and monotonic, notification creation is recipient-bound and transactionally deduplicated, secrets remain environment-owned, and timing/error telemetry excludes message bodies, identities, storage paths, signed URLs, credentials and push tokens.

## Required physical closure

1. Reconnect authenticated Phone B.
2. Configure and deploy the hosted worker HMAC secret/change; upload one representative video from each phone and record all stages through canonical Chat/Media convergence.
3. Install a Firebase-provisioned validation build on both phones and prove exact-chat suppression plus other-tab, elsewhere, background, terminated, denied-permission, dedup and cold-tap behavior.
4. Prove automatic offline text replay without Retry, server-commit timestamp/order, per-tab media/dish unread clearing, restart/reconnect durability and no manual refresh on both phones.

Until those physical cases pass, the final verdict remains `NO-GO`.
