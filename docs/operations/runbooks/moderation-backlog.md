# Moderation backlog

## Symptoms and alert

Pending review-media moderation exceeds 50/200, oldest pending exceeds 15/60 minutes, or safe provider failures rise.

## Immediate checks

Check moderation scheduler heartbeat, provider/configuration status, lease expiry, retry counts, queued media type, and release. Do not expose or export user media in ordinary incident channels.

## Commands and evidence

Run `npm run operations:health`, the moderation scheduled job in an isolated/staging environment, and the relevant media-security tests. Preserve aggregate counts and safe reason codes.

## Containment

Keep pending media non-public and pause new promotion if capacity is exhausted. Never auto-approve because the provider is unavailable.

## Recovery and rollback

Restore provider/configuration or rollback the moderation worker/API release; allow fenced leases and bounded retries to drain. Manually review only through an approved trust-and-safety workflow.

## Verification, escalation, follow-up

Heartbeat fresh, backlog age below warning, rejected objects removed, approved paths authorized, and no provider failures for two windows. Page trust and safety/media, then provider owner. Review capacity and false-positive/negative samples under restricted access.
