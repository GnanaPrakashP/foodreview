# Explore v3 data pipeline

Explore Places and Dishes are projections. Review rows alone are not sufficient: every active `review_dish_mentions` row must first have exactly one canonical or candidate backing, and canonical mentions must have family tokens.

## Safe rollout order

1. Deploy `202607170002_explore_v3_pipeline_integrity.sql`.
2. Identify the target explicitly as local, staging, or production.
3. Inspect existing orphan mentions with the repair command in dry-run mode.
4. Apply repair only after reviewing its counts and cursor.
5. Rebuild and reconcile projections.
6. Run the identity report and the local integration gate.

The configured hosted project must not be treated as staging or production based only on its URL. Production repair requires both confirmation flags below.

## Repair command

Dry-run the current load users (the default target):

```sh
npm run dish:repair-orphans -- --dry-run --target=load --batch-size=200 --max-batches=10
```

Resume from the reported `afterId` cursor:

```sh
npm run dish:repair-orphans -- --dry-run --target=load --after-id=<uuid>
```

Apply on an explicitly identified staging project and automatically rebuild/reconcile:

```sh
npm run dish:repair-orphans -- --apply --target=load --environment=staging --confirm=REPAIR_EXPLORE_V3_ORPHANS
```

Production requires additional explicit approval:

```sh
npm run dish:repair-orphans -- --apply --target=all --environment=production --confirm=REPAIR_EXPLORE_V3_ORPHANS --confirm-production=REPAIR_EXPLORE_V3_PRODUCTION
```

Use `--no-rebuild` only when deliberately splitting repair into several resumable runs. The final apply run must rebuild, or an operator must call `rebuild_explore_v3_projections()` with the service role.

The JSON output reports scanned, repaired, canonicalized, candidate-created, created-canonical, skipped, failed, and the last cursor. Raw dish names are preserved.

## Validation

```sh
npm run dish:identity-report -- --json
npm run db:contract
npm run validate:explore-v3-pipeline:db
```

The runtime integration gate requires a clean local Supabase instance (`npm run db:start` followed by `npm run db:reset`). It covers Masala Dosa, Idli, Pizza, generic Biryani creation, Google types, no-location/near/distant Explore calls, readiness, orphan rejection, and an idempotent rerun.

The Phase 9 seeder now resolves review items through the production server resolver, invokes the unified rebuild, and fails if reconciliation is not ready. It never writes manufactured unresolved mention rows.
