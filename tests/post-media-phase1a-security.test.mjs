import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

function loadPolicy() {
  const { outputText } = ts.transpileModule(source("lib/server/post-media-policy.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, { module: mod, exports: mod.exports, require: () => { throw new Error("Unexpected import"); } });
  return mod.exports;
}

function loadAccess(policy) {
  const { outputText } = ts.transpileModule(source("lib/server/post-media-access.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    Date,
    Map,
    Set,
    module: mod,
    exports: mod.exports,
    require(id) {
      if (id === "@/lib/server/post-media-policy") return policy;
      if (id === "@/lib/server/media-pipeline") return {
        MEDIA_PRIVATE_BUCKET: "media-private",
        MEDIA_POST_SIGNED_URL_TTL_SECONDS: 300,
        accessClassForPostVisibility: (visibility) => visibility === "public" ? "public_post" : visibility === "circle" ? "circle_post" : "private_post"
      };
      throw new Error(`Unexpected import: ${id}`);
    }
  });
  return mod.exports;
}

function accessDb({ blocked = false, member = true, privacyState = "stable", visibility = "circle", status = "active" } = {}) {
  const ttlCalls = [];
  const rows = {
    media_assets: [{ id: "asset-1", owner_name: "owner", surface: "post", media_type: "image", status: "ready", access_class: visibility === "public" ? "public_post" : visibility === "circle" ? "circle_post" : "private_post", privacy_state: privacyState }],
    review_photos: [{ media_asset_id: "asset-1", review_id: "review-1", media_type: "image", position: 0 }],
    reviews: [review(visibility, { status })],
    circle_memberships: member ? [{ user_name: "owner", member_name: "member" }] : [],
    blocked_users: blocked ? [{ blocker_name: "owner", blocked_name: "member" }] : [],
    profiles: [{ username: "owner" }],
    media_derivatives: [{ asset_id: "asset-1", blurhash: "hash", bucket_id: "media-private", duration_ms: null, height: 1350, kind: "canonical", mime_type: "image/jpeg", storage_path: "private-posts/owner/asset-1/canonical.jpg", width: 1080 }]
  };
  return {
    ttlCalls,
    from(table) {
      const chain = {
        then(resolve) { return Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve); }
      };
      for (const method of ["select", "in", "eq", "is"]) chain[method] = () => chain;
      return chain;
    },
    storage: {
      from() {
        return {
          async createSignedUrls(paths, ttl) {
            ttlCalls.push(ttl);
            return { data: paths.map((path) => ({ path, signedUrl: `https://signed.test/${encodeURIComponent(path)}` })), error: null };
          }
        };
      }
    }
  };
}

function review(visibility = "public", overrides = {}) {
  return {
    id: "review-1",
    reviewer_name: "owner",
    visibility,
    deleted_at: null,
    hidden_at: null,
    reported_at: null,
    status: "active",
    ...overrides
  };
}

test("post media policy enforces owner, public, circle, private, block, and suppression", () => {
  const { canViewerAccessPostMedia, postMediaPolicyPair } = loadPolicy();
  assert.equal(canViewerAccessPostMedia({ review: review("me"), viewerName: "owner" }), true);
  assert.equal(canViewerAccessPostMedia({ review: review("public"), viewerName: "" }), true);
  assert.equal(canViewerAccessPostMedia({
    circleMemberships: new Set([postMediaPolicyPair("owner", "member")]),
    review: review("circle"),
    viewerName: "member"
  }), true);
  assert.equal(canViewerAccessPostMedia({ review: review("circle"), viewerName: "stranger" }), false);
  assert.equal(canViewerAccessPostMedia({ review: review("me"), viewerName: "member" }), false);
  assert.equal(canViewerAccessPostMedia({ review: review(null), viewerName: "stranger" }), false);
  assert.equal(canViewerAccessPostMedia({
    blockedPairs: new Set([postMediaPolicyPair("member", "owner")]),
    circleMemberships: new Set([postMediaPolicyPair("owner", "member")]),
    review: review("circle"),
    viewerName: "member"
  }), false);
  assert.equal(canViewerAccessPostMedia({ review: review("public", { deleted_at: new Date().toISOString() }), viewerName: "owner" }), false);
  assert.equal(canViewerAccessPostMedia({ review: review("public", { status: "removed" }), viewerName: "" }), false);
});

test("all six visibility transitions change new-URL authorization immediately", () => {
  const { canViewerAccessPostMedia, postMediaPolicyPair } = loadPolicy();
  const member = {
    circleMemberships: new Set([postMediaPolicyPair("owner", "member")]),
    viewerName: "member"
  };
  const stranger = { viewerName: "stranger" };
  const transitions = [
    ["public", "circle", true, true],
    ["public", "me", true, false],
    ["circle", "public", true, true],
    ["me", "public", false, true],
    ["circle", "me", true, false],
    ["me", "circle", false, true]
  ];
  for (const [from, to, memberBefore, memberAfter] of transitions) {
    assert.equal(canViewerAccessPostMedia({ ...member, review: review(from) }), memberBefore);
    assert.equal(canViewerAccessPostMedia({ ...member, review: review(to) }), memberAfter);
    if (from === "public") assert.equal(canViewerAccessPostMedia({ ...stranger, review: review(from) }), true);
    if (to !== "public") assert.equal(canViewerAccessPostMedia({ ...stranger, review: review(to) }), false);
  }
});

test("membership removal and blocking prevent fresh media authorization", () => {
  const { canViewerAccessPostMedia, postMediaPolicyPair } = loadPolicy();
  const circle = review("circle");
  assert.equal(canViewerAccessPostMedia({
    circleMemberships: new Set([postMediaPolicyPair("owner", "member")]),
    review: circle,
    viewerName: "member"
  }), true);
  assert.equal(canViewerAccessPostMedia({ circleMemberships: new Set(), review: circle, viewerName: "member" }), false);
  assert.equal(canViewerAccessPostMedia({
    blockedPairs: new Set([postMediaPolicyPair("owner", "member")]),
    circleMemberships: new Set([postMediaPolicyPair("owner", "member")]),
    review: circle,
    viewerName: "member"
  }), false);
});

test("authorised delivery signs a bounded batch and denies removed, blocked, deleted, or transitional access", async () => {
  const policy = loadPolicy();
  const { resolvePostMediaAccess } = loadAccess(policy);
  const allowedDb = accessDb();
  const allowed = await resolvePostMediaAccess(allowedDb, ["asset-1", "asset-1"], "member");
  assert.equal(allowed.length, 1);
  assert.equal(allowedDb.ttlCalls[0], 300);
  assert.match(allowed[0].displayUrl, /^https:\/\/signed\.test\//);
  assert.equal("storagePath" in allowed[0], false);

  assert.equal((await resolvePostMediaAccess(accessDb({ member: false }), ["asset-1"], "member")).length, 0);
  assert.equal((await resolvePostMediaAccess(accessDb({ blocked: true }), ["asset-1"], "member")).length, 0);
  assert.equal((await resolvePostMediaAccess(accessDb({ status: "deleted" }), ["asset-1"], "member")).length, 0);
  assert.equal((await resolvePostMediaAccess(accessDb({ privacyState: "failed" }), ["asset-1"], "member")).length, 0);
});

test("Expo configuration rejects privileged public Supabase variable names without reading values", () => {
  const cwd = new URL("../mobile", import.meta.url);
  const safe = spawnSync(process.execPath, ["-e", "require('./app.config.js')({config:{}})"], {
    cwd,
    env: { ...process.env, EXPO_PUBLIC_SUPABASE_SERVICE_KEY: undefined },
    encoding: "utf8"
  });
  assert.equal(safe.status, 0, safe.stderr);

  const blocked = spawnSync(process.execPath, ["-e", "require('./app.config.js')({config:{}})"], {
    cwd,
    env: { ...process.env, EXPO_PUBLIC_SUPABASE_SERVICE_KEY: "not-a-real-key" },
    encoding: "utf8"
  });
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /Privileged Supabase environment name is forbidden/);
  assert.doesNotMatch(blocked.stderr, /not-a-real-key/);

  const productionAutologin = spawnSync(process.execPath, ["-e", "require('./app.config.js')({config:{}})"], {
    cwd,
    env: {
      ...process.env,
      EAS_BUILD: "true",
      EXPO_PUBLIC_DEV_AUTOLOGIN_EMAIL: "local@example.test",
      EXPO_PUBLIC_DEV_AUTOLOGIN_PASSWORD: "not-a-real-password",
      EXPO_PUBLIC_SUPABASE_SERVICE_KEY: undefined
    },
    encoding: "utf8"
  });
  assert.notEqual(productionAutologin.status, 0);
  assert.match(productionAutologin.stderr, /Development auto-login configuration is forbidden/);
  assert.doesNotMatch(productionAutologin.stderr, /not-a-real-password/);

  const autoLoginSource = source("mobile/src/providers/devAutoLoginConfig.ts");
  assert.match(autoLoginSource, /devAutoLoginEmail = __DEV__/);
  assert.match(autoLoginSource, /devAutoLoginPassword = __DEV__/);
});

test("Phase 1A canonical migration and backfill fail closed", () => {
  const rootMigration = source("supabase/migrations/202607130001_visibility_aware_post_media.sql");
  assert.match(rootMigration, /private_media_derivative_requires_private_bucket/);
  assert.match(rootMigration, /review_media_requires_private_backfill/);
  assert.match(rootMigration, /privacy_state <> 'stable'/);
  assert.match(rootMigration, /security definer[\s\S]*set search_path = ''/);
  const backfill = source("scripts/post-media-visibility-backfill.mjs");
  assert.match(backfill, /process\.argv\.includes\("--apply"\)/);
  assert.match(backfill, /--after=/);
  assert.match(backfill, /private_copy_verification_failed/);
  assert.match(backfill, /const assetId = row\.id/);
  assert.match(backfill, /privateCopyAlreadyVerified/);
  assert.match(backfill, /state: "metadata_updated"/);
  assert.match(backfill, /deleteOldObjects/);
});
