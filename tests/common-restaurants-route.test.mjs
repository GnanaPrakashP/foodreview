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

const routeSource = transpile(readFileSync(new URL("../app/api/users/[targetUserId]/common-restaurants/route.ts", import.meta.url), "utf8"));

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

function routeParams(targetUserId) {
  return { params: Promise.resolve({ targetUserId }) };
}

function spyDb(...responses) {
  let idx = 0;
  const calls = [];
  return {
    auth: {
      getUser: async () => responses[idx++] ?? { data: { user: null }, error: null },
    },
    get _calls() {
      return calls;
    },
    from(table) {
      const entry = { table, ops: [] };
      calls.push(entry);
      const next = () => Promise.resolve(responses[idx++] ?? { data: [], error: null });
      const chain = {
        then(res, rej) {
          return next().then(res, rej);
        },
        catch(rej) {
          return next().catch(rej);
        },
      };
      for (const m of ["select", "eq", "ilike", "or", "limit", "insert", "delete", "update",
        "order", "in", "is", "single", "maybeSingle", "contains", "returns"]) {
        chain[m] = (...args) => {
          entry.ops.push([m, ...args]);
          return chain;
        };
      }
      return chain;
    },
  };
}

function opArgs(entry, name) {
  const op = entry.ops.find(([opName]) => opName === name);
  return op?.slice(1) ?? [];
}

function loadRoute({ db, access = {}, computeCommonRestaurants } = {}) {
  const hasCircleAccessCalls = [];
  const computeCalls = [];
  const compute = computeCommonRestaurants ?? ((reviews, firstUserName, secondUserName, options) => {
    computeCalls.push({ reviews, firstUserName, secondUserName, options });
    return [{ restaurantId: "r1", name: "Cafe One", thumbnailUrl: null, matchedVia: "public" }];
  });

  const mod = { exports: {} };
  vm.runInNewContext(routeSource, {
    module: mod,
    exports: mod.exports,
    console,
    decodeURIComponent,
    require(id) {
      if (id === "next/server") return { NextRequest: class {}, NextResponse: mockNextResponse };
      if (id === "@/lib/supabase/server") return { createClient: async () => db };
      if (id === "@/lib/server/route-supabase") return {
        getRouteActor: async () => {
          const { data, error } = await db.auth.getUser();
          const user = data?.user;
          if (error || !user) return { actor: null, supabase: db };
          const { data: profile } = await db
            .from("profiles")
            .select("id, username")
            .eq("id", user.id)
            .maybeSingle();
          return {
            actor: {
              userId: user.id,
              actorName: profile?.username ?? "",
              displayName: profile?.username ?? "",
            },
            supabase: db,
          };
        },
      };
      if (id === "@/lib/types") return {};
      if (id === "@/lib/circle-db") {
        return {
          hasCircleAccess: async (_db, ownerName, viewerName) => {
            hasCircleAccessCalls.push({ ownerName, viewerName });
            return Boolean(access[`${ownerName}:${viewerName}`]);
          },
        };
      }
      if (id === "@/lib/common-restaurants") return { computeCommonRestaurants: compute };
      throw new Error(`Unexpected require in common restaurant route tests: ${id}`);
    },
  });
  return { route: mod.exports, hasCircleAccessCalls, computeCalls };
}

const profiles = [
  { id: "viewer-id", first_name: "Alice", last_name: "Ate", username: "alice" },
  { id: "target-id", first_name: "Bob", last_name: "Bites", username: "bob" },
  { id: "space-id", first_name: "Charlie", last_name: "Chef", username: "charlie" },
];

test("common restaurants route: logged-out users are rejected", async () => {
  const db = spyDb(
    { data: { user: null }, error: null }
  );
  const { route } = loadRoute({ db });

  const res = await route.GET({}, routeParams("target-id"));

  assert.equal(status(res), 401);
  assert.equal(body(res).error, "Authentication required");
});

test("common restaurants route: requires viewer profile name", async () => {
  const db = spyDb(
    { data: { user: { id: "unknown-id", user_metadata: {} } }, error: null },
    { data: { id: "unknown-id", username: null }, error: null }
  );
  const { route } = loadRoute({ db });

  const res = await route.GET({}, routeParams("target-id"));

  assert.equal(status(res), 400);
  assert.equal(body(res).error, "Viewer profile is missing a username");
});

