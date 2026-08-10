# Witoh authentication and profile authorization boundary

Date: 2026-07-16

## Release verdict

The checked-in implementation is ready for a production-like staging rollout, not an immediate store release. The database migration, hosted Auth hook activation, Google/OTP provider configuration, legacy-data query, signed-device journey matrix, monitoring, and rollback/roll-forward rehearsal remain mandatory release gates.

## Supported authentication lifecycle

- The only product entry points are Google OAuth and a six-digit email OTP.
- The OTP request API always returns the same accepted response and never looks up an account first.
- Supabase Auth owns the session. The application never stores passwords.
- A valid session is not sufficient to enter Witoh. The server calls `public.is_profile_complete(auth_user_id)` and returns `active`, `incomplete`, `missing`, or `deleting`.
- `active` enters Witoh. `incomplete` or `missing` remains authenticated in onboarding. `deleting` and invalid/unavailable identity resolution fail closed.
- Closing, force-stopping, rebooting, or ordinarily updating the app restores the Supabase session and repeats the same completeness decision. Logout clears the account-owned local boundary before the signed-out tree mounts.
- Successful onboarding replaces the onboarding tree with the protected tree. There is no Skip path.
- A `PASSWORD_RECOVERY` event is logged out before protected state or an account-owned cache can mount.

Supabase automatically links Google and email identities that present the same verified unique email. Witoh does not implement caller-selected or silent manual linking. Before release, verify same-email Google→OTP and OTP→Google journeys in the hosted project and confirm one Auth UUID, one profile row, and the expected identities array. Reference: <https://supabase.com/docs/guides/auth/auth-identity-linking>.

## Authoritative profile model

`public.is_profile_complete(uuid)` is the database authority used by account activity helpers and server actor resolution. A profile is complete only when:

- lifecycle is `active`;
- `deletion_started_at` is null;
- normalized Name is non-empty, at most 100 characters, and contains no control characters;
- username is already normalized lowercase and matches `^[a-z0-9_]{3,20}$`;
- account type is `public` or `private`.

Mobile's helper mirrors this rule only to render immediately. It cannot grant backend access. Server actor resolution and database policies use the database function.

## Profile field ownership

| Field group | Authority | Allowed path |
| --- | --- | --- |
| `id` | Auth/server | Derived from `auth.uid()` only |
| Name (`first_name`, `last_name`) | User-editable | `complete_current_profile` or `update_current_profile_details` |
| `username` | User-editable, globally unique | onboarding RPC or `update_current_username` |
| `bio` | User-editable | `update_current_profile_details` |
| `account_type` | User-editable | `update_current_account_type` |
| avatar URL/media linkage | Trusted media finalizer | Server/service path only |
| trust score/level/counters | Server | Service path only |
| lifecycle/deletion fields | Server | Account-deletion state machine only |
| timestamps and future columns | Server by default | No client table write grant |

Authenticated and anonymous roles have no direct `INSERT`, `UPDATE`, or `DELETE` privilege on `profiles`. Authenticated users receive `SELECT` only. The single read policy exposes an incomplete row only to its owner and exposes complete profiles to authenticated social features. Former owner-write and deletion-read policies are removed because PostgreSQL permissive policies combine with OR.

The mutation RPCs are `SECURITY DEFINER`, have an empty `search_path`, derive ownership from `auth.uid()`, validate bounded input, expose only explicit arguments, and reject frozen/incomplete callers where appropriate. Exact onboarding retries are idempotent. A different retry after completion is rejected. Username uniqueness remains transactional and deterministic.

## Password prevention

Supabase's email provider supports both OTP and password endpoints, so removing UI alone is insufficient. Migration `202607160001_auth_profile_boundary_hardening.sql` creates `circlebites_access_token_hook`; `supabase/config.toml` enables it locally as a Custom Access Token Hook. It rejects password token issuance before a password session exists and is executable only by `supabase_auth_admin`.

Supabase classifies verification of a provider recovery link as an OTP session. Therefore the access-token hook cannot distinguish that provider event from the supported email OTP. Witoh removes the recovery API, callback, navigation, settings UI, and client service methods and fails closed on the mobile recovery event. Runtime validation additionally proves that even if an email owner calls the provider recovery endpoint directly and sets a password, subsequent password sign-in is rejected.

