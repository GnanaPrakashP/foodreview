# FoodReview mobile API security contract

Date: 2026-07-13

Scope: Expo Android/iOS, mobile-facing Next APIs, Supabase Auth/PostgreSQL/Storage, provider proxies, notification paths, moderation, and internal worker/operator routes.

## Trust model

The Supabase Auth user returned by one server-side `auth.getUser()` call is the only request identity. `lib/server/route-supabase.ts` memoizes that resolution per `NextRequest`, loads the profile by Auth UUID through the service client, and returns an actor only for an active, non-deleting profile. Username, email, viewer, actor, owner, recipient, device, and install values supplied by mobile never establish authority.

Install identity supplements rate limiting and push ownership only. It is a random v4 UUID stored in Expo SecureStore, contains no user data, survives account switches, and is never accepted as authentication. Rate-limit storage uses a keyed HMAC of user/IP/install/subject identifiers; raw identifiers are not retained in limiter rows.

Service-role access is a database capability, not viewer authorization. A route must establish actor ownership, membership, visibility, block state, or recipient derivation before a privileged read/write.

## Inventory

Run:

```sh
npm run validate:mobile-api-security
npm run report:mobile-api-security
```

The committed read-only inventory traces every `app/api/**/route.ts` method to mobile consumers and reports authentication, authorization, service-role use, body bounds, provider cost, idempotency, rate policy, sensitive response, logging, and abuse risk. Current totals are 69 route files and 93 operations: 62 active-mobile, nine internal support, two retired moderation bypasses, and 20 supporting/legacy-web operations. Sixty operations have explicit durable limits. All active mobile mutations have an endpoint rate policy; remaining unmetered methods are reads, preflights, retired routes, or explicit internal-authority operations.

The JSON report is designed for review and CI. It contains paths and policy classifications, never tokens, email addresses, raw IP addresses, private content, signed URLs, or secret values.

## Durable rate limiting

`consume_api_rate_limits(jsonb)` evaluates one to eight dimensions in PostgreSQL. It obtains deterministic transaction advisory locks, creates the current fixed-window rows, checks every dimension, and only then consumes any dimension. This is atomic under concurrency and shared by all API replicas. A rejected multi-dimensional request cannot partially consume another bucket.

The server derives trusted IP only when `API_TRUSTED_PROXY_HOPS` is explicitly configured for the deployment. It selects the address at that trusted distance from the right side of `X-Forwarded-For`; otherwise the dimension becomes `unavailable`. Arbitrary client forwarding headers are therefore not treated as the remote IP. User identity comes from the canonical actor. Install IDs must be UUIDs. Email subjects are normalized and HMACed.

The limiter fails closed when its secret, service client, RPC, or datastore is unavailable. `429` responses include a stable `rate_limited` code, `Retry-After`, remaining budget, and a correlation ID. Expired bucket and idempotency rows are removed by bounded service-only `cleanup_api_security_state(limit)` execution. Schedule that function; do not expose it as a mobile RPC.

Initial policies are centralized in `lib/server/mobile-api-policies.ts`:

| Category | Initial policy |
| --- | --- |
| Resolve email | IP 8/5 min; install 12/5 min; normalized subject 4/15 min |
| Password recovery | IP 5/15 min; install 5/15 min; subject 3/hour |
| Places autocomplete | user 30/min; install 40/min; IP 80/min; cost 1 |
| Place details | user budget 30/min; install 40/min; IP 80/min; cost 2 |
| Reverse geocode | user 20/min; install 30/min; IP 60/min |
| Ordinary social mutations | user 60/min; install 90/min; IP 180/min |
| High-volume view activity | user 240/min; install 300/min; IP 600/min |
| Reports | user 8/hour; install 12/hour; IP 30/hour |
| Blocks/circle operations | user 20/hour; install 30/hour; IP 60/hour |
| Memory notifications | user 12/min; install 18/min; IP 50/min |
| Other notification generation | user 20/min; install 30/min; IP 80/min |
| Media intents/finalisation | user 12/15 min; install 18/15 min; IP 50/15 min |
| Media access | user 120/min; install 180/min; IP 300/min |
| Username changes | user 8/hour; install 12/hour; IP 30/hour |
| Account deletion | user/install 3/day; IP 10/day |

