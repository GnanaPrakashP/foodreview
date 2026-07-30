# Backup and restore

## Objectives

Production target: database RPO no more than 15 minutes when provider point-in-time recovery is enabled; RTO no more than four hours for a regional database restore and application cutover. Required database retention is at least seven rolling days of PITR coverage plus 30 days of daily recovery points or controlled exports. If the selected Supabase plan cannot meet both requirements, launch is blocked until the deployment owner documents and tests an equivalent protected backup path. Configuration and runbook repository target: RPO 24 hours, RTO four hours, with quarterly drill evidence retained for one year. Media Storage recovery depends on the enabled provider object-versioning/backup plan; database PITR alone does not restore deleted Storage objects.

Before launch, enable Supabase database backups/PITR appropriate to the paid production plan, restrict restore authority, document the project ID and effective backup retention in the secret manager/operations system, enable Storage recovery/versioning if available, and keep original user uploads quarantined only for their bounded processing lifetime. Export and protect scheduler definitions, worker image digests, alert configuration, environment-variable names and secret-manager metadata at least daily. Never place secret values in the repository backup.

Database backup coverage includes schemas, migration history, durable job/receipt state, scheduler history, and application rows present at the recovery point. It does not include Supabase Storage object bytes, external provider state, Sentry events, Expo receipts that were never persisted, secret-manager values, deployed worker images, DNS, or store-distributed mobile binaries. Each of those needs its own provider retention or immutable configuration record.

## Restore drill

`npm run backup:restore-drill:local` performs a real custom-format `pg_dump`, restores it into a randomly named temporary PostgreSQL database inside the running local Supabase database container, verifies migration head `202607290001`, runs canonical schema and operations missing-table/RLS checks, verifies the Phase 1A–5 critical domains, then drops the temporary database and dump. It never points at production and requires the explicit `PHASE7_LOCAL_RESTORE_DRILL` confirmation token.

Hosted staging drills are quarterly and must restore to a newly created isolated project with separate secrets, DNS, schedules, and Storage. Disable outbound push/email and all production webhooks before connecting the restored database. Record backup timestamp, start/end time, achieved RPO/RTO, migration head, contract output, row-count reconciliation by major domain, Storage sample verification, application smoke results, and cleanup confirmation. Run Phase 1A private-media authorization, Phase 1B deletion-state, Phase 1C account-isolation, Phase 2 worker fencing, Phase 3 policy/contract, Phase 4 API security, and Phase 5 bounded-query checks. Never overwrite or attach workers to the active production project during a drill.

## Production recovery sequence

1. Freeze deployments and mutating workers if continuing writes would worsen loss.
2. Select the last known-good recovery point using incident and release timestamps.
3. Restore to an isolated target and run canonical contracts, policy tests, invalid-index/unvalidated-constraint checks, queue reconciliation dry runs, and private-media authorization probes.
4. Verify representative public, circle/private, Memory, deletion, media, push, and moderation records without exporting private content.
5. Rotate application endpoints/secrets to the recovered target under change control.
6. Resume schedulers and workers gradually; watch queue age, failures, connections, 5xx, and privacy alerts.
7. Preserve the old project read-only until reconciliation and legal retention decisions are complete.

If Storage recovery is unavailable, do not republish missing private media or invent object paths. Mark affected assets unavailable, use durable database ownership/status as authority, notify affected users as required, and follow the storage-outage runbook.
