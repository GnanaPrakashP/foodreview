import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const routes = read("scripts/report-mobile-api-security.mjs");
const actor = read("lib/server/route-supabase.ts");
const security = read("lib/server/api-security.ts");
const policies = read("lib/server/mobile-api-policies.ts");
const resolveEmail = read("app/api/mobile/auth/resolve-email/route.ts");
const recoveryRoute = read("app/api/mobile/auth/password-recovery/route.ts");
const auth = read("mobile/src/services/auth.ts");
const install = read("mobile/src/services/installIdentity.ts");
const publicFeed = read("app/api/feed/public/route.ts");
const migration = read("supabase/migrations/202607130008_mobile_api_security.sql");
const moderation = read("lib/server/content-moderation.ts");

test("canonical actor uses one verified Auth identity and authoritative active profile", () => {
  assert.equal((actor.match(/auth\.getUser\s*\(/g) ?? []).length, 1);
  assert.match(actor, /\.eq\("id", user\.id\)/);
  assert.match(actor, /account_status/);
  assert.doesNotMatch(actor, /email\?\.split|user_metadata\?\.username/);
  assert.match(routes, /route-local auth\.getUser remains/);
});

test("email helper and recovery responses do not branch on account existence", () => {
  assert.doesNotMatch(resolveEmail, /listUsers|admin\.getUser|sign_up|sign_in/);
  assert.match(resolveEmail, /GENERIC_RESPONSE/);
  assert.match(resolveEmail, /status:\s*202/);
  assert.match(recoveryRoute, /GENERIC_RESPONSE/);
  assert.match(recoveryRoute, /status:\s*202/);
  assert.doesNotMatch(recoveryRoute, /account exists|user not found/i);
});

test("durable limiter is atomic, shared, hashed, fail-closed, and cleanable", () => {
  assert.match(migration, /create table if not exists public\.api_rate_limit_buckets/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /for update/);
  assert.match(security, /createAdminClient\(\)\.rpc\("consume_api_rate_limits"/);
  assert.match(security, /createHmac\("sha256"/);
  assert.match(security, /return \{ allowed: false, remaining: 0, retryAfterSeconds: 30 \}/);
  assert.match(migration, /cleanup_api_security_state/);
  assert.match(migration, /api_idempotency_records[\s\S]*expires_at/);
});

test("critical endpoint policies include user, install, IP, subject, and weighted provider limits", () => {
  for (const policy of [
    "auth.resolve-email", "auth.password-recovery", "provider.places-autocomplete",
    "provider.places-details", "provider.reverse-geocode", "mutation.report",
    "notification.memory", "notification.event", "media.intent", "media.access",
  ]) assert.match(policies, new RegExp(`"${policy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(policies, /dimension:\s*"user"/);
  assert.match(policies, /dimension:\s*"install"/);
  assert.match(policies, /dimension:\s*"ip"/);
  assert.match(policies, /dimension:\s*"subject"/);
  assert.match(policies, /cost:\s*2/);
});

test("public feed ignores caller-supplied viewer authority", () => {
  assert.doesNotMatch(publicFeed, /searchParams\.get\(["']viewer["']\)/);
  assert.match(publicFeed, /getRouteActor\(req\)/);
  assert.match(publicFeed, /actor\?\.actorName/);
});

test("mobile recovery and OAuth callbacks are mode-bound, allowlisted, and replay-resistant", () => {
  assert.match(auth, /callbackParameters\(url, "oauth"\)/);
  assert.match(auth, /callbackParameters\(url, "recovery"\)/);
  assert.match(auth, /consumeAuthFlow\("oauth"/);
  assert.match(auth, /consumeAuthFlow\("recovery"/);
  assert.match(auth, /exchangeCodeForSession/);
  assert.match(auth, /token_hash/);
  assert.match(auth, /callbackType === "recovery"/);
  assert.match(auth, /supabase\.auth\.setSession/);
  assert.match(install, /deleteItemAsync/);
  assert.match(install, /expiresAt >= Date\.now\(\)/);
});

test("install identity is cryptographically random and is never authentication", () => {
  assert.match(install, /import \{ getRandomValues \} from "expo-crypto"/);
  assert.match(install, /return getRandomValues\(bytes\)/);
  assert.match(install, /SecureStore/);
  assert.match(install, /UUID_RE/);
  assert.doesNotMatch(actor, /x-foodreview-install-id/);
});

test("push tokens are actor/install-bound and cannot be silently reassigned", () => {
  assert.match(migration, /new\.user_id := auth\.uid\(\)/);
  assert.match(migration, /new\.user_name := v_username/);
  assert.match(migration, /install_id_required/);
  assert.match(migration, /expo_push_token !~/);
  assert.match(migration, /using \(user_id = auth\.uid\(\)\)/);
});

test("active media is quarantined until an audited server-side decision", () => {
  assert.match(migration, /moderation_status set default 'pending'/);
  assert.match(migration, /asset\.moderation_status = 'approved'/);
  assert.match(migration, /apply_media_moderation_action/);
  assert.match(migration, /media_moderation_actions/);
  assert.match(moderation, /decision: "pending"/);
  assert.match(moderation, /provider_unavailable/);
});

test("API responses use safe headers and sensitive CORS is allowlisted", () => {
  assert.match(security, /X-Content-Type-Options/);
  assert.match(security, /Referrer-Policy/);
  assert.match(security, /X-Frame-Options/);
  assert.match(security, /MOBILE_API_ALLOWED_ORIGINS/);
  assert.doesNotMatch(security, /Access-Control-Allow-Origin["']?\s*:\s*["']\*/);
});
