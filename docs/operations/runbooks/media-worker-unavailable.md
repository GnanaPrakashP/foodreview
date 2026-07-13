# Media worker unavailable

## Symptoms and alert

Readiness fails because the media-processing heartbeat is stale, container restarts, or supervision misses the dedicated loop.

## Immediate checks

Check startup configuration, release, container health/restarts, database connectivity, Sharp/FFmpeg/ffprobe availability, lease heartbeat, and dependency status.

## Commands and evidence

Run the startup health endpoint, normal readiness endpoint, `npm run operations:health:media`, `npm run validate:media-worker-phase2`, and worker image healthcheck.

## Containment

Stop a crash loop, leave jobs durable, and pause new upload promotion if backlog threatens limits. Do not switch to inline API processing.

## Recovery and rollback

Rollback/redeploy the known-good worker image with matching secrets/release; validate binaries, then resume bounded concurrency. Stale leases are reclaimed by the database contract.

## Verification, escalation, follow-up

Continuous fresh heartbeats, stable container, successful synthetic image/video job, and draining queue. Page media/platform, then provider owner. Capture image digest and improve startup/canary tests.