test("common restaurants route: returns 404 for unknown target", async () => {
  const db = spyDb(
    { data: { user: { id: "viewer-id", user_metadata: {} } }, error: null },
    { data: profiles[0], error: null },
    { data: null, error: null }
  );
  const { route } = loadRoute({ db });

  const res = await route.GET({}, routeParams("not-real"));

  assert.equal(status(res), 404);
  assert.equal(body(res).error, "Target user not found");
});

test("common restaurants route: rejects comparing a user with themselves", async () => {
  const db = spyDb(
    { data: { user: { id: "viewer-id", user_metadata: {} } }, error: null },
    { data: profiles[0], error: null },
    { data: profiles[0], error: null }
  );
  const { route } = loadRoute({ db });

  const res = await route.GET({}, routeParams("alice"));

  assert.equal(status(res), 400);
  assert.equal(body(res).error, "Target user must be a different account");
});

test("common restaurants route: resolves usernames and passes both circle directions", async () => {
  const reviews = [
    { id: "review-1", reviewer_name: "alice", restaurant_name: "Cafe One", visibility: "public" },
    { id: "review-2", reviewer_name: "charlie", restaurant_name: "Cafe One", visibility: "public" },
  ];
  const db = spyDb(
    { data: { user: { id: "viewer-id", user_metadata: {} } }, error: null },
    { data: profiles[0], error: null },
    { data: profiles[2], error: null },
    { data: reviews, error: null }
  );
  const { route, hasCircleAccessCalls, computeCalls } = loadRoute({
    db,
    access: {
      "charlie:alice": true,
      "alice:charlie": false,
    },
  });

  const res = await route.GET({}, routeParams("charlie"));

  assert.equal(status(res), 200);
  assert.equal(body(res).targetUserId, "space-id");
  assert.equal(body(res).targetUsername, "charlie");
  assert.equal(body(res).commonRestaurantCount, 1);
  assert.deepEqual(hasCircleAccessCalls, [
    { ownerName: "charlie", viewerName: "alice" },
    { ownerName: "alice", viewerName: "charlie" },
  ]);
  assert.equal(computeCalls[0].firstUserName, "alice");
  assert.equal(computeCalls[0].secondUserName, "charlie");
  assert.equal(computeCalls[0].options.firstCanSeeSecondCircle, true);
  assert.equal(computeCalls[0].options.secondCanSeeFirstCircle, false);
  const reviewNameFilter = opArgs(db._calls.find((call) => call.table === "reviews"), "in");
  assert.equal(reviewNameFilter[0], "reviewer_name");
  assert.equal(reviewNameFilter[1][0], "alice");
  assert.equal(reviewNameFilter[1][1], "charlie");
});

test("common restaurants route: can resolve target by id and username", async () => {
  for (const target of ["00000000-0000-0000-0000-0000000000bb", "bob"]) {
    const db = spyDb(
      { data: { user: { id: "viewer-id", user_metadata: {} } }, error: null },
      { data: profiles[0], error: null },
      { data: profiles[1], error: null },
      { data: [], error: null }
    );
    const { route } = loadRoute({ db });

    const res = await route.GET({}, routeParams(target));

    assert.equal(status(res), 200);
    assert.equal(body(res).targetUserId, "target-id");
  }
});

test("common restaurants route: self-compare via UUID resolving to same username returns 400", async () => {
  // Target UUID resolves to the same profile (and therefore same username) as the viewer
  const db = spyDb(
    { data: { user: { id: "viewer-id", user_metadata: {} } }, error: null },
    { data: profiles[0], error: null },                              // viewer: username "alice"
    { data: profiles[0], error: null }                               // target UUID resolves to same "alice"
  );
  const { route } = loadRoute({ db });

  const res = await route.GET({}, routeParams("viewer-id"));

  assert.equal(status(res), 400);
  assert.equal(body(res).error, "Target user must be a different account");
});

test("common restaurants route: two accounts with different usernames are not blocked by self-compare guard", async () => {
  // Both profiles share the same first/last name but have distinct usernames — comparison must proceed
  const twin1 = { id: "twin-1-id", username: "alice_smith" };
  const twin2 = { id: "twin-2-id", username: "alice_jones" };
  const db = spyDb(
    { data: { user: { id: "twin-1-id", user_metadata: {} } }, error: null },
    { data: twin1, error: null },   // viewer: "alice_smith"
    { data: twin2, error: null },   // target: "alice_jones"
    { data: [], error: null }       // reviews
  );
  const { route } = loadRoute({ db });

  const res = await route.GET({}, routeParams("alice_jones"));

  assert.equal(status(res), 200);
  assert.equal(body(res).targetUsername, "alice_jones");
});