These are safe starting thresholds, not performance claims. Adjust only from staging evidence. Keep provider cost weights and actor/install/IP separation intact.

## Request and response contract

API middleware rejects declared bodies above 1 MiB before route work. Active high-risk routes use streaming `readBoundedJson()` limits from 1 KiB to 64 KiB before JSON parsing. Handlers additionally bound email/search/place IDs, coordinates, session tokens, usernames, comments, report details, arrays, media counts, notification recipients, batches, provider result counts, pagination limits, and cursors. Provider calls have five-second deadlines; moderation has an eight-second deadline; push batches are capped at 100.

Phase 4 responses use a shared safe error shape where adopted:

```json
{
  "code": "rate_limited",
  "correlationId": "server-generated UUID",
  "error": "safe product message"
}
```

Codes distinguish authentication, invalid input, request size, rate limiting, in-progress replay, temporary failure, and permanent denial. The mobile client exposes status, retry-after, code, and correlation ID through `MobileApiError`. Public responses do not return SQL/provider/Storage internals, object paths, tokens, or stack traces. Provider logs contain only a bounded provider category and HTTP status.

## Authentication and account enumeration

`/api/mobile/auth/resolve-email` never queries Auth or application tables and always returns the same `202 {"ok":true}` response after a small fixed response floor. Password recovery also always returns a generic 202 response for valid, invalid, existing, and non-existing accounts. Both are size-bounded and limited by hashed IP/install/subject.

The mobile login flow no longer asks the server whether the account exists. Sign-in is generic and account creation is an explicit user choice. Signup and recovery errors must not be changed to reveal provider or account state.

## Password recovery, OAuth, and deep links

Allowed production callbacks are only:

```text
circlebites://auth/callback
circlebites://auth/recovery
```

Supabase must allow the query-bearing forms using explicit `circlebites://auth/callback**` and `circlebites://auth/recovery**` patterns. The server constructs the recovery destination; it does not accept a client redirect. Mobile creates a cryptographic 256-bit flow nonce in SecureStore with a 30-minute expiry. Callback mode, scheme, host, path, credentials, redirect parameters, state/nonce, and recovery type are validated before establishing a session. The nonce is consumed once, so duplicate/replayed callbacks fail. OAuth uses PKCE code exchange. Recovery accepts a PKCE code, recovery token hash, or Supabase's mode-tagged implicit recovery session, but never an implicit normal-login session. Navigation immediately replaces the token-bearing callback URL with `/auth/recovery`.

After validation, the user sets an 8–128 character password. The app updates the Supabase user, signs out locally, clears recovery state, and returns to sign-in. Expired, malformed, wrong-mode, missing-state, or replayed callbacks receive one generic invalid/expired message.

## Viewer privacy and mutations

`/api/feed/public` ignores caller viewer parameters. Anonymous responses contain no caller-specific like/bookmark relationship state. Authenticated personalization uses only `actor.actorName`. Notifications, reports, comments, reactions, bookmarks, circle operations, blocks, profile updates, Memory participants/media, and media intent/finalisation resolve the canonical actor and recheck resource ownership or membership before privileged work.

Retry-prone reports and notification generation require 16–128 character idempotency keys bound to the endpoint, authenticated actor, and request hash. Completed responses can be replayed safely; a mismatched or concurrently active key returns 409. Failed operations abandon their pending claim; expired records are cleaned after 24 hours. Existing unique constraints provide natural idempotency for likes, bookmarks, blocks, relationships, push tokens, media intent/finalisation, and report uniqueness.

## Push and notification security

