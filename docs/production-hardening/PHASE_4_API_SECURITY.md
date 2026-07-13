# FoodReview Production Hardening — Phase 4

Date: 2026-07-13

Branch: `hardening/06-api-security`

Parent commit: `e8472d695229071ccbc182b621f6422425f59297`

Implementation status: PASS locally

Release verification status: BLOCKED pending hosted multi-replica limiter verification, real email delivery, real Android/iOS recovery and OAuth callbacks, paid-provider quota testing, hosted moderation/operator availability, production secret-manager/proxy configuration, and the earlier release blockers. No hosted project was mutated.

## Executive result

Phase 4 replaces FoodReview's inconsistent mobile/API trust boundaries with one server-verified actor, removes the public Auth-directory scan and account-existence response, adds an atomic PostgreSQL-backed multi-dimensional limiter, and covers every active mobile mutation with a centralized rate policy. Public feed personalization no longer accepts a viewer override. Provider, report, block, notification, push-token, media, and internal routes now have bounded work and explicit authority.

Mobile password recovery is complete locally through a real Supabase recovery email and an allowlisted `circlebites://auth/recovery` redirect. OAuth/recovery state is cryptographic, expiring, and single-use. Push tokens are bound by trigger/RLS to Auth UUID plus installation. Generic media is pending-by-default and unclaimable/unpublishable until audited service approval; review/avatar images fail closed into quarantine when moderation is unavailable. Retired caller-selected moderation bypass routes return 410.

The phase adds one additive canonical migration, expands the Phase 3 schema contract, adds pgTAP and real local Auth/API/database behavior tests, and preserves the Phase 1A–3 database/security contracts. It does not claim load/capacity readiness for 1,000 users; Phase 9 owns load validation.

## Inventory and active paths

`scripts/report-mobile-api-security.mjs` recursively inventories all API route methods and traces mobile consumers. The local result is:

```text
69 route files
93 operations
62 active-mobile operations
9 internal mobile-support operations
2 retired moderation operations
20 supporting/legacy-web operations
60 explicitly durable-rate-limited operations
78 operations classified high abuse risk
```

The active paths changed include mobile auth/account status/recovery, public/circle feeds, comments, likes, wishlist, Taste Trust feedback, post views, circle lifecycle, blocks, reports, notifications, push registration, profile username, Memory participants/notifications/media, review/avatar media, generic media, review create/update/delete, Places autocomplete/details/reverse geocode, delete account, and internal deletion/cleanup/curation/moderation routes.

The two deprecated paths are `/api/photos/moderate` and `/api/videos/moderate`; both are explicit 410 responses. Supporting web routes remain in the inventory and inherit the 1 MiB outer ceiling plus global headers. Phase 4 did not redesign their UX.

## Architecture selected

```text
mobile request
  -> bearer token + random install UUID (+ idempotency key for mutations)
  -> outer API body ceiling
  -> one memoized Supabase auth.getUser()
  -> Auth UUID -> authoritative active profile
  -> endpoint streaming/schema bounds
  -> HMAC(user/IP/install/subject)
  -> atomic PostgreSQL multi-policy limiter
  -> resource ownership/membership/block/privacy check
  -> bounded provider/service/database work
  -> safe no-store response + stable error code/correlation ID
```

Internal operations replace the actor/limiter step with a dedicated timing-safe operational secret, bounded/replay-safe input, and service-only database function grants.

## Security changes

### Actor and viewer identity

`lib/server/route-supabase.ts` is the sole route actor resolver. It distinguishes unauthenticated, invalid, unavailable, missing-profile, frozen, and active states; calls Auth exactly once per request; uses Auth UUID only; checks profile account state; and memoizes the request promise. Active route-local `auth.getUser()` and no-request `getRouteActor()` calls are absent.

The public feed discards its former `viewer` query authority. Service-role feed assembly receives only the canonical actor name or an empty anonymous viewer. Notification/report/media routes similarly derive actor/recipient/owner state on the server.

### Enumeration and recovery

The former `/api/mobile/auth/resolve-email` Auth-user pagination scan was removed. Existing and missing emails have identical 202 bodies and the route performs no account lookup. The mobile screen offers generic sign-in and an explicit create-account action.

The password-recovery API accepts only bounded normalized email and a 256-bit mobile flow nonce, constructs the redirect internally, rate-limits by IP/install/subject, hides account/provider outcomes, and returns one generic 202 response. Local Mailpit verification proved that Supabase preserves the nonce and redirects to the explicit mobile recovery path. Mobile validates scheme/host/path/mode/state, consumes state once, establishes only a recovery session, clears callback parameters, validates the new password, updates it, signs out locally, and returns to sign-in.

OAuth now uses PKCE and the same single-use state store. Unknown paths, arbitrary redirects, credentials in URLs, wrong modes, missing/replayed state, and malformed callbacks fail before session establishment. Android's custom scheme and Expo Router paths align with the allowlist; real Android/iOS provider tests remain a release gate.

