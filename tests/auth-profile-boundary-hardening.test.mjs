import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const migration = read("supabase/migrations/202607160001_auth_profile_boundary_hardening.sql");

test("profiles expose read-only table grants and narrow owner-derived mutation RPCs", () => {
  assert.match(migration, /revoke all privileges on table public\.profiles from anon, authenticated/);
  assert.match(migration, /grant select on table public\.profiles to authenticated/);
  assert.match(migration, /drop policy if exists "Users can insert own profile"/);
  assert.match(migration, /drop policy if exists "Users can update own profile"/);
  assert.match(migration, /create or replace function public\.complete_current_profile\(p_name text, p_username text\)/);
  assert.match(migration, /v_uid uuid := auth\.uid\(\)/);
  assert.doesNotMatch(migration, /complete_current_profile\([^)]*p_user_id/);
  assert.match(migration, /create or replace function public\.update_current_profile_details/);
  assert.match(migration, /create or replace function public\.update_current_account_type/);
  assert.match(migration, /create or replace function public\.update_current_username/);
  assert.match(migration, /set search_path = ''/);
});

test("one database rule defines completeness and server actor resolution consumes it", () => {
  assert.match(migration, /create or replace function public\.is_profile_complete\(p_user_id uuid\)/);
  assert.match(migration, /profile\.account_status = 'active'/);
  assert.match(migration, /profile\.deletion_started_at is null/);
  assert.match(migration, /profile_name_is_valid\(profile\.first_name, profile\.last_name\)/);
  assert.match(migration, /profile_username_is_valid\(profile\.username\)/);
  assert.match(migration, /create or replace function public\.account_is_active[\s\S]*is_profile_complete/);
  assert.match(read("lib/server/route-supabase.ts"), /\.rpc\("is_profile_complete", \{ p_user_id: user\.id \}\)/);
  assert.match(read("app/api/mobile/auth/account-status/route.ts"), /incomplete_profile[\s\S]*"incomplete"/);
  assert.match(read("mobile/src/providers/AccountSessionBoundary.tsx"), /lifecycle === "incomplete"/);
});

test("mobile and web profile clients use restricted RPCs instead of direct table writes", () => {
  const mobile = read("mobile/src/services/profiles.ts");
  const web = [
    read("app/onboarding/page.tsx"),
    read("app/me/settings/edit/page.tsx"),
    read("app/me/settings/page.tsx")
  ].join("\n");
  assert.match(mobile, /\.rpc\("complete_current_profile"/);
  assert.match(mobile, /\.rpc\("update_current_profile_details"/);
  assert.match(mobile, /\.rpc\("update_current_account_type"/);
  assert.doesNotMatch(mobile, /\.from\("profiles"\)[\s\S]{0,160}\.(?:insert|upsert|update|delete)\(/);
  assert.match(web, /\.rpc\("complete_current_profile"/);
  assert.match(web, /\.rpc\("update_current_profile_details"/);
  assert.match(web, /\.rpc\("update_current_account_type"/);
  assert.doesNotMatch(web, /\.from\("profiles"(?: as never)?\)[\s\S]{0,160}\.(?:insert|upsert|update|delete)\(/);
});

test("production auth surface is Google plus email OTP with password tokens rejected", () => {
  const productSources = [
    read("app/login/page.tsx"),
    read("mobile/app/(auth)/login.tsx"),
    read("mobile/src/services/auth.ts"),
    read("mobile/src/hooks/useAuth.ts"),
    read("mobile/app/profile/settings/security.tsx")
  ].join("\n");
  assert.doesNotMatch(productSources, /signInWithPassword|resetPasswordForEmail|updateUser\(\{\s*password|PasswordInput|Forgot password|Change password/);
  assert.equal(existsSync(new URL("app/auth/reset-password/page.tsx", root)), false);
  assert.equal(existsSync(new URL("app/api/mobile/auth/password-recovery/route.ts", root)), false);
  assert.equal(existsSync(new URL("mobile/app/auth/recovery.tsx", root)), false);
  assert.match(migration, /circlebites_access_token_hook/);
  assert.match(migration, /authentication_method'[\s\S]*'password'/);
  assert.match(read("supabase/config.toml"), /\[auth\.hook\.custom_access_token\][\s\S]*enabled = true/);
  assert.match(read("mobile/src/providers/AccountSessionBoundary.tsx"), /event === "PASSWORD_RECOVERY"[\s\S]*logout\(\)/);
});

test("database verification and adversarial runtime gates are checked in", () => {
  assert.equal(existsSync(new URL("supabase/tests/0005_auth_profile_boundary.sql", root)), true);
  assert.equal(existsSync(new URL("supabase/snippets/verify_auth_profile_boundary.sql", root)), true);
  assert.equal(existsSync(new URL("tests/supabase-auth-profile-boundary-runtime-validation.mjs", root)), true);
});

test("service-only set-returning RPCs are isolated behind guarded scalar wrappers", () => {
  assert.match(migration, /create schema if not exists private/);
  assert.match(migration, /alter function public\.claim_media_processing_jobs[\s\S]*set schema private/);
  assert.match(migration, /create function public\.claim_media_processing_jobs[\s\S]*returns json[\s\S]*service_role_required/);
  assert.match(migration, /grant execute on function public\.claim_media_processing_jobs[\s\S]*to anon, authenticated/);
  assert.match(migration, /notify pgrst, 'reload schema'/);
});
