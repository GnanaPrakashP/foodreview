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
    { data: { user: null }, error: null },
    { data: profiles, error: null }
  );
  const { route } = loadRoute({ db });

  const res = await route.GET({}, routeParams("target-id"));

  assert.equal(status(res), 401);
  assert.equal(body(res).error, "Authentication required");
});

test("common restaurants route: requires viewer profile name", async () => {
  const db = spyDb(
    { data: { user: { id: "unknown-id", user_metadata: {} } }, error: null },
    { data: profiles, error: null }
  );
  const { route } = loadRoute({ db });

  const res = await route.GET({}, routeParams("target-id"));

  assert.equal(status(res), 400);
  assert.equal(body(res).error, "Viewer profile is missing a name");
});

test("common restaurants route: returns 404 for unknown target", async () => {
  const db = spyDb(
    { data: { user: { id: "viewer-id", user_metadata: {} } }, error: null },
    { data: profiles, error: null }
  );
  const { route } = loadRoute({ db });

  const res = await route.GET({}, routeParams("not-real"));

  assert.equal(status(res), 404);
  assert.equal(body(res).error, "Target user not found");
});

test("common restaurants route: rejects comparing a user with themselves", async () => {
  const db = spyDb(
    { data: { user: { id: "viewer-id", user_metadata: {} } }, error: null },
    { data: profiles, error: null }
  );
  const { route } = loadRoute({ db });

  const res = await route.GET({}, routeParams("alice"));

  assert.equal(status(res), 400);
  assert.equal(body(res).error, "Target user must be a different account");
});

test("common restaurants route: resolves encoded full-name targets and passes both circle directions", async () => {
  const reviews = [
    { id: "review-1", reviewer_name: "Alice Ate", restaurant_name: "Cafe One", visibility: "public" },
    { id: "review-2", reviewer_name: "Charlie Chef", restaurant_name: "Cafe One", visibility: "public" },
  ];
  const db = spyDb(
    { data: { user: { id: "viewer-id", user_metadata: {} } }, error: null },
    { data: profiles, error: null },
    { data: reviews, error: null }
  );
  const { route, hasCircleAccessCalls, computeCalls } = loadRoute({
    db,
    access: {
      "Charlie Chef:Alice Ate": true,
      "Alice Ate:Charlie Chef": false,
    },
  });

  const res = await route.GET({}, routeParams("Charlie%20Chef"));

  assert.equal(status(res), 200);
  assert.equal(body(res).targetUserId, "space-id");
  assert.equal(body(res).commonRestaurantCount, 1);
  assert.deepEqual(hasCircleAccessCalls, [
    { ownerName: "Charlie Chef", viewerName: "Alice Ate" },
    { ownerName: "Alice Ate", viewerName: "Charlie Chef" },
  ]);
  assert.equal(computeCalls[0].firstUserName, "Alice Ate");
  assert.equal(computeCalls[0].secondUserName, "Charlie Chef");
  assert.equal(computeCalls[0].options.firstCanSeeSecondCircle, true);
  assert.equal(computeCalls[0].options.secondCanSeeFirstCircle, false);
  const reviewNameFilter = opArgs(db._calls.find((call) => call.table === "reviews"), "in");
  assert.equal(reviewNameFilter[0], "reviewer_name");
  assert.equal(reviewNameFilter[1][0], "Alice Ate");
  assert.equal(reviewNameFilter[1][1], "Charlie Chef");
});

test("common restaurants route: can resolve target by id and username", async () => {
  for (const target of ["target-id", "bob"]) {
    const db = spyDb(
      { data: { user: { id: "viewer-id", user_metadata: {} } }, error: null },
      { data: profiles, error: null },
      { data: [], error: null }
    );
    const { route } = loadRoute({ db });

    const res = await route.GET({}, routeParams(target));

    assert.equal(status(res), 200);
    assert.equal(body(res).targetUserId, "target-id");
  }
});