The mobile app registers only its own token and sends its installation UUID. A database trigger overwrites `user_id` and `user_name` from `auth.uid()` plus the active profile, validates Expo token format, and rejects missing installs or frozen accounts. Owner RLS controls reads, updates, and deletes. The global token uniqueness constraint prevents silent reassignment to another account.

Mobile cannot insert arbitrary notification rows. Event routes derive actor and recipients from the authoritative review/circle/Memory state, enforce block and preference rules, cap recipients, use generic Memory text, require idempotency, and rate-limit generation. Notification list/count/read/delete actions are owner-scoped.

## Providers, reports, blocking, and moderation

Google Places routes require an active actor, validate bounded inputs, use server-only keys and reduced field masks, cap results, apply cost-weighted shared limits, time out, and convert provider 429/5xx failures to safe responses. Paid provider calls are not made by committed tests.

Reports derive `reporter_id/name` from the actor, validate target access, bound reason/details, apply uniqueness plus required idempotency, and limit spam. Blocks are actor-owned, idempotent, and feed/media/interaction/circle/notification/Memory checks continue to enforce the existing Phase 1A–3 block contracts. Operator report reads/actions require a dedicated timing-safe `MODERATION_OPERATOR_SECRET`. Actions are atomic and append-only audited.

Generic media now defaults to `moderation_status=pending`. Pending assets are private, cannot satisfy public RLS, and cannot be claimed by the media worker. Only the service-only audited action RPC can approve/reject. Rejection cancels queued work; approval permits the existing Phase 2 worker. The review/avatar image path calls Google Vision Safe Search when configured and remains quarantined on missing provider, timeout, malformed result, or provider failure. The old caller-selected photo/video moderation routes return 410. A hosted moderation provider or a staffed operator approval queue is required before release.

## Internal routes and secrets

Worker, cleanup, deletion, curation, and moderation routes use dedicated operational secrets, bounded bodies/batches, timing-safe comparison, opaque authority failures, and service-only RPC grants. Production rejects missing, short, or common default secret values. No server secret may use an `EXPO_PUBLIC_*` name. Never reuse the operator, media worker, account deletion, media cleanup, or review cleanup secret across domains.

Required server configuration is documented in `.env.example`. The trusted proxy hop count must match the hosting topology exactly. `MOBILE_API_ALLOWED_ORIGINS` is normally empty for native bearer-token traffic; add only exact browser tool/callback origins. Wildcard CORS and credentialed arbitrary origins are forbidden.

## Headers and browser delivery

Next responses set HSTS, nosniff, deny framing/frame ancestors, strict referrer policy, a restrictive permissions policy, and API no-store/CSP headers. Sensitive API CORS reflects an origin only when it exactly appears in `MOBILE_API_ALLOWED_ORIGINS`; a disallowed preflight returns 403. Native apps do not require CORS.

## Verification and operations

Local gates:

```sh
npm run validate:hardening-register
npm run validate:mobile-api-security
npm run test:mobile-api-security
npm run validate:mobile-api-security:db
npm run validate:mobile-api-security:api
npm run db:verify
```

The database runtime gate proves contract/grants, exact concurrent limiter admission, atomic multi-dimension denial, hashed storage, cleanup, Alice/Bob push ownership, frozen denial, moderation quarantine/approval, and report audit. The HTTP runtime gate proves enumeration equivalence, body rejection, 429/retry-after, actor statuses, real local Mailpit recovery redirect, CORS/headers, provider pre-auth, and internal authority.

Schedule API security cleanup and monitor only aggregate counts: expired limiter/idempotency backlog, pending moderation age/count, open report age/count, 429 rate by policy, provider sanitized failure class, and internal authorization failures. Do not attach raw identifiers or content.

Hosted and real-device verification is separate. It must prove shared limiting across multiple replicas, real email delivery, Android/iOS recovery after process death, real OAuth callbacks, provider quotas, production secret injection, and moderation-provider/operator availability before release.
