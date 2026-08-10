# Witoh Production Hardening — Phase 3

Date: 2026-07-13

Branch: `hardening/05-migrations`

Parent commit: `0cb005ed28bd65f4dae3108ce55235bc1e792844`

Implementation status: PASS locally

Release verification status: BLOCKED pending hosted migration-history/schema inspection, hosted Storage-policy verification, disposable-staging upgrade execution, and production backup/PITR confirmation. No hosted project was mutated.

## Result

Witoh now has one executable Supabase history: `supabase/migrations`. The former mobile project configuration is removed, its unique migrations are represented once in the canonical chronology, duplicate/conflicting evidence is locked, and CI rejects any return to a second migration authority.

The pre-merge inventory was 29 root files and 49 mobile files: 16 byte-identical versions, 11 root-only versions, 31 mobile-only versions, and two same-version/different-byte conflicts. Both conflicts were comment-only differences with executable-SQL equivalence. Root was selected using backend ownership, the root CLI configuration, dependency completeness, prior reset evidence, and Phase 1A–2 ownership. No pre-Phase-3 migration was edited or renumbered.

The merged chronology itself reset cleanly. Real policy and prior-phase runtime testing nevertheless exposed three latent final-state bugs: anonymous users could not read otherwise eligible public reviews because a restrictive deletion policy queried an RLS-hidden profile row; promoted mobile-era tables had RLS policies but were missing necessary API table grants; and an older Profile path guard did not recognize Phase 1A's same-owner private derivative shape. New additive migrations correct those defects without weakening private-content, cross-owner, account-freeze, Memory, Storage, or worker boundaries.

## Canonical architecture and legacy disposition

- Executable history: `supabase/migrations`.
- CLI configuration: `supabase/config.toml` from the repository root.
- Retired mobile sentinel: `mobile/supabase/README.md`; no config or executable SQL exists below it.
- Locked machine inventory: `docs/database/migration-history-manifest.json`.
- Non-executable conflict evidence: `docs/database/legacy-mobile-migrations`.
- Human operations/reconciliation guide: `docs/database/MIGRATIONS.md`.

The 31 mobile-only versions were promoted mechanically at their original globally unique versions. Sixteen identical mobile copies and the two conflicting mobile variants were retired from CLI discovery. The full 78-file pre-Phase-3 historical mapping plus the four additive Phase 3 migrations (82 tracked file entries), SHA-256 values, object categories, and canonical disposition remain in the manifest.

## Database contract and corrective migrations

`202607130004_canonical_schema_contract.sql` exposes a read-only service-role contract for migration names/versions, 27 critical tables, critical-table RLS, private buckets, worker functions and client grants, required client/service table grants, safe `SECURITY DEFINER` configuration, valid indexes, and validated constraints. Public, anonymous, and authenticated execution is revoked.

`202607130005_canonical_policy_reconciliation.sql` uses a narrowly scoped safe helper for owner-account state, allowing anonymous eligible public review reads while preserving deletion suppression and avoiding anonymous profile discovery.

`202607130006_canonical_role_grants.sql` grants only commands backed by existing RLS policies. Authenticated clients still cannot insert/update Memory photo rows, mutate upload intents, invoke media/deletion worker functions, or inspect service job tables.

`202607130007_canonical_review_media_path_reconciliation.sql` closes a merged-history compatibility gap between the older Profile review-path guard and Phase 1A private derivatives. It recognizes only `private-posts/<same-owner>/...`, preserving cross-owner rejection while allowing backfill and deletion inventory.

## Committed proof

- pgTAP contract under `supabase/tests` has an explicit 21-assertion plan covering critical tables/columns/defaults, PK/FK/unique constraints, indexes, triggers, RLS, Storage buckets/policies, exact function signatures/grants, safe definer paths, and same-owner private-media path recognition. A zero-test success is impossible.
- `tests/supabase-phase3-policy-validation.mjs` uses real local Auth, PostgREST, and Storage actors for public/circle/private review visibility, forged ownership, engagement ownership, Circle/block revocation, notifications/tokens, Memory membership and writes, real private Storage object access, worker denial, deletion freeze, and job secrecy.
- `scripts/validate-database-upgrades.mjs` migrates five supported historical checkpoints with preserved data and reruns the real policy/Storage matrix. It classifies the incomplete mobile-only chain as manual-remediation-required.
- `scripts/database-drift-report.mjs` validates the locked manifest and compares an explicit local/hosted project through the service-only read-only contract without printing secrets.
- `.github/workflows/application-ci.yml` starts Supabase CLI 2.109.1, validates the manifest, resets twice, lints SQL, runs pgTAP and real policy/Storage tests, runs upgrade fixtures, and audits local drift independently of brittle source-shape tests.

## Commands

```sh
npm run db:start
npm run db:reset
npm run db:lint
npm run db:test
npm run db:test:upgrades
npm run db:drift-report
npm run db:verify
```

## Local validation evidence

The final local gate ran with Supabase CLI 2.109.1, PostgreSQL 17, and the project runtime on Node 20 where applicable:

- Locked-history validation: 64 canonical migrations, 82 tracked historical file entries, and both preserved conflicts verified.
- Supported upgrade matrix: 7/7, comprising the two history/conflict classifications and five data-preserving historical checkpoints.
- Clean creation: two consecutive full resets from zero passed through `202607130007`.
- SQL lint: passed with only the three existing unused-variable warnings in `shared_memory_chat_page`.
- pgTAP contract: 21/21 assertions in one discovered test file.
- Real Auth/PostgREST/Storage policy matrix: 10/10.
- Read-only local drift report: no missing, extra, or divergent migration versions and no critical policy/schema drift.
- Phase 1A runtime: 13/13, including all six visibility transitions and exact expiry of a route-issued 300-second signed URL.
- Phase 1B runtime: 9/9. Phase 1C account-isolation behavior: 8/8.
- Phase 2 retained gates: 11/11 static, 14/14 leasing/fencing/runtime, and 10/10 processing/Storage/cleanup.
- Profile retained gates, updated for Phase 1A/1B ownership: 6/6 historical/production scenarios and 17/17 focused runtime checks.
- Root/mobile typecheck passed; root and mobile lint passed with zero errors (94 and 43 existing warnings respectively); Next production build passed; Android and iOS Expo production exports passed; generated mobile bundles contained none of the forbidden privileged/development identifiers scanned by the gate.
- Full root suite: 1,067/1,087. Phase 3 adds six passing tests and leaves the same 20 registered PH-002 source-shape/product-contract failures. Memory hardening remains 71/72 with its same PH-002 `InteractionManager` source-regex failure.

These results prove the local repository and disposable local-database implementation. They do not prove hosted migration history, hosted Storage/CDN behavior, real infrastructure interruption recovery, production capacity, or readiness for 1,000 concurrent/active users; those remain release/load gates in later phases.

## Release gate

Local implementation passing does not prove hosted upgrade safety. Before release, operators must confirm backup/PITR, export and reconcile hosted migration history, run explicit hosted drift audit, apply pending migrations to disposable production-like staging, rerun the complete database/Phase 1A–2 matrix, verify representative existing data and Storage objects, inspect locks/runtime, and retain sanitized evidence. Roll forward with a new migration; never edit applied history.

Phase 4 is not authorized by this phase and has not started.
