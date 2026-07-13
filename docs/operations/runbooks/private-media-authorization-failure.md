# Private media authorization failure

## Symptoms and alert

Unauthorized signed-media access succeeds, legitimate owner/circle/Memory access fails broadly, or logs show private-path authorization errors after a release.

## Immediate checks

Treat any unauthorized success as a security incident. Identify surface/access class, release, correlation ID, policy/function version, and whether exposure is current. Never paste signed URLs or storage paths into telemetry/tickets.

## Commands and evidence

Run the Phase 1A, Phase 3 policy, Phase 4 API-security, and current product-guard tests against an isolated environment. Use synthetic actors and object paths only.

## Containment

Disable the affected media-serving route or rollback the release; revoke leaked signing credentials and shorten exposure where supported. Do not make the bucket public.

## Recovery and rollback

Restore owner/visibility/member authorization, rotate credentials, invalidate links where possible, and deploy a forward policy/API fix. Preserve evidence under security access control.

## Verification, escalation, follow-up

Prove owner/member access and non-owner/non-member denial across public/circle/private/Memory cases. Page security/privacy and platform immediately; follow breach assessment/notification policy. Add adversarial regression coverage.