### Abuse, complexity, and idempotency

Policies live in one typed table, `lib/server/mobile-api-policies.ts`. Anonymous auth helpers use strict IP/install/subject rules. Provider routes use user/install/IP and weighted cost. Social mutations, reports, blocks, circles, media, account deletion, notification generation, username changes, and high-volume post-view recording have separate realistic policies.

`consume_api_rate_limits` is service-only, replica-shared, atomic under concurrency, and fail-closed. It never stores raw IP/user/install/email. The request IP contract is disabled until a trusted proxy hop count is configured. Cleanup is bounded. Tests admitted exactly five of 20 simultaneous requests to a limit-five bucket and proved a rejected shared dimension did not partially consume another dimension.

Bodies are bounded before expensive parsing on Phase 4 high-risk paths. Query/search/provider result/batch/recipient/media/pagination values are capped. Provider and moderation requests have deadlines. Retry-prone reports and notifications use actor/endpoint/request-bound idempotency records; pending claims are abandoned on safe failures and expired records are swept. Natural database uniqueness remains the idempotency authority for toggles, relationships, tokens, and media state.

### Push and notifications

The `push_tokens` trigger derives user UUID/name from `auth.uid()`, requires an active profile and installation UUID, validates the Expo token shape, and prevents foreign ownership. RLS permits only owner actions. Token uniqueness prevents cross-account reassignment. Phase 1C logout/switch still removes the previous account's registration through the canonical cleanup flow.

Mobile cannot create arbitrary notification rows. Event and Memory notification routes derive recipients from review/circle/room membership, apply block/preferences, use idempotency and shared limits, cap recipient/token counts, and avoid caller-provided actor text. Notification reads/counts/read/delete remain recipient-scoped and errors no longer echo database internals.

### Providers, reports, blocks, moderation

Places routes require an active actor, validate bounded search/place/session/coordinate values, request reduced fields, cap outputs, time out, use server-only keys, apply cost weights, and log only provider status categories. Tests do not call paid providers.

Reports validate actor access to the target, bound reason/details, use unique/idempotent insertion, and rate-limit. Blocks remain idempotent and the earlier database policies continue applying them across content, media, relationships, interaction, notification, and Memory paths. Operator report reads/actions require a dedicated secret and actions are atomic/audited.

Migration `202607130008_mobile_api_security.sql` adds `media_assets.moderation_status` default `pending`, public read gates requiring `approved`, worker claim gates requiring approval, and service-only audited approve/reject functions. Rejection cancels queued jobs. Google Vision Safe Search is connected for the active review/avatar image finalizer; missing/unavailable/uncertain provider state stays quarantined. Generic post media requires explicit provider/operator approval before worker publication. This is deliberately safe but requires a real hosted decision path before users can publish new generic media.

### Internal authority, errors, headers, and CORS

Internal deletion, cleanup, curation, worker, and moderation routes reject missing/default production secrets, compare timing-safely, use domain-specific secret names, bound bodies/batches, and fail opaquely. Worker/moderation/limiter/audit functions and tables are unavailable to anon/authenticated roles.

The shared error contract provides stable mobile codes, safe messages, retry metadata, and server correlation IDs. Provider/SQL/Storage details, paths, signed URLs, tokens, private payloads, and stacks are not returned. Next/API responses set HSTS, nosniff, deny framing, referrer and permissions policies, restrictive API CSP/no-store, and exact-origin CORS. Native API use normally sends no Origin; wildcard CORS is absent.

## Database and grants

One forward-only canonical migration was added:

```text
supabase/migrations/202607130008_mobile_api_security.sql
```

It adds:

- `api_rate_limit_buckets` and atomic limiter/cleanup functions;
- `api_idempotency_records` and expiry index;
- push-token `user_id`/`install_id`, ownership trigger, index, and owner RLS;
- generic media moderation columns/index/read/claim enforcement;
- `media_moderation_actions` and atomic decision function;
- expanded report lifecycle, `moderation_report_actions`, and atomic action function;
- an additive wrapper around the Phase 3 `production_schema_contract()` with Phase 4 table/RLS/function/grant/definer checks.

All Phase 4 state/audit tables have RLS and no anon/authenticated table grants. Limiter, cleanup, media moderation, and report moderation functions execute only as `service_role`. The canonical manifest includes the new migration. Three clean resets (including the required two after material changes), SQL lint, 35 pgTAP assertions, real role tests, and the service contract pass locally.

## Tests and validation

Added:

```text
tests/mobile-api-security-phase4.test.mjs
tests/supabase-mobile-api-security-phase4-runtime-validation.mjs
tests/mobile-api-security-phase4-api-runtime-validation.mjs
supabase/tests/0002_mobile_api_security.sql
```

Behavior proof includes generic enumeration, real local recovery mail redirect, missing/malformed/active/frozen actor states, anonymous burst/retry-after, concurrent database limits, multi-dimension atomicity, hashed state, cleanup, push owner/reassignment/freeze, media quarantine/approval/audit, report action audit, request size, CORS/headers, provider pre-auth, and internal secret behavior.

