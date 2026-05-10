import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// ---- module loader ----

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

function loadModule(relPath, requireMap) {
  const url = new URL(relPath, import.meta.url);
  const src = readFileSync(url, "utf8");
  const code = transpile(src);
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    console,
    require(id) {
      if (id in requireMap) return requireMap[id];
      throw new Error(`Unexpected require in circle tests: ${id}`);
    },
  });
  return mod.exports;
}

// ---- load lib/circle.ts ----

const circle = loadModule("../lib/circle.ts", {
  "@/lib/types": {},
  "@/lib/visibility": { canShowInCircleTrending: () => false },
});

// ---- load lib/circle-db.ts ----

const circleDb = loadModule("../lib/circle-db.ts", {
  "@/lib/types": {},
  "@/lib/circle": {
    DEFAULT_ACCOUNT_TYPE: "public",
    normalizeAccountType: circle.normalizeAccountType,
  },
});

const {
  hasCircleEdge,
  hasCircleAccess,
  getAccountTypeForName,
  getAccountTypesForNames,
  getCircleRelationshipsForName,
  addCircleEdge,
  addMutualCircleEdges,
} = circleDb;

// ---- mock db factory ----
// Responses are consumed in order as db.from() calls are awaited.

function mockDb(...responses) {
  let idx = 0;
  return {
    from(_table) {
      const next = () => Promise.resolve(responses[idx++] ?? { data: [], error: null });
      const chain = {
        then(res, rej) { return next().then(res, rej); },
        catch(rej) { return next().catch(rej); },
      };
      for (const m of ["select", "eq", "ilike", "or", "limit", "insert", "delete", "update"]) {
        chain[m] = () => chain;
      }
      return chain;
    },
  };
}

// ======================================================
// lib/circle.ts — pure functions
// ======================================================

test("normalizeAccountType: only 'private' maps to private", () => {
  assert.equal(circle.normalizeAccountType("private"), "private");
  assert.equal(circle.normalizeAccountType("public"), "public");
  assert.equal(circle.normalizeAccountType(null), "public");
  assert.equal(circle.normalizeAccountType(undefined), "public");
  assert.equal(circle.normalizeAccountType(""), "public");
  assert.equal(circle.normalizeAccountType("PRIVATE"), "public"); // case-sensitive
});

test("accountTypeLabel: correct display strings", () => {
  assert.equal(circle.accountTypeLabel("public"), "Public Account");
  assert.equal(circle.accountTypeLabel("private"), "Private Account");
});

test("relationshipLabel: correct display strings", () => {
  assert.equal(circle.relationshipLabel("PENDING"), "Requested");
  assert.equal(circle.relationshipLabel("CIRCLE_MUTUAL"), "Mutual Circle");
  assert.equal(circle.relationshipLabel("CIRCLE_ONE_WAY"), "In Circle");
  assert.equal(circle.relationshipLabel("NONE"), "Not in Circle");
});

// ======================================================
// hasCircleEdge
// ======================================================

test("hasCircleEdge: true when row exists", async () => {
  const db = mockDb({ data: [{ id: "1" }], error: null });
  assert.equal(await hasCircleEdge(db, "Alice", "Bob"), true);
});

test("hasCircleEdge: false when no rows returned", async () => {
  const db = mockDb({ data: [], error: null });
  assert.equal(await hasCircleEdge(db, "Alice", "Bob"), false);
});

test("hasCircleEdge: false on db error", async () => {
  const db = mockDb({ data: null, error: { message: "db error", code: "500" } });
  assert.equal(await hasCircleEdge(db, "Alice", "Bob"), false);
});

// ======================================================
// getAccountTypeForName
// ======================================================

test("getAccountTypeForName: public when profile not found", async () => {
  const db = mockDb({ data: [], error: null });
  assert.equal(await getAccountTypeForName(db, "Ghost User"), "public");
});

test("getAccountTypeForName: private when profile has account_type 'private'", async () => {
  const db = mockDb({
    data: [{ first_name: "Alice", last_name: "Smith", account_type: "private" }],
    error: null,
  });
  assert.equal(await getAccountTypeForName(db, "Alice Smith"), "private");
});

test("getAccountTypeForName: public when account_type is null", async () => {
  const db = mockDb({
    data: [{ first_name: "Bob", last_name: "Jones", account_type: null }],
    error: null,
  });
  assert.equal(await getAccountTypeForName(db, "Bob Jones"), "public");
});

test("getAccountTypeForName: disambiguates by full name when first name matches multiple rows", async () => {
  const rows = [
    { first_name: "Alice", last_name: "Smith", account_type: "public" },
    { first_name: "Alice", last_name: "Wonder", account_type: "private" },
  ];
  assert.equal(await getAccountTypeForName(mockDb({ data: rows, error: null }), "Alice Wonder"), "private");
  assert.equal(await getAccountTypeForName(mockDb({ data: rows, error: null }), "Alice Smith"), "public");
});

