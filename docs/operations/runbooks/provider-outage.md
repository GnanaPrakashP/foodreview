# External provider outage

## Symptoms and alert

Expo push, Sentry, moderation, maps, or another external dependency reports timeouts/rate limits/unavailable while core infrastructure remains healthy.

## Immediate checks

Identify provider and operation, provider status/incident, credential validity, rate limits, release, safe error distribution, retry/backlog age, and whether the provider is on the success path.

## Commands and evidence

Run the relevant queue health report and synthetic provider test with nonproduction data. Preserve provider request/ticket IDs only if nonsecret and approved; never payloads/tokens.

## Containment

Use bounded backoff, stop retry storms, keep durable jobs, and degrade optional telemetry fail-open. Security/moderation providers fail closed where approval is required.

## Recovery and rollback

Restore/rotate credentials under secret control or wait for provider recovery; resume gradually and reconcile durable state. Rollback only if a release caused incompatible calls.

## Verification, escalation, follow-up

Synthetic success, retries draining, no dead-letter growth, and two healthy windows. Page owning domain/platform and provider support. Review quotas, timeouts, fallback contract, and vendor RTO.