Hosted deployment must activate the SQL Custom Access Token Hook in Authentication → Hooks. The hook is available on Free/Pro according to Supabase's Auth Hook matrix; the more specialized Password Verification Attempt Hook is plan-dependent. References: <https://supabase.com/docs/guides/auth/auth-hooks> and <https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook>.

## Stable service-RPC denial boundary

The pinned local PostgreSQL 17/PostgREST stack exposed a denial-path engine defect: expanding an ungranted public RPC, or concurrently expanding the limiter's scalar result, could terminate a database backend. The migration removes both query shapes.

- Set-returning and previously unguarded service implementations live in the non-exposed `private` schema, where `anon` and `authenticated` have no `USAGE`.
- Public service wrappers are `SECURITY DEFINER`, use an empty `search_path`, and check `auth.role() = 'service_role'` before calling a private implementation.
- Client roles can execute only the public guard. They receive SQLSTATE `42501` and never reach worker, moderation, cleanup, feed-assembly, observability, or account-deletion authority.
- The shared limiter uses a guarded one-row table result so concurrent PostgREST calls avoid scalar expansion; the Next.js server accepts exactly one row and fails closed on every malformed or unavailable response.
- `production_schema_contract()` reports both guarded-wrapper drift and any public service RPC left on raw ACL denial. Both arrays must remain empty.

This executable-guard model is not a grant of service capability: JWT role validation happens inside the wrapper, the authoritative implementation remains unreachable to client schemas, and real anon/auth adversarial tests verify stable denial.

## Migration and backward compatibility

Migration: `supabase/migrations/202607160001_auth_profile_boundary_hardening.sql`.

The migration is forward-only and performs no profile data rewrite. The linked test project audit on 2026-07-16 found one profile: one complete/active, zero incomplete, zero deleting, zero blank Name, and zero invalid username. Re-run the aggregate-only audit in staging immediately before deployment; never print emails, names, usernames, tokens, or content.

Old mobile binaries that directly update `profiles` will fail those writes after the migration. This is an intentional fail-closed security cutover. Existing complete sessions retain read/product access, but old onboarding/profile-edit clients are unsupported. Release the RPC-capable build behind a minimum-supported-version/maintenance cutover; do not roll back the app to a direct-write build after the migration. If a smooth multi-version window is required, stop and design a separately reviewed, temporary column-grant compatibility migration rather than restoring table-wide writes.

Recommended order:

1. Run the verification SQL and aggregate legacy audit against a disposable staging copy.
2. Deploy the new server/web build and make the new mobile build available, with a maintenance/minimum-version cutover ready.
3. Apply the migration and run pgTAP plus runtime adversarial validation.
4. Activate `circlebites_access_token_hook` in the hosted Auth Hooks console.
5. Verify Google, OTP, same-email identity linking, new/incomplete/complete/frozen/restart/logout/account-switch journeys.
6. Enable the supported mobile version and watch the staged canary before wider rollout.

Rollback is roll-forward: keep direct profile writes revoked, disable traffic or hold onboarding, correct the RPC/policy with a new migration, rerun the security gates, and redeploy. Disabling the Auth hook is an emergency availability action that reopens password token issuance and therefore requires explicit security-owner approval and immediate incident handling.

## Verification and monitoring

Automated gates:

```sh
npm run typecheck
npm --prefix mobile run typecheck
npm run db:contract
npm run db:test
npm run validate:mobile-api-security:db
node tests/supabase-auth-profile-boundary-runtime-validation.mjs
node --test tests/auth-profile-boundary-hardening.test.mjs tests/mobile-auth-journey-audit.test.mjs tests/mobile-auth-lifecycle-hardening.test.mjs
```

The runtime suite creates only synthetic local users and deletes them. It tests direct own/foreign writes, trusted fields, deletion, invalid/duplicate usernames, unexpected RPC parameters, caller-selected ownership, idempotency, allowed edits, incomplete visibility, lifecycle freeze, password rejection, and authoritative completeness.

Monitor counts and rates only: OTP accepted/limited responses, Auth hook rejection category, account-status outcomes, onboarding RPC error code, username conflicts, lifecycle denials, session-resolution failures, and logout cleanup failures. Do not log email, Name, username, Auth UUID, OTP, access/refresh token, recovery link, profile payload, IP, or content. Alert on sustained completeness-resolution unavailability, spikes in incomplete→signed-out transitions, unexpected password token success, or direct profile write success.
