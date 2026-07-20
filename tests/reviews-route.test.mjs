/**
 * Security and validation tests for:
 *   POST   /api/reviews          (create)
 *   DELETE /api/reviews/[id]     (delete — owner only)
 *   PATCH  /api/reviews/[id]     (edit — owner only)
 *
 * Key invariant: reviewer_name is ALWAYS derived from the authenticated
 * session via getAuthenticatedCircleActor — it is never read from the
 * request body.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createApiSecurityStub } from "./helpers/api-security-stub.mjs";

// ── transpile ─────────────────────────────────────────────────────────────────

function transpile(src) {
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  return outputText;
}

const src = {
  create: transpile(
    readFileSync(new URL("../app/api/reviews/route.ts", import.meta.url), "utf8")
  ),
  byId: transpile(
    readFileSync(new URL("../app/api/reviews/[id]/route.ts", import.meta.url), "utf8")
  ),
};

// ── mock helpers ──────────────────────────────────────────────────────────────

/**
 * Sequential mock DB: each from() call consumes the next response.
 * All chain methods return `this` so the call can be awaited anywhere.
 */
function mockDb(...responses) {
  let idx = 0;
  return {
    rpc: async () => ({ data: true, error: null }),
    storage: {
      from() {
        return {
          getPublicUrl: (path) => ({ data: { publicUrl: `https://storage.test/${path}` } }),
          remove: async () => ({ data: [], error: null }),
        };
      },
    },
    from(_table) {
      const next = () => Promise.resolve(responses[idx++] ?? { data: null, error: null });
      const chain = {
        then(res, rej) { return next().then(res, rej); },
        catch(rej) { return next().catch(rej); },
      };
      for (const m of [
        "select", "eq", "ilike", "or", "limit", "insert",
        "delete", "update", "order", "in", "single", "maybeSingle", "upsert",
        "returns", "is",
      ]) {
        chain[m] = () => chain;
      }
      return chain;
    },
  };
}

/**
 * Capturing mock DB: records the argument passed to `.insert()` so tests
 * can verify what row was written to the database.
 */
function validIntent(overrides = {}) {
  const row = {
    access_class: "public_post",
    consumed_at: null,
    duration_ms: null,
    id: "11111111-1111-4111-8111-111111111112",
    media_type: "image",
    moderation_status: "approved",
    original_mime_type: "image/jpeg",
    owner_id: "uid-alice",
    owner_name: "Alice",
    privacy_state: "stable",
    status: "ready",
    surface: "post",
    ...overrides,
  };
  if (overrides.user_id) row.owner_id = overrides.user_id;
  if (overrides.user_name) row.owner_name = overrides.user_name;
  if (overrides.status === "finalized") row.status = "ready";
  return row;
}

function capturingDb(
  resolveWith = { data: { id: "11111111-1111-4111-8111-111111111111" }, error: null },
  intentRow = validIntent()
) {
  let insertedRow;
  let insertedPhotoRows;
  return {
    get _inserted() { return insertedRow; },
    get _insertedPhotoRows() { return insertedPhotoRows; },
    rpc: async () => ({ data: true, error: null }),
    storage: {
      from() {
        return {
          getPublicUrl: (path) => ({ data: { publicUrl: `https://storage.test/${path}` } }),
          remove: async () => ({ data: [], error: null }),
        };
      },
    },
    from(table) {
      const chain = {
        then(res, rej) {
          const response =
            table === "media_assets"
              ? { data: [intentRow], error: null }
              : table === "media_derivatives"
                ? { data: [{ asset_id: intentRow.id, kind: "canonical", bucket_id: "media-private", storage_path: `private-posts/${intentRow.owner_id}/${intentRow.id}/canonical.jpg`, public_url: null, mime_type: "image/jpeg", width: 1080, height: 1350, duration_ms: null, file_size_bytes: 1234, blurhash: null }], error: null }
              : table === "review_media_upload_intents"
                ? { data: [], error: null }
              : table === "review_photos"
                ? { data: null, error: null }
                : resolveWith;
          return Promise.resolve(response).then(res, rej);
        },
        catch(rej) { return Promise.resolve(resolveWith).catch(rej); },
        insert(row) {
          if (table === "review_photos") insertedPhotoRows = row;
          if (table === "reviews" && insertedRow === undefined) insertedRow = row;
          return chain;
        },
      };
      for (const m of [
        "select", "eq", "limit", "single", "maybeSingle",
        "delete", "update", "order", "in", "returns",
      ]) {
        chain[m] = () => chain;
      }
      return chain;
    },
  };
}

