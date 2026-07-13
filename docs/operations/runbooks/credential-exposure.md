# Credential exposure

## Symptoms and alert

A secret, service-role key, Sentry token/DSN, worker secret, JWT, signed URL, push token, or private key appears in logs, bundles, source, tickets, or unauthorized access.

## Immediate checks

Treat as a security incident. Identify credential type, environment, exposure location/time/audience, access logs, affected systems, and whether it was used. Restrict evidence; do not copy the secret again.

## Commands and evidence

Use secret-scanning/bundle scans and provider audit logs under approved access. Preserve hashes, timestamps, commit/build IDs, and audit-event IDs—not secret values.

## Containment

Revoke/rotate immediately in dependency order, disable compromised sessions/tokens, remove public artifacts, and restrict access. Service-role material must never be shipped to mobile.

## Recovery and rollback

Redeploy every consumer with new credentials, invalidate old signed/session tokens where supported, verify least privilege, and purge exposed telemetry/artifacts per provider procedure.

## Verification, escalation, follow-up

Old credential rejected, new consumers healthy, scans clean, audit logs reviewed, and privacy/security assessment complete. Page security/privacy/platform immediately and follow legal notification policy. Add detection and root-cause prevention.
