# Migration or schema-contract failure

## Symptoms and alert

Deployment migration fails, head differs from `202607130010`, canonical contract reports drift, or invalid indexes/unvalidated constraints are nonzero.

## Immediate checks

Freeze deploys and workers that depend on the new schema. Capture migration version, SQLSTATE, environment, release, contract arrays, and whether the migration was partially recorded.

## Commands and evidence

Run `npm run db:manifest`, `npm run db:lint`, `npm run db:test:upgrades`, and the read-only production contracts. Use a restored copy for diagnosis when production changes are unsafe.

## Containment

Keep the prior compatible application release active. Do not edit/delete an applied migration, manually mark history complete, or disable security policies.

## Recovery and rollback

Create a reviewed additive forward repair migration. Application rollback is allowed if the additive schema remains compatible. Restore only when forward repair cannot preserve integrity and incident command approves.

## Verification, escalation, follow-up

Two clean resets, SQL lint, pgTAP/policy matrix, drift/upgrade tests, and production contract empty arrays. Page platform/database and security for grant/RLS drift. Document fixture and preflight improvements.