const mockNextResponse = {
  json(body, opts) { return { _body: body, _status: opts?.status ?? 200 }; },
};

function makeReq(body) { return { json: async () => body }; }
function body(res) { return res._body; }
function status(res) { return res._status; }

function loadRoute(code, { db, adminDb, authName, dishIdentity }) {
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    console,
    process: { env: {} },
    URLSearchParams,
    require(id) {
      if (id === "@supabase/ssr") return { createServerClient: () => db };
      if (id === "next/headers") return { cookies: async () => ({ getAll: () => [] }) };
      if (id === "next/server") return { NextRequest: class {}, NextResponse: mockNextResponse };
      if (id === "@/lib/server/api-security") return createApiSecurityStub({ json: mockNextResponse.json });
      if (id === "@/lib/server/cache-invalidation") {
        return {
          invalidateCircleFeedCacheForNames() {},
          invalidateSocialCachesForNames() {},
        };
      }
      if (id === "@/lib/server/route-supabase") {
        return {
          createRouteSupabase: async () => db,
          getRouteActor: async () => ({
            supabase: db,
            actor: authName
              ? { userId: `uid-${authName.toLowerCase().replace(/\s/g, "-")}`, actorName: authName, displayName: authName }
              : null,
          }),
        };
      }
      if (id === "@/lib/server/review-validation") {
        const isValidUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
        const isValidVisibility = (value) => ["public", "circle", "me"].includes(value);
        const normalizeReviewItems = (items) => {
          if (!Array.isArray(items)) return { error: "At least one dish is required" };
          const normalized = [];
          for (const item of items) {
            const name = item?.name?.trim();
            if (!name) continue;
            if (item.rating !== undefined && (typeof item.rating !== "number" || item.rating < 1 || item.rating > 5)) {
              return { error: "Invalid rating" };
            }
            normalized.push({ name, rating: item.rating ?? 0 });
          }
          return normalized.length ? { items: normalized } : { error: "At least one dish is required" };
        };
        const validateReviewBody = (value) => {
          if (value === undefined) return {};
          if (value === null) return { body: null };
          if (typeof value !== "string") return { error: "Invalid body" };
          const trimmed = value.trim();
          if (trimmed && trimmed.length < 5) return { error: "Body must be at least 5 characters" };
          return { body: trimmed || null };
        };
        return { isValidUuid, isValidVisibility, normalizeReviewItems, validateReviewBody };
      }
      if (id === "@/lib/server/reputation") {
        return { refreshUserReputationFoundation: async () => {} };
      }
      if (id === "@/lib/server/account-media-cleanup") {
        return {
          recordAccountMediaCleanupJob: async () => "cleanup-job",
          removeStorageObjectsOrQueue: async () => ({ cleanupPending: false, removedCount: 1 }),
        };
      }
      if (id === "@/lib/server/review-media") {
        return {
          REVIEW_MEDIA_BUCKET: "review-photos",
          REVIEW_POST_MAX_ITEMS: 4,
          isOwnedReviewMediaPath: (path, userId) => path?.includes(`/${userId}/`) ?? false,
        };
      }
      if (id === "@/lib/server/media-pipeline") {
        return {
          accessClassForPostVisibility: () => "public_post",
          MEDIA_PRIVATE_BUCKET: "media-private",
          MEDIA_PUBLIC_BUCKET: "media-public",
          MEDIA_SOURCE_BUCKET: "media-sources",
        };
      }
      if (id === "@/lib/server/dish-identity") {
        return {
          replaceReviewDishMentions: dishIdentity?.replaceReviewDishMentions ?? (async () => ({ ok: true, rows: [] })),
        };
      }
      if (id === "@/lib/supabase/admin") return { createAdminClient: () => adminDb ?? db };
      if (id === "@/lib/circle-auth") {
        return {
          getAuthenticatedCircleActor: async () =>
            authName
              ? { userId: `uid-${authName.toLowerCase().replace(/\s/g, "-")}`, actorName: authName }
              : null,
        };
      }
      throw new Error(`Unexpected require in reviews tests: ${id}`);
    },
  });
  return mod.exports;
}

const VALID_BODY = {
  restaurantName: "Bawarchi",
  items: [{ name: "Mutton Biryani", rating: 5 }],
  media: [{ assetId: "11111111-1111-4111-8111-111111111112", mediaType: "image" }],
  visibility: "public",
};

// ── POST /api/reviews ─────────────────────────────────────────────────────────

