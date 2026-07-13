# Deployment and recovery

## Pre-deploy gate

Require the full root suite, Phase 7 tests, lint/typechecks, Next production build, Android/iOS Expo exports, canonical double reset, SQL lint, pgTAP, policy runtime matrix, upgrade fixtures, drift report, and local restore drill. Confirm the deployed API, workers, mobile build, database migration head, source-map artifacts, and Sentry release all use the same release identifier.

Required production secrets include Supabase public/service credentials in their correct surfaces, worker/scheduler secrets, API HMAC material, Sentry DSNs and upload token, `APP_ENVIRONMENT=production`, `APP_RELEASE`, `EXPO_PUBLIC_APP_ENVIRONMENT=production`, and `EXPO_PUBLIC_RELEASE_ID`. No service-role or server secret may appear in a mobile bundle.

## Deployment order

1. Back up and verify a restore point.
2. Apply additive migration and run `production_schema_contract()` plus `production_operations_contract()`.
3. Deploy API with schedulers disabled; verify `/api/health` release/head.
4. Deploy worker images with the same release and validate startup/readiness.
5. Enable bounded schedules and verify every expected heartbeat.
6. Publish mobile only after server compatibility and source-map upload are confirmed.
7. Observe alerts and core flows through one full scheduler interval plus push receipt delay.

Use a compatibility window of at least one supported mobile version and one previous API/worker release. Canary the API to internal traffic first, then a small production cohort; canary one worker replica with a unique worker ID and confirm claim-token/lease fencing before increasing replicas. Scheduler changes start disabled, run once manually with a unique correlation ID, and are enabled only after the durable run and heartbeat appear. An older API or worker may be restored only when its recorded minimum/maximum migration heads include the active head; otherwise roll forward.

## Rollback

Application rollback is the preferred first response. Revert API/worker/mobile release without reversing an additive migration. Database reversal requires a separately reviewed forward repair migration; never edit or delete an applied migration. Stop only the affected scheduler/worker when queue state remains durable. For a bad mobile release, halt rollout/store release and ship a compatible fixed build; keep the API backward-compatible during adoption.

Worker rollback must stop new claims, wait for or explicitly expire leases, verify no old process retains a claim token, then start the prior compatible image under a new worker ID. Scheduler rollback disables the changed trigger before restoring its previous definition; it never deletes queued jobs or run history. A store-distributed mobile release cannot be recalled, so server compatibility and remote provider containment must remain available until adoption of a fixed build is sufficient.

## Emergency disablement

Emergency containment uses existing deployment/scheduler controls and deny-by-default route behavior; it does not bypass durable state.

- Uploads: disable upload-intent routes at the API edge while leaving status/read paths available; do not delete outstanding intents.
- Media processing: set the media worker replica count to zero and disable media-processing schedules; preserve leases/jobs and run reconciliation before restart.
- New account deletion requests: disable only the public request route; continue or deliberately pause existing deletion jobs under privacy-incident authority, never silently discard them.
- Provider-backed APIs: disable the affected route or provider integration and return the documented safe unavailable response; never fall back to an untrusted client-side credential.
- Moderation publication: disable moderation claims/publication and keep assets quarantined/fail-closed until a trusted decision path is restored.

Every disablement records incident owner, start time, affected release, correlation ID, customer impact, restoration criteria, and rollback command in the incident system. Re-enable through a single canary request/job before normal traffic.

Verification after recovery includes health/release identity, auth and cache isolation, feed/profile/Memory/comments, private media authorization, media processing, account deletion, push tickets/receipts, moderation, scheduler heartbeats, and alert resolution.

## Native release-candidate sequence

Native store releases are manual and use the protected `production-release` environment. No CI job publishes or submits automatically.

1. Assign the historical PH-001 credential to an owner and rotate/revoke it if privileged.
2. Deploy the complete canonical migrations to disposable staging, then deploy API, workers, scheduler and matching Sentry release metadata.
3. Configure staging-only recovery, OAuth, push, provider and moderation credentials; keep production credentials absent from staging builds.
4. Build Android with the production upload key and iOS with the production distribution profile. Retain signed artifacts, hashes, merged manifest/entitlements, dependency inventories, Android mapping/native symbols, iOS dSYM and Hermes maps.
5. Run the two-account physical-device matrix for auth/deep links, private media, uploads/process death, push, account lifecycle, backup/restore attempt and accessibility.
6. Execute restore and rollback/roll-forward drills, then run the separate Phase 9 load/soak/failure gate.
7. Obtain legal and store-console declaration approval, build a fresh production candidate, repeat the smoke matrix and submit manually only after every gate is signed off.

The bad-mobile-release runbook governs rollout stops. Expo Updates is disabled, so recovery is API/provider containment plus a compatible new store binary; never attempt to recall or mutate an installed binary remotely. Production mobile config validation rejects localhost/private-LAN endpoints, placeholder public values, development auto-login, privileged Supabase variable names and non-production environment/channel bindings.
