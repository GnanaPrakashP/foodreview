# Account deletion stuck or ambiguous

## Symptoms and alert

Failed deletion jobs, oldest pending over 30/120 minutes, frozen accounts without progress, or any unresolved ambiguity.

## Immediate checks

Treat ambiguity as privacy-critical. Inspect aggregate lifecycle status, worker heartbeat, safe failure codes, media-cleanup state, auth deletion state, retry time, and release. Do not reactivate a frozen account.

## Commands and evidence

Run `npm run operations:health:deletion`, `npm run account:deletion-report`, and Phase 1B runtime validation using authorized synthetic data. Preserve job ID only in restricted operations records.

## Containment

Keep the account frozen and suppress its content. Pause only the faulty stage while preserving deletion intent and audit state. Escalate ambiguity immediately.

## Recovery and rollback

Restore worker/dependency, use the idempotent deletion/reconciliation path, and resolve ambiguity with documented evidence. Never manually delete a subset without the canonical workflow.

## Verification, escalation, follow-up

Job complete, auth/profile/content/media cleanup contract satisfied, no ambiguity, and local cache cleanup confirmed. Page privacy/security plus platform. Record completion time and strengthen reconciliation tests.
