# Storage outage

## Symptoms and alert

Upload/download/signing calls fail, media and moderation queues retry, or private-media access broadly returns dependency errors.

## Immediate checks

Confirm provider status, affected bucket/surface, regional scope, credentials, API/worker release, and whether failures are read, write, signing, or delete. Distinguish outage from authorization denial.

## Commands and evidence

Run safe health/queue reports and synthetic public/private media probes. Preserve status/error codes and correlation IDs, never object paths, signed URLs, or content.

## Containment

Pause new uploads if writes are unreliable, retain durable intents/jobs, and keep private buckets private. Do not substitute public URLs or mark missing derivatives ready.

## Recovery and rollback

Restore provider/credentials, verify object consistency, then resume bounded workers. Use documented backup/version recovery for deleted objects; database restore alone is insufficient.

## Verification, escalation, follow-up

Synthetic upload/process/authorize/delete succeeds, queues drain, and private denial remains correct. Page platform/media/security as appropriate and provider support. Reconcile missing objects and update backup findings.