// ======================================================
// getAccountTypesForNames
// ======================================================

test("getAccountTypesForNames: empty input returns empty object without querying db", async () => {
  const result = await getAccountTypesForNames(mockDb(), []);
  assert.equal(Object.keys(result).length, 0);
});

test("getAccountTypesForNames: unmatched names default to public", async () => {
  const db = mockDb({ data: [], error: null });
  const result = await getAccountTypesForNames(db, ["Ghost One", "Ghost Two"]);
  assert.equal(result["Ghost One"], "public");
  assert.equal(result["Ghost Two"], "public");
  assert.equal(Object.keys(result).length, 2);
});

test("getAccountTypesForNames: returns correct types for found and missing names", async () => {
  const db = mockDb({
    data: [
      { first_name: "Alice", last_name: "Smith", account_type: "private" },
      { first_name: "Bob", last_name: "Jones", account_type: null },
    ],
    error: null,
  });
  const result = await getAccountTypesForNames(db, ["Alice Smith", "Bob Jones", "Ghost User"]);
  assert.equal(result["Alice Smith"], "private");
  assert.equal(result["Bob Jones"], "public");
  assert.equal(result["Ghost User"], "public");
});

test("getAccountTypesForNames: deduplicates input names", async () => {
  const db = mockDb({ data: [{ first_name: "Alice", last_name: "Smith", account_type: "private" }], error: null });
  const result = await getAccountTypesForNames(db, ["Alice Smith", "Alice Smith"]);
  assert.equal(result["Alice Smith"], "private");
});

// ======================================================
// hasCircleAccess
// ======================================================

test("hasCircleAccess: false for empty owner name", async () => {
  assert.equal(await hasCircleAccess(mockDb(), "", "Bob"), false);
});

test("hasCircleAccess: false for empty viewer name", async () => {
  assert.equal(await hasCircleAccess(mockDb(), "Alice", ""), false);
});

test("hasCircleAccess: true when owner and viewer are the same person", async () => {
  assert.equal(await hasCircleAccess(mockDb(), "Alice", "Alice"), true);
});

test("hasCircleAccess: true when direct circle edge exists", async () => {
  // hasCircleEdge: edge found — short-circuits without checking requests
  const db = mockDb({ data: [{ id: "1" }], error: null });
  assert.equal(await hasCircleAccess(db, "Alice", "Bob"), true);
});

test("hasCircleAccess: false when only accepted circle request exists (A→B direction)", async () => {
  const db = mockDb(
    { data: [], error: null },            // hasCircleEdge: no edge
    { data: [{ id: "1" }], error: null }  // stale accepted request: ignored
  );
  assert.equal(await hasCircleAccess(db, "Alice", "Bob"), false);
});

test("hasCircleAccess: false when only accepted circle request exists (B→A direction)", async () => {
  const db = mockDb(
    { data: [], error: null }, // hasCircleEdge: no edge
    { data: [{ id: "2" }], error: null } // stale accepted request: ignored
  );
  assert.equal(await hasCircleAccess(db, "Alice", "Bob"), false);
});

test("hasCircleAccess: false when no membership edge exists", async () => {
  const db = mockDb({ data: [], error: null });
  assert.equal(await hasCircleAccess(db, "Alice", "Bob"), false);
});

// ======================================================
// getCircleRelationshipsForName
// ======================================================

test("getCircleRelationshipsForName: empty name returns all empty sets", async () => {
  const r = await getCircleRelationshipsForName(mockDb(), "");
  assert.equal(r.circleMembers.size, 0);
  assert.equal(r.joinedCircles.size, 0);
  assert.equal(r.mutualMembers.size, 0);
});

test("getCircleRelationshipsForName: populates circleMembers and joinedCircles from edge rows", async () => {
  // Alice owns circle with Bob, Charlie; Dave has Alice in his circle
  const db = mockDb(
    {
      data: [
        { user_name: "Alice", member_name: "Bob" },
        { user_name: "Alice", member_name: "Charlie" },
        { user_name: "Dave", member_name: "Alice" },
      ],
      error: null,
    },
    { data: [], error: null } // no accepted requests
  );
  const r = await getCircleRelationshipsForName(db, "Alice");
  assert.equal(r.circleMembers.has("Bob"), true);
  assert.equal(r.circleMembers.has("Charlie"), true);
  assert.equal(r.joinedCircles.has("Dave"), true);
  assert.equal(r.mutualMembers.size, 0); // no overlap
});

