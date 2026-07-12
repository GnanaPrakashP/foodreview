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
      if (id === "@/lib/profile-names") {
        return {
          profileDisplayName: (profile, fallback = "") =>
            [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || fallback,
        };
      }
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

test("circle-auth: uses username as actor name and full name as display name", async () => {
  const db = spyDb({
    user: { id: "user-1", user_metadata: { full_name: "Wrong Name" }, email: "wrong@example.com" },
    profile: { first_name: "Alice", last_name: "Ate", username: "alice" },
  });

  const actor = await getAuthenticatedCircleActor(db);

  assert.equal(actor.userId, "user-1");
  assert.equal(actor.actorName, "alice");
  assert.equal(actor.displayName, "Alice Ate");
  assert.equal(db._calls[0].table, "profiles");
  assert.equal(eqFilters(db._calls[0]).id, "user-1");
});

test("circle-auth: uses the persisted active profile and never reconstructs a missing profile", async () => {
  assert.equal((await getAuthenticatedCircleActor(spyDb({
    user: { id: "user-1", user_metadata: { full_name: "  Alice Meta  " }, email: "alice@example.com" },
    profile: { first_name: "", last_name: "", username: "alice" },
  }))).actorName, "alice");

  assert.equal(await getAuthenticatedCircleActor(spyDb({
    user: { id: "user-2", user_metadata: { username: "  bob_name  ", name: "  Bob Name  " }, email: "bob@example.com" },
    profile: null,
  })), null);

  assert.equal(await getAuthenticatedCircleActor(spyDb({
    user: { id: "user-3", user_metadata: {}, email: "cara@example.com" },
    profile: null,
  })), null);
});

test("circle-auth: rejects an account frozen for deletion", async () => {
  const db = spyDb({
    user: { id: "user-1", user_metadata: { full_name: "Alice" }, email: "alice@example.com" },
    profile: {
      first_name: "Alice",
      last_name: "Ate",
      username: "alice",
      account_status: "deleting",
      deletion_started_at: "2026-07-13T00:00:00.000Z",
    },
  });

  assert.equal(await getAuthenticatedCircleActor(db), null);
});

test("circle-auth: uses profile username even when no metadata or email name exists", async () => {
  const db = spyDb({
    user: { id: "user-1", user_metadata: {}, email: null },
    profile: { first_name: "", last_name: "", username: "fallback_username" },
  });

  const actor = await getAuthenticatedCircleActor(db);
  assert.equal(actor.actorName, "fallback_username");
  assert.equal(actor.displayName, "fallback_username");
});

test("circle-auth: displayName falls back through full_name then name metadata when profile has no first/last name", async () => {
  // full_name metadata is the first fallback after first+last name
  const actorFullName = await getAuthenticatedCircleActor(spyDb({
    user: { id: "u1", user_metadata: { full_name: "  Alice Meta  " }, email: "a@example.com" },
    profile: { first_name: null, last_name: null, username: "alice" },
  }));
  assert.equal(actorFullName.actorName, "alice");
  assert.equal(actorFullName.displayName, "Alice Meta");

  // name metadata is the second fallback when full_name is also absent
  const actorName = await getAuthenticatedCircleActor(spyDb({
    user: { id: "u2", user_metadata: { name: "  Bob Name  " }, email: "b@example.com" },
    profile: { first_name: null, last_name: null, username: "bob" },
  }));
  assert.equal(actorName.actorName, "bob");
  assert.equal(actorName.displayName, "Bob Name");

  // actorName is the final fallback when all name sources are absent
  const actorFallback = await getAuthenticatedCircleActor(spyDb({
    user: { id: "u3", user_metadata: {}, email: "c@example.com" },
    profile: { first_name: null, last_name: null, username: "cara" },
  }));
  assert.equal(actorFallback.actorName, "cara");
  assert.equal(actorFallback.displayName, "cara");
});

test("circle-auth: displayName is actorName when profile has null name fields and no metadata name", async () => {
  const db = spyDb({
    user: { id: "u1", user_metadata: {}, email: "zara@example.com" },
    profile: { first_name: null, last_name: null, username: "zara" },
  });

  const actor = await getAuthenticatedCircleActor(db);
  assert.equal(actor.actorName, "zara");
  assert.equal(actor.displayName, "zara");
});