test("POST /reviews: logged-out user is rejected with 401", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: null });
  const res = await POST(makeReq(VALID_BODY));
  assert.equal(status(res), 401);
});

test("POST /reviews: forged reviewerName in body is ignored; authenticated actor is used", async () => {
  const db = capturingDb(
    { data: { id: "11111111-1111-4111-8111-111111111111" }, error: null },
    validIntent({
      user_id: "uid-alice-smith",
      user_name: "Alice Smith",
      storage_path: "posts/uid-alice-smith/intent-1/media.jpg",
    })
  );
  const { POST } = loadRoute(src.create, { db, authName: "Alice Smith" });
  const res = await POST(
    makeReq({ ...VALID_BODY, reviewerName: "Mallory Hacker" })
  );
  assert.equal(status(res), 200);
  assert.equal(db._inserted.reviewer_name, "Alice Smith");
  assert.notEqual(db._inserted.reviewer_name, "Mallory Hacker");
});

test("POST /reviews: reviewer_name in response row is the auth actor, not request body", async () => {
  const db = capturingDb(
    { data: { id: "11111111-1111-4111-8111-111111111111" }, error: null },
    validIntent({
      user_id: "uid-priya-kumar",
      user_name: "Priya Kumar",
      storage_path: "posts/uid-priya-kumar/intent-1/media.jpg",
    })
  );
  const { POST } = loadRoute(src.create, { db, authName: "Priya Kumar" });
  await POST(makeReq(VALID_BODY));
  assert.equal(db._inserted.reviewer_name, "Priya Kumar");
});

test("POST /reviews: missing restaurantName returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ items: [{ name: "Biryani" }], visibility: "public" }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /restaurantName/i);
});

test("POST /reviews: empty restaurantName returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, restaurantName: "   " }));
  assert.equal(status(res), 400);
});

test("POST /reviews: empty items array returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ restaurantName: "Bawarchi", items: [], visibility: "public" }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /dish/i);
});

test("POST /reviews: more than four media items returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const media = Array.from({ length: 5 }, (_, i) => ({
    intentId: `intent-${i}`,
    mediaType: "image",
  }));

  const res = await POST(makeReq({ ...VALID_BODY, media }));

  assert.equal(status(res), 400);
  assert.match(body(res).error, /Maximum 4 media/i);
});

test("POST /reviews: videos over the post duration limit are rejected before media lookup", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const media = [{
    intentId: "intent-video",
    mediaType: "video",
    durationSeconds: 31,
  }];

  const res = await POST(makeReq({ ...VALID_BODY, media }));

  assert.equal(status(res), 400);
  assert.match(body(res).error, /Videos must be 30 seconds or less/i);
});

test("POST /reviews: videos without duration are rejected before media lookup", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const media = [{
    intentId: "intent-video",
    mediaType: "video",
  }];

  const res = await POST(makeReq({ ...VALID_BODY, media }));

  assert.equal(status(res), 400);
  assert.match(body(res).error, /Videos must be 30 seconds or less/i);
});

test("POST /reviews: legacy finalized post intents are rejected", async () => {
  const db = capturingDb(
    { data: { id: "11111111-1111-4111-8111-111111111111" }, error: null },
    validIntent({
      id: "intent-video",
      media_type: "video",
      mime_type: "video/mp4",
      storage_path: "posts/uid-alice/intent-video/media.mp4",
    })
  );
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const media = [{
    intentId: "intent-video",
    durationSeconds: 10,
  }];

  const res = await POST(makeReq({ ...VALID_BODY, media }));

  assert.equal(status(res), 409);
  assert.match(body(res).error, /Legacy post media must be uploaded again/i);
});

test("POST /reviews: items with only whitespace names returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, items: [{ name: "  " }] }));
  assert.equal(status(res), 400);
});

test("POST /reviews: invalid visibility value returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, visibility: "friends" }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /visibility/i);
});

test("POST /reviews: invalid rating returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, items: [{ name: "Biryani", rating: 6 }] }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /rating/i);
});

test("POST /reviews: visibility=circle is accepted", async () => {
  const db = capturingDb();
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, visibility: "circle" }));
  assert.equal(status(res), 200);
});

test("POST /reviews: visibility=me is accepted", async () => {
  const db = capturingDb();
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, visibility: "me" }));
  assert.equal(status(res), 200);
});

test("POST /reviews: body shorter than 5 chars returns 400", async () => {
  const { POST } = loadRoute(src.create, { db: mockDb(), authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, body: "ok" }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /5 char/i);
});

