import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createApiSecurityStub } from "./helpers/api-security-stub.mjs";

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

const routeSource = transpile(readFileSync(new URL("../app/api/notifications/events/route.ts", import.meta.url), "utf8"));

const mockNextResponse = {
  json(body, opts) {
    return { _body: body, _status: opts?.status ?? 200 };
  },
};

function body(res) {
  return res._body;
}

function status(res) {
  return res._status;
}

function makeReq(payload) {
  return { json: async () => payload };
}

function spyDb(...responses) {
  let idx = 0;
  const calls = [];
  return {
    get _calls() {
      return calls;
    },
    from(table) {
      const entry = { table, ops: [] };
      calls.push(entry);
      const next = () => Promise.resolve(responses[idx++] ?? { data: null, error: null });
      const chain = {
        then(res, rej) {
          return next().then(res, rej);
        },
        catch(rej) {
          return next().catch(rej);
        },
      };
      for (const m of ["select", "eq", "ilike", "or", "limit", "insert", "delete", "update",
        "order", "in", "is", "single", "maybeSingle", "contains", "lt"]) {
        chain[m] = (...args) => {
          entry.ops.push([m, ...args]);
          return chain;
        };
      }
      return chain;
    },
  };
}

function loadRoute({
  admin = spyDb(),
  viewer = { id: "viewer-id", name: "Alice" },
  notifications = {},
} = {}) {
  const calls = {
    createPostLikeNotification: [],
    createPostCommentNotifications: [],
    createCirclePostNotifications: [],
    removeLikeNotification: [],
    removeCommentNotification: [],
  };
  const notificationFns = {
    createPostLikeNotification: async (...args) => calls.createPostLikeNotification.push(args),
    createPostCommentNotifications: async (...args) => calls.createPostCommentNotifications.push(args),
    createCirclePostNotifications: async (...args) => calls.createCirclePostNotifications.push(args),
    removeLikeNotification: async (...args) => calls.removeLikeNotification.push(args),
    removeCommentNotification: async (...args) => calls.removeCommentNotification.push(args),
    ...notifications,
  };

  const mod = { exports: {} };
  vm.runInNewContext(routeSource, {
    module: mod,
    exports: mod.exports,
    console,
    require(id) {
      if (id === "next/server") return { NextRequest: class {}, NextResponse: mockNextResponse };
      if (id === "@/lib/server/api-security") return createApiSecurityStub({ json: mockNextResponse.json });
      if (id === "@/lib/server/route-supabase") return {
        getRouteActor: async () => ({
          actor: viewer ? { userId: viewer.id, actorName: viewer.name, displayName: viewer.name } : null,
        }),
      };
      if (id === "@/lib/types") return {};
      if (id === "@/lib/selects") {
        return {
          REVIEW_SELECT: "id, reviewer_name, restaurant_id, restaurant_name, area, restaurant_address, restaurant_lat, restaurant_lng, items, body, photo_url, photo_urls, visibility, deleted_at, hidden_at, reported_at, status, created_at",
          COMMENT_SELECT: "id, post_id, user_name, content, created_at",
        };
      }
      if (id === "@/lib/supabase/admin") return { createAdminClient: () => admin };
      if (id === "@/lib/profile-names") {
        return {
          profileDisplayName: (profile, fallback = "") =>
            [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || fallback,
        };
      }
      if (id === "@/lib/notifications") return notificationFns;
      if (id.endsWith("_utils")) {
        return {
          createRouteSupabase: async () => ({}),
          getNotificationViewer: async () => viewer,
          unauthorized: () => mockNextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        };
      }
      throw new Error(`Unexpected require in notification event tests: ${id}`);
    },
  });
  return { route: mod.exports, calls };
}

function review(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    reviewer_name: "Bob",
    restaurant_name: "Cafe One",
    visibility: "public",
    ...overrides,
  };
}

