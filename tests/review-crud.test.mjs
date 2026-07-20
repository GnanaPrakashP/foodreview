/**
 * Payload-correctness tests for:
 *   POST   /api/reviews          (create)
 *   PATCH  /api/reviews/[id]     (edit)
 *   DELETE /api/reviews/[id]     (delete)
 *
 * These tests verify what is actually written to / deleted from the database —
 * not just the HTTP response code but the exact row values and query filters.
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

function spyDb(...responses) {
  let idx = 0;
  const calls = [];
  let authNameForIntents = "Alice";
  const createdReviewId = responses[0]?.data?.id ?? "11111111-1111-4111-8111-111111111111";
  return {
    get _calls() { return calls; },
    _setAuthName(name) { authNameForIntents = name || "Alice"; },
    rpc(name, args) {
      calls.push({ table: `rpc:${name}`, ops: [["rpc", args]] });
      return Promise.resolve({ data: true, error: null });
    },
    storage: {
      from() {
        return {
          getPublicUrl: (path) => ({ data: { publicUrl: `https://storage.test/${path}` } }),
          remove: async () => ({ data: [], error: null }),
        };
      },
    },
    from(table) {
      const entry = { table, ops: [] };
      calls.push(entry);
      const next = () => {
        if (table === "media_assets") {
          return Promise.resolve({ data: [validIntentFor(authNameForIntents)], error: null });
        }
        if (table === "media_derivatives") {
          const asset = validIntentFor(authNameForIntents);
          return Promise.resolve({ data: [{ asset_id: asset.id, kind: "canonical", bucket_id: "media-private", storage_path: `private-posts/${asset.owner_id}/${asset.id}/canonical.jpg`, public_url: null, mime_type: "image/jpeg", width: 1080, height: 1350, duration_ms: null, file_size_bytes: 1234, blurhash: null }], error: null });
        }
        if (table === "review_media_upload_intents") {
          return Promise.resolve({ data: [], error: null });
        }
        const publishesDraft = table === "reviews" && entry.ops.some(
          ([operation, value]) => operation === "update" && value?.status === "active"
        );
        if (publishesDraft) {
          return Promise.resolve({ data: { id: createdReviewId }, error: null });
        }
        return Promise.resolve(responses[idx++] ?? { data: null, error: null });
      };
      const chain = {
        then(res, rej) { return next().then(res, rej); },
        catch(rej) { return next().catch(rej); },
      };
      for (const m of [
        "select", "eq", "limit", "insert", "delete",
        "update", "single", "maybeSingle", "order", "in", "upsert",
        "returns",
      ]) {
        chain[m] = (...args) => { entry.ops.push([m, ...args]); return chain; };
      }
      return chain;
    },
  };
}

function validIntentFor(authName) {
  const userId = `uid-${authName.toLowerCase().replace(/\s/g, "-")}`;
  return {
    access_class: "public_post",
    consumed_at: null,
    duration_ms: null,
    file_size_bytes: 1234,
    id: "11111111-1111-4111-8111-111111111112",
    media_type: "image",
    moderation_status: "approved",
    original_mime_type: "image/jpeg",
    owner_id: userId,
    owner_name: authName,
    privacy_state: "stable",
    status: "ready",
    surface: "post",
  };
}

function insertArg(calls) {
  for (const entry of calls) {
    const op = entry.ops.find(([m]) => m === "insert");
    if (op) return op[1];
  }
  return undefined;
}

function updateArg(calls) {
  for (const entry of calls) {
    const op = entry.ops.find(([m]) => m === "update");
    if (op) return op[1];
  }
  return undefined;
}

function rpcArg(calls) {
  return calls.find((entry) => entry.table === "rpc:set_review_visibility_with_media_access")?.ops[0]?.[1];
}

function eqFilters(entry) {
  return Object.fromEntries(
    entry.ops.filter(([op]) => op === "eq").map(([, col, val]) => [col, val])
  );
}

const mockNextResponse = {
  json(b, opts) { return { _body: b, _status: opts?.status ?? 200 }; },
};

function makeReq(b) { return { json: async () => b }; }
function body(res) { return res._body; }
function status(res) { return res._status; }

function loadRoute(code, { db, authName }) {
  db?._setAuthName?.(authName);
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
      if (id === "@/lib/supabase/admin") return { createAdminClient: () => db };
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
        return { replaceReviewDishMentions: async () => ({ ok: true, rows: [] }) };
      }
      if (id === "@/lib/circle-auth") {
        return {
          getAuthenticatedCircleActor: async () =>
            authName
              ? { userId: `uid-${authName.toLowerCase().replace(/\s/g, "-")}`, actorName: authName }
              : null,
        };
      }
      throw new Error(`Unexpected require in review-crud tests: ${id}`);
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

// ── POST /api/reviews — create payload ────────────────────────────────────────

test("CREATE: reviewer_name is always the authenticated actor, not request body", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice Smith" });
  const res = await POST(makeReq({ ...VALID_BODY, reviewerName: "Mallory" }));
  assert.equal(status(res), 200);
  const row = insertArg(db._calls);
  assert.ok(row, "Expected an insert call");
  assert.equal(row.reviewer_name, "Alice Smith");
  assert.notEqual(row.reviewer_name, "Mallory");
});

test("CREATE: restaurant_name in inserted row is trimmed", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({ ...VALID_BODY, restaurantName: "  Bawarchi  " }));
  const row = insertArg(db._calls);
  assert.equal(row.restaurant_name, "Bawarchi");
});

test("CREATE: body field is null when empty string", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({ ...VALID_BODY, body: "" }));
  const row = insertArg(db._calls);
  assert.equal(row.body, null);
});

test("CREATE: body field is null when whitespace-only", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({ ...VALID_BODY, body: "   " }));
  const row = insertArg(db._calls);
  assert.equal(row.body, null);
});

test("CREATE: blank item names are stripped before insert", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({
    ...VALID_BODY,
    items: [{ name: "Biryani", rating: 5 }, { name: "   " }],
  }));
  const row = insertArg(db._calls);
  assert.equal(row.items.length, 1);
  assert.equal(row.items[0].name, "Biryani");
});

test("CREATE: item names are trimmed in inserted row", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({
    ...VALID_BODY,
    items: [{ name: "  Mutton Biryani  ", rating: 4 }],
  }));
  const row = insertArg(db._calls);
  assert.equal(row.items[0].name, "Mutton Biryani");
});

test("CREATE: item rating out of [1,5] range is rejected", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, items: [{ name: "Biryani", rating: 6 }] }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /rating/i);
  assert.equal(insertArg(db._calls), undefined);
});

test("CREATE: item rating below 1 is rejected", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq({ ...VALID_BODY, items: [{ name: "Biryani", rating: 0 }] }));
  assert.equal(status(res), 400);
  assert.match(body(res).error, /rating/i);
  assert.equal(insertArg(db._calls), undefined);
});

test("CREATE: missing item rating is stored as 0", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({ ...VALID_BODY, items: [{ name: "Biryani" }] }));
  const row = insertArg(db._calls);
  assert.equal(row.items[0].rating, 0);
});

test("CREATE: valid item rating within [1,5] is stored as-is", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({ ...VALID_BODY, items: [{ name: "Biryani", rating: 4 }] }));
  const row = insertArg(db._calls);
  assert.equal(row.items[0].rating, 4);
});

test("CREATE: visibility=public is stored correctly", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({ ...VALID_BODY, visibility: "public" }));
  assert.equal(insertArg(db._calls).visibility, "public");
});

test("CREATE: visibility=circle is stored correctly", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({ ...VALID_BODY, visibility: "circle" }));
  assert.equal(insertArg(db._calls).visibility, "circle");
});

test("CREATE: visibility=me is stored correctly", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({ ...VALID_BODY, visibility: "me" }));
  assert.equal(insertArg(db._calls).visibility, "me");
});

test("CREATE: selected Google Places metadata is stored with the review", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  const res = await POST(makeReq({
    ...VALID_BODY,
    restaurantId: "places-bawarchi-gachibowli",
    area: "  Gachibowli, Hyderabad  ",
    restaurantAddress: "  Gachibowli, Hyderabad, Telangana 500032, India  ",
    restaurantLat: 17.4239,
    restaurantLng: 78.4738,
  }));

  assert.equal(status(res), 200);
  const row = insertArg(db._calls);
  assert.equal(row.restaurant_id, "places-bawarchi-gachibowli");
  assert.equal(row.area, "Gachibowli, Hyderabad");
  assert.equal(row.restaurant_address, "Gachibowli, Hyderabad, Telangana 500032, India");
  assert.equal(row.restaurant_lat, 17.4239);
  assert.equal(row.restaurant_lng, 78.4738);
});

test("CREATE: invalid coordinate types are stored as null", async () => {
  const db = spyDb({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
  const { POST } = loadRoute(src.create, { db, authName: "Alice" });
  await POST(makeReq({
    ...VALID_BODY,
    restaurantId: "places-bawarchi",
    restaurantLat: "17.4239",
    restaurantLng: { value: 78.4738 },
  }));

  const row = insertArg(db._calls);
  assert.equal(row.restaurant_lat, null);
  assert.equal(row.restaurant_lng, null);
});

// ── DELETE /api/reviews/[id] — double-filter guard ────────────────────────────

test("DELETE: DB call uses both id and reviewer_name as eq filters", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null }, // ownership check
    { data: null, error: null }                          // delete
  );
  const { DELETE } = loadRoute(src.byId, { db, authName: "Alice" });
  const res = await DELETE(makeReq({}), { params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }) });
  assert.equal(status(res), 200);
  const deleteEntry = db._calls.find((c) => c.ops.some(([m]) => m === "delete"));
  assert.ok(deleteEntry, "Expected a delete call");
  const filters = eqFilters(deleteEntry);
  assert.equal(filters.id, "22222222-2222-4222-8222-222222222222");
  assert.equal(filters.reviewer_name, "Alice");
});

// ── PATCH /api/reviews/[id] — update payload ─────────────────────────────────

test("PATCH: transition owner is derived from auth, never the request body", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  await PATCH(
    makeReq({ visibility: "circle", reviewerName: "Mallory" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  const transition = rpcArg(db._calls);
  assert.equal(transition.p_owner_name, "Alice");
  assert.notEqual(transition.p_owner_name, "Mallory");
});

test("PATCH: visibility is passed to the atomic media transition RPC", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  await PATCH(
    makeReq({ visibility: "me" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(rpcArg(db._calls).p_visibility, "me");
});

test("PATCH: body is stored as null when whitespace-only", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  await PATCH(
    makeReq({ body: "   " }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(updateArg(db._calls).body, null);
});

test("PATCH: atomic transition binds both review id and authenticated owner", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  await PATCH(
    makeReq({ visibility: "circle" }),
    { params: Promise.resolve({ id: "77777777-7777-4777-8777-777777777777" }) }
  );
  const transition = rpcArg(db._calls);
  assert.equal(transition.p_review_id, "77777777-7777-4777-8777-777777777777");
  assert.equal(transition.p_owner_name, "Alice");
});

test("PATCH: blank item names are stripped from items update", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  await PATCH(
    makeReq({ items: [{ name: "Biryani" }, { name: "   " }] }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  const updates = updateArg(db._calls);
  assert.equal(updates.items.length, 1);
  assert.equal(updates.items[0].name, "Biryani");
  assert.equal(updates.items[0].rating, 0);
});

test("PATCH: item names and ratings are normalized in the update payload", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  await PATCH(
    makeReq({ items: [{ name: "  Biryani  ", rating: 4 }] }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  const updates = updateArg(db._calls);
  assert.equal(updates.items[0].name, "Biryani");
  assert.equal(updates.items[0].rating, 4);
});

test("PATCH: invalid item rating is rejected before update", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  const res = await PATCH(
    makeReq({ items: [{ name: "Biryani", rating: 6 }] }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(status(res), 400);
  assert.match(body(res).error, /rating/i);
  assert.equal(updateArg(db._calls), undefined);
});

test("PATCH: visibility-only transition does not perform a second non-atomic review update", async () => {
  const db = spyDb(
    { data: { reviewer_name: "Alice" }, error: null },
    { data: null, error: null }
  );
  const { PATCH } = loadRoute(src.byId, { db, authName: "Alice" });
  await PATCH(
    makeReq({ visibility: "public" }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }
  );
  assert.equal(rpcArg(db._calls).p_visibility, "public");
  assert.equal(updateArg(db._calls), undefined);
});
