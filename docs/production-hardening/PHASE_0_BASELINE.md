# Production Hardening Phase 0 Baseline

Date: 2026-07-12  
Source commit: `18b608bbfe77ffd10bc31b903b00048e1e64cef1`  
Parent branch: `production-hardening`  
Phase branch: `hardening/00-baseline`

## Scope

This phase creates the production-hardening control plane. It does not change product behaviour, database schema, RLS, Storage policies, API contracts, mobile navigation, or media handling.

Canonical issue register: `docs/production-hardening/issues.json`

## Local environment

- Node: `v26.0.0`
- npm: `11.12.1`
- Next.js: `15.5.15`
- Expo CLI: `54.0.25`
- Local working tree at baseline start: clean

CI intentionally uses Node 22, matching the existing Memory hardening workflow. The local Node 26 result is recorded so version-dependent failures can be reproduced instead of being hidden.

## Baseline results before Phase 0 configuration changes

| Gate | Command | Result |
| --- | --- | --- |
| Root typecheck | `npm run typecheck` | PASS |
| Mobile typecheck | `cd mobile && npm run typecheck` | PASS |
| Root lint | `npm run lint` | FAIL: 9,935 findings; 162 errors and 9,773 warnings |
| Mobile lint | `cd mobile && npm run lint` | PASS with 43 warnings |
| Root tests | `npm test` | FAIL: 1,044 total; 998 pass and 46 fail |
| Memory hardening | `npm run test:memory-hardening` | FAIL: 72 total; 71 pass and 1 fail |
| Next production build | `npm run build` | PASS: 78 static pages; about 209 kB shared first-load JS |
| Expo Android production export | `npx expo export --platform android --output-dir /private/tmp/foodreview-phase0-expo-export --clear` | PASS: 3,970 modules; 9,318,908-byte Hermes bundle; 18 MB export |

No Supabase reset, database/RLS integration suite, native Gradle build, signed EAS build, or account-seeded E2E suite is claimed by this phase.

## Failure classification

### Generated-file lint noise

Root `eslint .` traverses the ignored Expo export at `mobile/dist`. That output is not tracked and contains minified/generated JavaScript that produces thousands of non-actionable warnings. `mobile/.expo` is also generated state.

Phase 0 excludes both paths from the root ESLint input.

### Vendored-code lint noise

`mobile/src/vendor/reactNativeChat` contains 110 tracked files imported as a vendored compatibility tree. Its files intentionally carry `@ts-nocheck`; root lint applies first-party Next/TypeScript rules and reports the majority of the 162 errors there. The existing mobile lint command already excludes this tree.

Phase 0 makes root lint match that ownership boundary. It does not remove `@ts-nocheck`, modify vendor code, or suppress rules for first-party source.

With only `mobile/dist`, `mobile/.expo`, and `mobile/src/vendor` excluded, root lint reports 94 warnings and zero errors. Those 94 first-party/test warnings remain visible.

### Brittle source-shape tests

Most failed UI, architecture, Memory performance and navigation tests read source files and assert regular-expression implementation shapes. Current behaviour may be correct while a refactor changes a function name, component arrangement, import path, or callback location. Examples include Explore parity, Profile layout, Memory warm-up and social-media architecture assertions.

These tests are not changed in Phase 0. Later bounded phases must replace relevant structural assertions with behaviour-level tests rather than updating regexes solely to turn the gate green.

### Stale route/test harnesses

- `tests/account-media-cleanup-worker.test.mjs` rejects the new `@/lib/server/media-pipeline` import before its tests execute.
- Review CRUD mock tests do not model the current media-pipeline/database call sequence, producing 24 related failures.
- One Profile layout test references a missing or superseded source contract.

These are categorized as test-harness incompatibilities, not proven product runtime defects. Each must still be adjudicated before the full test gate can pass.

### Potential runtime regressions requiring adjudication

Static failures concerning upload sequencing, camera retry, feed ownership, profile pagination and engagement routing describe important behaviour. Phase 0 cannot declare them harmless merely because the assertions are structural. Their owning implementation phases must inspect the active runtime path and add behaviour-level proof.

### Environment-dependent gaps

- Native Android compilation/signing was not part of this baseline.
- Signed iOS and Android artifacts were not produced.
- Live Supabase schema, RLS and Storage state was not checked.
- Account-dependent Playwright tests require seeded credentials and were not run.
- Load, failure-injection, backup and restore tests do not yet exist.

## Unsafe local Expo environment observation

Expo reported loading a variable named `EXPO_PUBLIC_SUPABASE_SERVICE_KEY`. Its value was not read or printed. No tracked source reference was found, and the variable name was not present in the generated export, so bundle exposure was not proven. The configuration is still unsafe: any referenced `EXPO_PUBLIC_*` value is client-visible. `PH-001` requires removal and credential rotation if the value is privileged.

## Phase 0 changes

1. Added the canonical machine-readable issue register.
2. Added a register schema/contract validator.
3. Added application-wide CI without path filters.
4. Excluded only generated Expo output and the explicitly vendored chat tree from root lint.
5. Preserved all existing failing tests and first-party warnings.

## Exit gate

- Baseline reproducible: PASS
- Failures categorized: PASS
- Canonical issue register created: PASS
- CI structure present: PASS
- No unrelated behaviour changes: PASS

Phase 0 gate: **PASS locally**. GitHub Actions execution remains to be observed on the branch/PR. Do not start Phase 1A until this handoff is reviewed.