Final local evidence:

- Phase 4 static security tests pass 10/10; the database runtime passes 9/9 behavior groups; the HTTP runtime passes 10/10 groups.
- The inventory passes for 69 route files and 93 operations. The clean runtime report has zero expired limiter/idempotency backlog, zero limiter rows, zero pending media/open reports, and zero privileged-client grant drift.
- The canonical manifest validates 65 migrations/83 entries/two preserved conflicts; pgTAP passes 35/35; upgrade paths pass 7/7; real Phase 3 policies pass 10/10; read-only drift is zero. SQL lint has only the same three pre-existing unused-variable warnings in `shared_memory_chat_page`.
- Phase 1A runtime passes 13/13; Phase 1B lifecycle passes 9/9; Phase 1C cache isolation passes 8/8; Phase 2 unit/database/real-processing gates pass 11/11, 14/14, and 10/10.
- Root and mobile TypeScript pass. Root lint has 92 warnings/zero errors and mobile lint has 42 warnings/zero errors; Phase 3 recorded 94 root warnings. The Next production build, Android/iOS production exports, Android Gradle release build, and exported/native artifact secret scans pass. No checked-in native iOS project exists, so no Phase 4 native iOS build was run.
- The full root suite is 1,077/1,097 with exactly the same 20 PH-002 failure names as the independently rerun Phase 3 baseline of 1,067/1,087. The ten added Phase 4 tests are the only count change. Memory remains 71/72 with the same PH-002 `InteractionManager` source assertion.

The known PH-002 baseline failures are not changed or hidden. No hosted system or paid provider was exercised.

## Staging matrix

Run in disposable staging with at least two API replicas:

| Scenario | Required evidence |
| --- | --- |
| Existing/missing email | Same status/body and materially similar latency; no Auth directory scan |
| Recovery Android/iOS | Email opens correct installed app after process death, sets password once, clears callback, replay/expiry fails |
| OAuth Android/iOS | Correct provider callback works; wrong state/mode/path/replay/open redirect fails; account switch clears prior data |
| Anonymous/authenticated bursts | 429 and Retry-After at documented threshold; normal flows remain usable |
| Two-replica burst | Shared exact budget proves PostgreSQL limiter consistency |
| Provider burst | Weighted budget bounds paid calls; sanitized 429/5xx behavior |
| Comment/reaction/report spam | Actor separation, idempotency, body/rate bounds |
| Notification spam | Derived recipients, duplicates suppressed, blocks/preferences honored |
| Viewer isolation | Anonymous/Bob cannot request Alice's bookmark/reaction state |
| Frozen/deleting account | Reads/status behave as documented; writes/token/provider actions denied |
| Moderation | Approved publishes; rejected cancels; uncertain/unavailable stays private; duplicate action audited once |
| Internal routes | Missing/wrong/default secret opaque; correct domain secret bounded/idempotent |

Start with the committed thresholds. Measure legitimate p95 burst patterns, 429 percentage, provider spend, and moderation/report queue age. Raise only the affected policy, preserve cost ratios and multiple dimensions, and document the evidence.

## Deployment, rollback, and roll-forward

1. Resolve PH-001 credential ownership/rotation and inject unique production secrets through the secret manager.
2. Configure exact trusted proxy hops and exact required browser origins; native traffic needs no wildcard origin.
3. Add Supabase mobile callback/recovery patterns and verify Android/iOS scheme configuration.
4. Apply the additive migration to disposable staging after Phase 3 history/drift review.
5. Deploy API/mobile builds, but keep media publication behind the operator/provider gate.
6. Schedule bounded API-security cleanup and moderation/report queue handling.
7. Execute the staging matrix, then repeat reviewed migration/deployment steps for production.

Rollback is roll-forward. Do not remove recorded migration history, drop moderation quarantine, expose limiter/audit tables, make media public, weaken RLS, or restore account enumeration. If the API deployment must be rolled back, retain the database restrictions and deploy a compatible corrective API. If limiter configuration is wrong, change centralized thresholds after evidence; do not bypass the shared limiter. If moderation is unavailable, keep media pending.

## Unverified items and remaining risks

- Hosted schema/history, multi-replica atomicity, retention scheduling, and secret-manager values were not inspected.
- Real email provider delivery, Android/iOS process-death recovery, and real OAuth callbacks were not executed.
- Paid Places/Vision quota behavior and provider restrictions were not exercised.
- Generic media publication remains intentionally blocked without hosted moderation/operator approval.
- PH-001 possible historical public service credential ownership/rotation remains blocked.
- Signed real-device release testing and production observability/capacity remain later-phase/release gates.
- Process-local provider error de-duplication is not a security control and does not replace Phase 7 telemetry.
- This phase does not prove capacity for 1,000 registered or concurrent users; no load test was authorized.

## Phase gate

```text
PASS locally
```