test("getCircleRelationshipsForName: mutualMembers is intersection of both directions", async () => {
  // Alice and Bob have each other in their circles
  const db = mockDb(
    {
      data: [
        { user_name: "Alice", member_name: "Bob" },
        { user_name: "Bob", member_name: "Alice" },
      ],
      error: null,
    },
    { data: [], error: null }
  );
  const r = await getCircleRelationshipsForName(db, "Alice");
  assert.equal(r.circleMembers.has("Bob"), true);
  assert.equal(r.joinedCircles.has("Bob"), true);
  assert.equal(r.mutualMembers.has("Bob"), true);
  assert.equal(r.mutualMembers.size, 1);
});

test("getCircleRelationshipsForName: accepted outgoing requests alone do not add relationships", async () => {
  const db = mockDb(
    { data: [], error: null }, // no edge rows
    { data: [{ sender_name: "Alice", receiver_name: "Eve" }], error: null } // stale accepted request: ignored
  );
  const r = await getCircleRelationshipsForName(db, "Alice");
  assert.equal(r.circleMembers.has("Eve"), false);
  assert.equal(r.joinedCircles.has("Eve"), false);
  assert.equal(r.mutualMembers.has("Eve"), false);
});

test("getCircleRelationshipsForName: accepted incoming requests alone do not add relationships", async () => {
  const db = mockDb(
    { data: [], error: null },
    { data: [{ sender_name: "Eve", receiver_name: "Alice" }], error: null } // stale accepted request: ignored
  );
  const r = await getCircleRelationshipsForName(db, "Alice");
  assert.equal(r.circleMembers.has("Eve"), false);
  assert.equal(r.joinedCircles.has("Eve"), false);
});

// ======================================================
// addCircleEdge
// ======================================================

test("addCircleEdge: no-op when edge already exists", async () => {
  const db = mockDb({ data: [{ id: "1" }], error: null }); // hasCircleEdge: found
  const { error } = await addCircleEdge(db, "Alice", "Bob");
  assert.equal(error, null);
});

test("addCircleEdge: inserts edge when not present", async () => {
  const db = mockDb(
    { data: [], error: null }, // hasCircleEdge: not found
    { error: null }            // insert: success
  );
  const { error } = await addCircleEdge(db, "Alice", "Bob");
  assert.equal(error, null);
});

test("addCircleEdge: ignores unique constraint violation (race condition on concurrent insert)", async () => {
  const db = mockDb(
    { data: [], error: null },
    { error: { code: "23505", message: "duplicate key value" } }
  );
  const { error } = await addCircleEdge(db, "Alice", "Bob");
  assert.equal(error, null);
});

test("addCircleEdge: returns real db errors that are not unique violations", async () => {
  const db = mockDb(
    { data: [], error: null },
    { error: { code: "500", message: "connection refused" } }
  );
  const { error } = await addCircleEdge(db, "Alice", "Bob");
  assert.ok(error);
  assert.equal(error.code, "500");
});

test("addCircleEdge: falls back to circle_requests when circle_memberships table is missing", async () => {
  const db = mockDb(
    { data: [], error: null },                                                        // hasCircleEdge: not found
    { error: { code: "PGRST205", message: "Could not find the table" } },             // insert: table missing
    { data: [], error: null },                                                        // hasAcceptedCircleRequest B→A: not found
    { data: [], error: null },                                                        // hasAcceptedCircleRequest A→B: not found
    { error: null }                                                                   // insert into circle_requests: success
  );
  const { error } = await addCircleEdge(db, "Alice", "Bob");
  assert.equal(error, null);
});

// ======================================================
// addMutualCircleEdges
// ======================================================

test("addMutualCircleEdges: inserts both edges successfully", async () => {
  const db = mockDb(
    { data: [], error: null }, // hasCircleEdge Alice→Bob: not found
    { error: null },           // insert Alice→Bob: ok
    { data: [], error: null }, // hasCircleEdge Bob→Alice: not found
    { error: null }            // insert Bob→Alice: ok
  );
  const { error } = await addMutualCircleEdges(db, "Alice", "Bob");
  assert.equal(error, null);
});

test("addMutualCircleEdges: no-ops for both edges when both already exist", async () => {
  const db = mockDb(
    { data: [{ id: "1" }], error: null }, // hasCircleEdge Alice→Bob: exists
    { data: [{ id: "2" }], error: null }  // hasCircleEdge Bob→Alice: exists
  );
  const { error } = await addMutualCircleEdges(db, "Alice", "Bob");
  assert.equal(error, null);
});

test("addMutualCircleEdges: returns first insert error and skips second edge", async () => {
  const db = mockDb(
    { data: [], error: null },
    { error: { code: "999", message: "db unreachable" } }
  );
  const { error } = await addMutualCircleEdges(db, "Alice", "Bob");
  assert.ok(error);
  assert.equal(error.message, "db unreachable");
});
