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

function loadCircleAuthModule() {
  const source = readFileSync(new URL("../lib/circle-auth.ts", import.meta.url), "utf8");
  const mod = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module: mod,
    exports: mod.exports,
    require(id) {
      throw new Error(`Unexpected require in circle-auth tests: ${id}`);
    },
  });
  return mod.exports;
}

const { getAuthenticatedCircleActor } = loadCircleAuthModule();

function spyDb({ user, authError = null, profile = null } = {}) {
  const calls = [];
  return {
    auth: {
      getUser: async () => ({ data: { user: user ?? null }, error: authError }),
    },
    get _calls() {
      return calls;
    },
    from(table) {
      const entry = { table, ops: [] };
      calls.push(entry);
      const chain = {
        then(res) {
          return Promise.resolve({ data: profile, error: null }).then(res);
        },
      };
      for (const m of ["select", "eq", "maybeSingle"]) {
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

test("circle-auth: returns null when there is no authenticated user", async () => {
  const db = spyDb({ user: null });

  assert.equal(await getAuthenticatedCircleActor(db), null);
  assert.equal(db._calls.length, 0);
});

test("circle-auth: returns null on auth error", async () => {
  const db = spyDb({
    user: { id: "user-1", user_metadata: { full_name: "Alice" } },
    authError: { message: "bad token" },
  });

  assert.equal(await getAuthenticatedCircleActor(db), null);
  assert.equal(db._calls.length, 0);
});

test("circle-auth: derives actor name from profile full name first", async () => {
  const db = spyDb({
    user: { id: "user-1", user_metadata: { full_name: "Wrong Name" }, email: "wrong@example.com" },
    profile: { first_name: "Alice", last_name: "Ate", username: "alice" },
  });

  const actor = await getAuthenticatedCircleActor(db);

  assert.equal(actor.userId, "user-1");
  assert.equal(actor.actorName, "Alice Ate");
  assert.equal(db._calls[0].table, "profiles");
  assert.equal(eqFilters(db._calls[0]).id, "user-1");
});

test("circle-auth: falls back to metadata full_name, metadata name, then email prefix", async () => {
  assert.equal((await getAuthenticatedCircleActor(spyDb({
    user: { id: "user-1", user_metadata: { full_name: "  Alice Meta  " }, email: "alice@example.com" },
    profile: { first_name: "", last_name: "", username: "alice" },
  }))).actorName, "Alice Meta");

  assert.equal((await getAuthenticatedCircleActor(spyDb({
    user: { id: "user-2", user_metadata: { name: "  Bob Name  " }, email: "bob@example.com" },
    profile: null,
  }))).actorName, "Bob Name");

  assert.equal((await getAuthenticatedCircleActor(spyDb({
    user: { id: "user-3", user_metadata: {}, email: "cara@example.com" },
    profile: null,
  }))).actorName, "cara");
});

test("circle-auth: returns null when no profile, metadata, or email name exists", async () => {
  const db = spyDb({
    user: { id: "user-1", user_metadata: {}, email: null },
    profile: { first_name: "", last_name: "", username: "fallback_username_is_not_actor_name" },
  });

  assert.equal(await getAuthenticatedCircleActor(db), null);
});