test("events: logged-out direct API call is rejected", async () => {
  const { route } = loadRoute({ viewer: null });

  const res = await route.POST(makeReq({ event: "POST_LIKED", reviewId: "11111111-1111-4111-8111-111111111111", actorName: "Alice" }));

  assert.equal(status(res), 401);
  assert.equal(body(res).error, "Authentication required");
});

test("events: client actorName is ignored and engagement remains server-owned", async () => {
  const admin = spyDb();
  const { route, calls } = loadRoute({ admin, viewer: { id: "viewer-id", name: "Alice" } });

  const res = await route.POST(makeReq({ event: "POST_LIKED", reviewId: "11111111-1111-4111-8111-111111111111", actorName: "Mallory" }));

  assert.equal(status(res), 410);
  assert.match(body(res).error, /mutation routes/i);
  assert.equal(admin._calls.length, 0);
  assert.equal(calls.createPostLikeNotification.length, 0);
});

test("events: canonical actor name owns circle post events", async () => {
  const admin = spyDb(
    { data: review({ reviewer_name: "Alice" }), error: null }
  );
  const { route, calls } = loadRoute({
    admin,
    viewer: { id: "viewer-id", name: "Alice" },
  });

  const res = await route.POST(makeReq({ event: "CIRCLE_POST_CREATED", reviewId: "11111111-1111-4111-8111-111111111111" }));

  assert.equal(status(res), 200);
  assert.equal(calls.createCirclePostNotifications.length, 1);
});

test("events: engagement notifications are owned by mutation routes", async () => {
  const admin = spyDb();
  const { route, calls } = loadRoute({ admin });

  const liked = await route.POST(makeReq({ event: "POST_LIKED", reviewId: "11111111-1111-4111-8111-111111111111", actorName: "Alice" }));
  const commented = await route.POST(makeReq({
    event: "POST_COMMENTED",
    reviewId: "11111111-1111-4111-8111-111111111111",
    commentId: "comment-1",
    actorName: "Alice",
  }));

  assert.equal(status(liked), 410);
  assert.equal(status(commented), 410);
  assert.match(body(liked).error, /mutation routes/i);
  assert.equal(calls.createPostLikeNotification.length, 0);
  assert.equal(calls.createPostCommentNotifications.length, 0);
  assert.equal(admin._calls.filter((c) => c.table === "likes" || c.table === "comments" || c.table === "reviews").length, 0);
});

test("events: CIRCLE_POST_CREATED rejects posts not owned by the actor", async () => {
  const admin = spyDb({ data: review({ reviewer_name: "Bob" }), error: null });
  const { route, calls } = loadRoute({ admin });

  const res = await route.POST(makeReq({ event: "CIRCLE_POST_CREATED", reviewId: "11111111-1111-4111-8111-111111111111", actorName: "Alice" }));

  assert.equal(status(res), 400);
  assert.equal(body(res).error, "Invalid actor");
  assert.equal(calls.createCirclePostNotifications.length, 0);
});

test("events: CIRCLE_POST_CREATED notifies only for actor-owned posts", async () => {
  const admin = spyDb({ data: review({ reviewer_name: "Alice" }), error: null });
  const { route, calls } = loadRoute({ admin });

  const res = await route.POST(makeReq({ event: "CIRCLE_POST_CREATED", reviewId: "11111111-1111-4111-8111-111111111111", actorName: "Alice" }));

  assert.equal(status(res), 200);
  assert.equal(calls.createCirclePostNotifications.length, 1);
  assert.equal(calls.createCirclePostNotifications[0][1].reviewer_name, "Alice");
});

test("events: unsupported event returns 400 without fetching the review", async () => {
  const admin = spyDb({ data: review(), error: null });
  const { route } = loadRoute({ admin });

  const res = await route.POST(makeReq({ event: "NOT_REAL", reviewId: "11111111-1111-4111-8111-111111111111", actorName: "Alice" }));

  assert.equal(status(res), 400);
  assert.equal(body(res).error, "Unsupported event");
  assert.equal(
    admin._calls.find((c) => c.table === "reviews"),
    undefined,
    "should not query the reviews table for an unsupported event"
  );
});
