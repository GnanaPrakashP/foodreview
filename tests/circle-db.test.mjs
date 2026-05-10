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

function loadCircleDbModule() {
  const circleSource = readFileSync(new URL("../lib/circle.ts", import.meta.url), "utf8");
  const circleMod = { exports: {} };
  vm.runInNewContext(transpile(circleSource), {
    module: circleMod,
    exports: circleMod.exports,
    require(id) {
      if (id === "@/lib/types") return {};
      if (id === "@/lib/visibility") return { canShowInCircleTrending: () => false };
      throw new Error(`Unexpected require in circle helper tests: ${id}`);
    },
  });

  const source = readFileSync(new URL("../lib/circle-db.ts", import.meta.url), "utf8");
  const mod = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module: mod,
    exports: mod.exports,
    console,
    require(id) {
      if (id === "@/lib/types") return {};
      if (id === "@/lib/circle") return circleMod.exports;
      throw new Error(`Unexpected require in circle-db tests: ${id}`);
    },
  });
  return mod.exports;
}

const {
  addCircleEdge,
  addMutualCircleEdges,
  getAccountTypeForName,
  getAccountTypesForNames,
  getCircleRelationshipsForName,
  hasCircleAccess,
  hasCircleEdge,
} = loadCircleDbModule();

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
        "order", "in", "is", "single", "maybeSingle", "contains"]) {
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

function opArgs(entry, name) {
  const op = entry.ops.find(([opName]) => opName === name);
  return op?.slice(1) ?? [];
}

function hasOp(entry, name) {
  return entry.ops.some(([op]) => op === name);
}

function setValues(set) {
  return Array.from(set).sort();
}

test("circle-db: account type lookup matches exact full name and defaults to public", async () => {
  const db = spyDb({
    data: [
      { first_name: "Alice", last_name: "Wrong", account_type: "private" },
      { first_name: "Alice", last_name: "Ate", account_type: "private" },
    ],
    error: null,
  });

  assert.equal(await getAccountTypeForName(db, "Alice Ate"), "private");
  assert.equal(opArgs(db._calls[0], "ilike")[0], "first_name");
  assert.equal(opArgs(db._calls[0], "ilike")[1], "Alice");

  const missingDb = spyDb({ data: [], error: null });
  assert.equal(await getAccountTypeForName(missingDb, "Missing User"), "public");
});

test("circle-db: bulk account type lookup dedupes names and fills defaults", async () => {
  const db = spyDb({
    data: [
      { first_name: "Alice", last_name: "Ate", account_type: "private" },
      { first_name: "Bob", last_name: "Bites", account_type: "not-real" },
    ],
    error: null,
  });

  const result = await getAccountTypesForNames(db, ["Alice Ate", "Alice Ate", "Bob Bites", "Cara Chef"]);

  assert.equal(result["Alice Ate"], "private");
  assert.equal(result["Bob Bites"], "public");
  assert.equal(result["Cara Chef"], "public");
  assert.match(opArgs(db._calls[0], "or")[0], /first_name\.ilike\.Alice/);
  assert.match(opArgs(db._calls[0], "or")[0], /first_name\.ilike\.Bob/);
  assert.match(opArgs(db._calls[0], "or")[0], /first_name\.ilike\.Cara/);
});

test("circle-db: hasCircleEdge checks owner-to-member direction", async () => {
  const db = spyDb({ data: [{ id: "edge-1" }], error: null });

  assert.equal(await hasCircleEdge(db, "Bob", "Alice"), true);
  assert.equal(eqFilters(db._calls[0]).user_name, "Bob");
  assert.equal(eqFilters(db._calls[0]).member_name, "Alice");
});

test("circle-db: hasCircleAccess allows self and direct edges only", async () => {
  const selfDb = spyDb();
  assert.equal(await hasCircleAccess(selfDb, "Alice", "Alice"), true);
  assert.equal(selfDb._calls.length, 0);

  const edgeDb = spyDb({ data: [{ id: "edge-1" }], error: null });
  assert.equal(await hasCircleAccess(edgeDb, "Bob", "Alice"), true);
  assert.equal(edgeDb._calls.length, 1);

  const acceptedOnlyDb = spyDb(
    { data: [], error: null },
    { data: [{ id: "req-1" }], error: null }
  );
  assert.equal(await hasCircleAccess(acceptedOnlyDb, "Bob", "Alice"), false);
  assert.equal(acceptedOnlyDb._calls.length, 1);
  assert.equal(eqFilters(acceptedOnlyDb._calls[0]).user_name, "Bob");
  assert.equal(eqFilters(acceptedOnlyDb._calls[0]).member_name, "Alice");
});

test("circle-db: relationships come from membership edges only", async () => {
  const db = spyDb(
    {
      data: [
        { user_name: "Alice", member_name: "Bob" },
        { user_name: "Cara", member_name: "Alice" },
      ],
      error: null,
    },
    {
      data: [
        { sender_name: "Alice", receiver_name: "Dana" },
        { sender_name: "Eli", receiver_name: "Alice" },
      ],
      error: null,
    }
  );

  const relationships = await getCircleRelationshipsForName(db, "Alice");

  assert.equal(JSON.stringify(setValues(relationships.circleMembers)), JSON.stringify(["Bob"]));
  assert.equal(JSON.stringify(setValues(relationships.joinedCircles)), JSON.stringify(["Cara"]));
  assert.equal(JSON.stringify(setValues(relationships.mutualMembers)), JSON.stringify([]));
  assert.equal(db._calls.length, 1);
  assert.match(opArgs(db._calls[0], "or")[0], /user_name\.eq\."Alice"/);
});

test("circle-db: addCircleEdge skips insert when edge already exists", async () => {
  const db = spyDb({ data: [{ id: "edge-1" }], error: null });

  const result = await addCircleEdge(db, "Bob", "Alice");

  assert.equal(result.error, null);
  assert.equal(db._calls.filter((call) => hasOp(call, "insert")).length, 0);
});

test("circle-db: addCircleEdge treats unique-constraint races as success", async () => {
  const db = spyDb(
    { data: [], error: null },
    { error: { message: "duplicate", code: "23505" } }
  );

  const result = await addCircleEdge(db, "Bob", "Alice");

  assert.equal(result.error, null);
  const insert = db._calls.find((call) => hasOp(call, "insert"));
  assert.equal(opArgs(insert, "insert")[0].user_name, "Bob");
  assert.equal(opArgs(insert, "insert")[0].member_name, "Alice");
});

test("circle-db: missing membership table falls back to accepted request storage", async () => {
  const db = spyDb(
    { data: [], error: null },
    { error: { message: "Could not find the table circle_memberships", code: "PGRST205" } },
    { data: [], error: null },
    { data: [], error: null },
    { error: null }
  );

  const result = await addCircleEdge(db, "Bob", "Alice");

  assert.equal(result.error, null);
  const requestInsert = db._calls.find((call) => call.table === "circle_requests" && hasOp(call, "insert"));
  assert.equal(opArgs(requestInsert, "insert")[0].sender_name, "Alice");
  assert.equal(opArgs(requestInsert, "insert")[0].receiver_name, "Bob");
  assert.equal(opArgs(requestInsert, "insert")[0].status, "accepted");
});

test("circle-db: addMutualCircleEdges writes both directions", async () => {
  const db = spyDb(
    { data: [], error: null },
    { error: null },
    { data: [], error: null },
    { error: null }
  );

  const result = await addMutualCircleEdges(db, "Alice", "Bob");

  assert.equal(result.error, null);
  const inserts = db._calls.filter((call) => call.table === "circle_memberships" && hasOp(call, "insert"));
  assert.equal(inserts.length, 2);
  assert.equal(opArgs(inserts[0], "insert")[0].user_name, "Alice");
  assert.equal(opArgs(inserts[0], "insert")[0].member_name, "Bob");
  assert.equal(opArgs(inserts[1], "insert")[0].user_name, "Bob");
  assert.equal(opArgs(inserts[1], "insert")[0].member_name, "Alice");
});