test("POST /reviews: empty body field is accepted (optional)", async () => {
  const db = capturingDb();
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, body: "" }));
  assert.equal(status(res), 200);
});

test("POST /reviews: valid review returns the new review id", async () => {
  const db = capturingDb({ data: { id: "rev-abc-123" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq(VALID_BODY));
  assert.equal(status(res), 200);
  assert.equal(body(res).id, "rev-abc-123");
});

test("POST /reviews: writes backend-owned dish mentions for the created review", async () => {
  const calls = [];
  const db = capturingDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const dishIdentity = {
    replaceReviewDishMentions: async (_db, input) => {
      calls.push(input);
      return { ok: true, rows: [] };
    }
  };
  const items = [{ name: "Chicken Biryani", rating: 5 }];
  const { POST } = loadRoute(src.create, { db, authName: "Alice", dishIdentity });
  const res = await POST(makeReq({ ...VALID_BODY, items, restaurantId: "google-place-1" }));

  assert.equal(status(res), 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].reviewId, "11111111-1111-4111-8111-111111111111");
  assert.equal(calls[0].userId, "uid-alice");
  assert.equal(calls[0].placeId, "google-place-1");
  assert.deepEqual(calls[0].submittedItems, items);
});

test("POST /reviews: DB error returns 500", async () => {
  const { POST } = loadRoute(src.create, {
    db: mockDb(
      { data: [validIntent()], error: null },
      { data: [{ asset_id: "11111111-1111-4111-8111-111111111112", kind: "canonical", bucket_id: "media-private", storage_path: "private-posts/uid-alice/11111111-1111-4111-8111-111111111112/canonical.jpg", public_url: null, mime_type: "image/jpeg", width: 1080, height: 1350, duration_ms: null, file_size_bytes: 1234, blurhash: null }], error: null },
      { data: null, error: { message: "db connection failed" } }
    ),
    authName: "Alice",
  });
  const res = await POST(makeReq(VALID_BODY));
  assert.equal(status(res), 500);
  assert.equal(body(res).error, "Could not create review");
});

// ── DELETE /api/reviews/[id] ──────────────────────────────────────────────────

test("DELETE /reviews/[id]: logged-out user is rejected with 401", async () => {
  const { DELETE } = loadRoute(src.byId, { db: mockDb(), authName: null });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
  assert.equal(status(res), 401);
});

test("DELETE /reviews/[id]: malformed review id returns 400", async () => {
  const { DELETE } = loadRoute(src.byId, { db: mockDb(), authName: "Alice" });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "not-a-review-id" }) });
  assert.equal(status(res), 400);
  assert.match(body(res).error, /review id/i);
});

