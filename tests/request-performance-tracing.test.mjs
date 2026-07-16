import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("Circle tracing is opt-in, correlated, bounded, and excludes private request data", async () => {
  const tracing = await source("lib/server/request-performance.ts");
  assert.match(tracing, /API_PERFORMANCE_TRACE_ENABLED === "true"/);
  for (const field of [
    "correlation_id", "duration_ms", "auth_duration_ms", "database_call_count",
    "database_calls", "database_duration_ms", "assembly_duration_ms",
    "serialization_duration_ms", "payload_bytes", "status",
  ]) {
    assert.match(tracing, new RegExp(field));
  }
  assert.match(tracing, /connection_wait_available:\s*false/);
  assert.doesNotMatch(tracing, /accessToken|refreshToken|authorization|cookie|email|otp|message_body|storage_path/i);
});

test("Circle route traces the canonical RPC, enrichment, media authorization, and response assembly", async () => {
  const [route, canonical, assembly, profileDisplay, actor, media] = await Promise.all([
    source("app/api/feed/circle/route.ts"),
    source("lib/server/canonical-circle-feed.ts"),
    source("lib/server/feed-assembly.ts"),
    source("lib/profile-display.ts"),
    source("lib/server/route-supabase.ts"),
    source("lib/server/post-media-access.ts"),
  ]);
  assert.match(route, /beginRequestPerformanceTrace\(req, "api\.feed\.circle"\)/);
  assert.match(route, /tracedJson\(trace/);
  assert.match(route, /feed\.media_authorization/);
  assert.match(route, /feed\.response_assembly/);
  assert.match(canonical, /feed\.circle_feed_page_v2/);
  assert.match(canonical, /feed\.enrichment/);
  assert.match(assembly, /feed\.mobile_post_engagement_v1/);
  assert.match(profileDisplay, /feed\.profile_display/);
  assert.match(actor, /auth\.get_user/);
  assert.match(actor, /actor\.profile_status/);
  assert.match(actor, /actor\.is_profile_complete/);
  for (const call of ["media.assets", "media.review_links", "media.review_access", "media.active_owners", "media.derivatives"]) {
    assert.match(media, new RegExp(call.replaceAll(".", "\\.")));
  }
});
