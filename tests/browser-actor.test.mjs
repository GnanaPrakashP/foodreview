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

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function loadBrowserActor(storage = createStorage()) {
  const source = readFileSync(new URL("../lib/browser-actor.ts", import.meta.url), "utf8");
  const mod = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module: mod,
    exports: mod.exports,
    window: { localStorage: storage },
    Storage: class Storage {},
    require(id) {
      throw new Error(`Unexpected require in browser-actor tests: ${id}`);
    },
  });
  return { actor: mod.exports, storage };
}

test("browser actor resolves an initial actor name and stores it", () => {
  const { actor, storage } = loadBrowserActor();

  assert.equal(actor.resolveActorName("  alice  "), "alice");
  assert.equal(storage.getItem("fc_my_name"), "alice");
});

test("browser actor falls back to stored actor name", () => {
  const storage = createStorage();
  storage.setItem("fc_my_name", "bob");
  const { actor } = loadBrowserActor(storage);

  assert.equal(actor.resolveActorName(), "bob");
});

test("browser actor syncs and clears actor plus display name", () => {
  const { actor, storage } = loadBrowserActor();

  actor.syncStoredActor({ name: "carol", displayName: "Carol Cook" });
  assert.equal(storage.getItem("fc_my_name"), "carol");
  assert.equal(storage.getItem("fc_display_name"), "Carol Cook");

  actor.clearStoredActor();
  assert.equal(storage.getItem("fc_my_name"), null);
  assert.equal(storage.getItem("fc_display_name"), null);
});