test("DELETE /reviews/[id]: review not found returns 404", async () => {
  const { DELETE } = loadRoute(src.byId, {
    db: mockDb({ data: null, error: null }),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
  assert.equal(status(res), 404);
});

test("DELETE /reviews/[id]: another user cannot delete someone else's review", async () => {
  const { DELETE } = loadRoute(src.byId, {
    db: mockDb(
      { data: { reviewer_name: "Bob" }, error: null },
      { data: null, error: null }
    ),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
  assert.equal(status(res), 403);
  assert.match(body(res).error, /not your review/i);
});

test("DELETE /reviews/[id]: owner can delete their own review", async () => {
  const { DELETE } = loadRoute(src.byId, {
    db: mockDb(
      { data: { reviewer_name: "Alice" }, error: null },
      { data: null, error: null }
    ),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
  assert.equal(status(res), 200);
  assert.equal(body(res).ok, true);
});

test("DELETE /reviews/[id]: DB delete error returns 500", async () => {
  const { DELETE } = loadRoute(src.byId, {
    db: mockDb(
      { data: { reviewer_name: "Alice" }, error: null },
      { data: null, error: { message: "delete failed" } }
    ),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
  assert.equal(status(res), 500);
  assert.equal(body(res).error, "Could not delete review");
});

test("DELETE /reviews/[id]: DB fetch error returns 404", async () => {
  const { DELETE } = loadRoute(src.byId, {
    db: mockDb({ data: null, error: { message: "fetch failed" } }),
    authName: "Alice",
  });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
  assert.equal(status(res), 404);
});

// ── PATCH /api/reviews/[id] ───────────────────────────────────────────────────

test("PATCH /reviews/[id]: logged-out user is rejected with 401", async () => {
  const { PATCH } = loadRoute(src.byId, { db: mockDb(), authName: null });
  const res = await PATCH(
    makeReq({ visibility: "circle" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(status(res), 401);
});

test("PATCH /reviews/[id]: malformed review id returns 400", async () => {
  const { PATCH } = loadRoute(src.byId, { db: mockDb(), authName: "Alice" });
  const res = await PATCH(
    makeReq({ visibility: "circle" }),
    { params: Promise.resolve({ id: "not-a-review-id" }) }
  );
  assert.equal(status(res), 400);
  assert.match(body(res).error, /review id/i);
});

test("PATCH /reviews/[id]: another user cannot edit someone else's review", async () => {
  const { PATCH } = loadRoute(src.byId, {
    db: mockDb(
      { data: { reviewer_name: "Bob" }, error: null },
      { data: null, error: null }
    ),
    authName: "Alice",
  });
  const res = await PATCH(
    makeReq({ visibility: "circle" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(status(res), 403);
  assert.match(body(res).error, /not your review/i);
});

test("PATCH /reviews/[id]: invalid visibility value returns 400", async () => {
  const { PATCH } = loadRoute(src.byId, {
    db: mockDb(
      { data: { reviewer_name: "Alice" }, error: null },
      { data: null, error: null }
    ),
    authName: "Alice",
  });
  const res = await PATCH(
    makeReq({ visibility: "everyone" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(status(res), 400);
  assert.match(body(res).error, /visibility/i);
});

test("PATCH /reviews/[id]: body shorter than 5 chars returns 400", async () => {
  const { PATCH } = loadRoute(src.byId, {
    db: mockDb({ data: { reviewer_name: "Alice" }, error: null }),
    authName: "Alice",
  });
  const res = await PATCH(
    makeReq({ body: "meh" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(status(res), 400);
});

test("PATCH /reviews/[id]: owner can update visibility", async () => {
  const { PATCH } = loadRoute(src.byId, {
    db: mockDb(
      { data: { reviewer_name: "Alice" }, error: null },
      { data: null, error: null }
    ),
    authName: "Alice",
  });
  const res = await PATCH(
    makeReq({ visibility: "circle" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(status(res), 200);
  assert.equal(body(res).ok, true);
});

test("PATCH /reviews/[id]: refreshing items replaces backend-owned dish mentions", async () => {
  const calls = [];
  const items = [{ name: "Chiken Biryani", rating: 4 }];
  const { PATCH } = loadRoute(src.byId, {
    db: mockDb(
      { data: { reviewer_name: "Alice", restaurant_id: "google-place-1" }, error: null },
      { data: null, error: null }
    ),
    authName: "Alice",
    dishIdentity: {
      replaceReviewDishMentions: async (_db, input) => {
        calls.push(input);
        return { ok: true, rows: [] };
      }
    }
  });
  const res = await PATCH(
    makeReq({ items }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );

  assert.equal(status(res), 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].reviewId, "11111111-1111-4111-8111-111111111111");
  assert.equal(calls[0].userId, "uid-alice");
  assert.equal(calls[0].placeId, "google-place-1");
  assert.deepEqual(calls[0].submittedItems, items);
});

test("PATCH /reviews/[id]: media transition failure is fail-closed", async () => {
  const db = mockDb({ data: { reviewer_name: "Alice" }, error: null });
  db.rpc = async () => ({ data: null, error: { message: "review_media_requires_private_backfill" } });
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  const res = await PATCH(
    makeReq({ visibility: "circle" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(status(res), 409);
  assert.match(body(res).error, /privately migrated/i);
});

test("PATCH /reviews/[id]: review not found returns 404", async () => {
  const { PATCH } = loadRoute(src.byId, {
    db: mockDb({ data: null, error: null }),
    authName: "Alice",
  });
  const res = await PATCH(
    makeReq({ visibility: "public" }),
    { params: Promise.resolve({ id: "99999999-9999-4999-8999-999999999999" }) }
  );
  assert.equal(status(res), 404);
});

test("POST /reviews: write goes through the admin client, not the SSR session client", async () => {
  const sessionDb = capturingDb({ data: null, error: null });
  const adminDb = capturingDb();
  const { POST } = loadRoute(src.create, { db: sessionDb, adminDb, authName: "Alice" });
  const res = await POST(makeReq(VALID_BODY));
  assert.equal(status(res), 200);
  assert.ok(adminDb._inserted, "admin client should have received the insert");
  assert.equal(adminDb._inserted.reviewer_name, "Alice");
  assert.equal(sessionDb._inserted, undefined, "SSR session client should not have received the insert");
});
