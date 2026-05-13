import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

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

function eqFilters(entry) {
  return Object.fromEntries(
    entry.ops.filter(([op]) => op === "eq").map(([, col, val]) => [col, val])
  );
}

function hasOp(entry, name) {
  return entry.ops.some(([op]) => op === name);
}

function loadRoute({
  admin = spyDb(),
  viewer = { id: "viewer-id", name: "Alice" },
  fallbackProfileName = "Alice",
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
    getAuthenticatedProfileName: async () => fallbackProfileName,
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
      if (id === "@/lib/types") return {};
      if (id === "@/lib/supabase/admin") return { createAdminClient: () => admin };
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
    id: "review-1",
    reviewer_name: "Bob",
    restaurant_name: "Cafe One",
    visibility: "public",
    ...overrides,
  };
}

function actorProfile(firstName = "Alice", lastName = "Ate") {
  return { data: { first_name: firstName, last_name: lastName }, error: null };
}

test("events: logged-out direct API call is rejected", async () => {
  const { route } = loadRoute({ viewer: null });

  const res = await route.POST(makeReq({ event: "POST_LIKED", reviewId: "review-1", actorName: "Alice" }));

  assert.equal(status(res), 401);
  assert.equal(body(res).error, "Unauthorized");
});

test("events: forged actorName is rejected before notification work", async () => {
  const admin = spyDb();
  const { route, calls } = loadRoute({ admin, viewer: { id: "viewer-id", name: "Alice" } });

  const res = await route.POST(makeReq({ event: "POST_LIKED", reviewId: "review-1", actorName: "Mallory" }));

  assert.equal(status(res), 400);
  assert.equal(body(res).error, "Invalid actor");
  assert.equal(admin._calls.length, 0);
  assert.equal(calls.createPostLikeNotification.length, 0);
});

test("events: actorName falls back to authenticated profile name when viewer name is missing", async () => {
  const admin = spyDb(
    actorProfile(),
    { data: review(), error: null },
    { data: { id: "like-1" }, error: null }
  );
  const { route, calls } = loadRoute({
    admin,
    viewer: { id: "viewer-id", name: "" },
    fallbackProfileName: "Alice",
  });

  const res = await route.POST(makeReq({ event: "POST_LIKED", reviewId: "review-1" }));

  assert.equal(status(res), 200);
  assert.equal(calls.createPostLikeNotification.length, 1);
  assert.equal(calls.createPostLikeNotification[0][2], "Alice");
  assert.equal(calls.createPostLikeNotification[0][3], "Alice Ate");
});

test("events: POST_LIKED creates a notification only after matching like row exists", async () => {
  const admin = spyDb(
    actorProfile(),
    { data: review(), error: null },
    { data: { id: "like-1" }, error: null }
  );
  const { route, calls } = loadRoute({ admin });

  const res = await route.POST(makeReq({ event: "POST_LIKED", reviewId: "review-1", actorName: "Alice" }));

  assert.equal(status(res), 200);
  assert.equal(calls.createPostLikeNotification.length, 1);
  assert.equal(calls.createPostLikeNotification[0][1].id, "review-1");
  assert.equal(calls.createPostLikeNotification[0][2], "Alice");
  assert.equal(calls.createPostLikeNotification[0][3], "Alice Ate");
  assert.equal(eqFilters(admin._calls[2]).post_id, "review-1");
  assert.equal(eqFilters(admin._calls[2]).user_name, "Alice");
});

test("events: POST_LIKED skips notification when like row is stale or missing", async () => {
  const admin = spyDb(
    actorProfile(),
    { data: review(), error: null },
    { data: null, error: null }
  );
  const { route, calls } = loadRoute({ admin });

  const res = await route.POST(makeReq({ event: "POST_LIKED", reviewId: "review-1", actorName: "Alice" }));

  assert.equal(status(res), 200);
  assert.equal(calls.createPostLikeNotification.length, 0);
});

test("events: POST_COMMENTED rejects comments that do not belong to the authenticated actor", async () => {
  const admin = spyDb(
    actorProfile(),
    { data: review(), error: null },
    {
      data: {
        id: "comment-1",
        post_id: "review-1",
        user_name: "Mallory",
        content: "Forged",
        created_at: "2026-01-02T00:00:00.000Z",
      },
      error: null,
    }
  );
  const { route, calls } = loadRoute({ admin });

  const res = await route.POST(makeReq({
    event: "POST_COMMENTED",
    reviewId: "review-1",
    commentId: "comment-1",
    actorName: "Alice",
  }));

  assert.equal(status(res), 404);
  assert.equal(calls.createPostCommentNotifications.length, 0);
});

test("events: POST_COMMENTED creates notifications with prior commenters for a real actor comment", async () => {
  const admin = spyDb(
    actorProfile(),
    { data: review(), error: null },
    {
      data: {
        id: "comment-1",
        post_id: "review-1",
        user_name: "Alice",
        content: "Looks great",
        created_at: "2026-01-02T00:00:00.000Z",
      },
      error: null,
    },
    { data: [{ user_name: "Charlie" }, { user_name: "Dana" }], error: null }
  );
  const { route, calls } = loadRoute({ admin });

  const res = await route.POST(makeReq({
    event: "POST_COMMENTED",
    reviewId: "review-1",
    commentId: "comment-1",
    actorName: "Alice",
  }));

  assert.equal(status(res), 200);
  assert.equal(calls.createPostCommentNotifications.length, 1);
  assert.deepEqual(calls.createPostCommentNotifications[0][4], ["Charlie", "Dana"]);
  assert.equal(calls.createPostCommentNotifications[0][5], "Alice Ate");
  assert.equal(eqFilters(admin._calls[2]).id, "comment-1");
  assert.equal(eqFilters(admin._calls[2]).post_id, "review-1");
  assert.equal(hasOp(admin._calls[3], "lt"), true);
});

test("events: CIRCLE_POST_CREATED rejects posts not owned by the actor", async () => {
  const admin = spyDb(actorProfile(), { data: review({ reviewer_name: "Bob" }), error: null });
  const { route, calls } = loadRoute({ admin });

  const res = await route.POST(makeReq({ event: "CIRCLE_POST_CREATED", reviewId: "review-1", actorName: "Alice" }));

  assert.equal(status(res), 400);
  assert.equal(body(res).error, "Invalid actor");
  assert.equal(calls.createCirclePostNotifications.length, 0);
});

test("events: CIRCLE_POST_CREATED notifies only for actor-owned posts", async () => {
  const admin = spyDb(actorProfile(), { data: review({ reviewer_name: "Alice" }), error: null });
  const { route, calls } = loadRoute({ admin });

  const res = await route.POST(makeReq({ event: "CIRCLE_POST_CREATED", reviewId: "review-1", actorName: "Alice" }));

  assert.equal(status(res), 200);
  assert.equal(calls.createCirclePostNotifications.length, 1);
  assert.equal(calls.createCirclePostNotifications[0][1].reviewer_name, "Alice");
});

test("events: unsupported event returns 400 without fetching the review", async () => {
  const admin = spyDb(
    actorProfile(),                   // actor display-name lookup (always happens)
    { data: review(), error: null }   // review fetch — must NOT be consumed
  );
  const { route } = loadRoute({ admin });

  const res = await route.POST(makeReq({ event: "NOT_REAL", reviewId: "review-1", actorName: "Alice" }));

  assert.equal(status(res), 400);
  assert.equal(body(res).error, "Unsupported event");
  assert.equal(
    admin._calls.find((c) => c.table === "reviews"),
    undefined,
    "should not query the reviews table for an unsupported event"
  );
});
