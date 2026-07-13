# Bad mobile release

## Symptoms and alert

Crash/ANR/startup/API-flow regression is isolated to a new mobile version/build, or compatibility failures rise during rollout.

## Immediate checks

Compare release cohorts, platforms/OS/device families, source-map/symbol availability, rollout percentage, API compatibility, and critical flows. Confirm environment/release tags are correct.

## Commands and evidence

Run production exports, mobile type/lint/tests, performance report/profile, and representative installed-build smoke tests. Preserve store rollout and issue identifiers.

## Containment

Halt staged rollout or remove the release where supported; disable only an existing safe optional feature. Keep API backward compatible and never weaken auth/cache isolation.

## Recovery and rollback

Resume prior build availability or issue an expedited fixed version with incremented build number and matching source maps. Server-side mitigations must remain scoped and reviewed.

## Verification, escalation, follow-up

Crash-free/ANR/startup recover for two windows and cold/warm/auth/cache/media/Memory/comments flows pass. Page mobile/API if compatibility related. Add regression and strengthen staged-rollout criteria.
