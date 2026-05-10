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

function loadPeopleCircleState() {
  const source = readFileSync(new URL("../lib/people-circle-state.ts", import.meta.url), "utf8");
  const mod = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module: mod,
    exports: mod.exports,
  });
  return mod.exports;
}

const {
  addName,
  removeName,
  personStatusFor,
  personButtonLabel,
  isAcceptedCircleResponse,
  isOneWayCircleResponse,
} = loadPeopleCircleState();

function state({ circle = [], mutual = [], sent = [] } = {}) {
  return {
    circleMembers: new Set(circle),
    mutualMembers: new Set(mutual),
    pendingSent: new Set(sent),
  };
}

test("people circle buttons: status maps to the visible label", () => {
  assert.equal(personButtonLabel("none"), "Add");
  assert.equal(personButtonLabel("sent"), "Requested");
  assert.equal(personButtonLabel("one_way"), "In Circle");
  assert.equal(personButtonLabel("mutual"), "Mutual Circle");
});

test("people circle buttons: Add becomes Requested during optimistic send", () => {
  const before = state();
  assert.equal(personButtonLabel(personStatusFor("Bob", before)), "Add");

  const after = state({ sent: Array.from(addName(before.pendingSent, "Bob")) });
  assert.equal(personButtonLabel(personStatusFor("Bob", after)), "Requested");
});

test("people circle buttons: failed send rolls Requested back to Add", () => {
  const pending = state({ sent: ["Bob"] });
  const after = state({ sent: Array.from(removeName(pending.pendingSent, "Bob")) });

  assert.equal(personButtonLabel(personStatusFor("Bob", pending)), "Requested");
  assert.equal(personButtonLabel(personStatusFor("Bob", after)), "Add");
});

test("people circle buttons: public-account success changes Add to In Circle", () => {
  const pending = state({ sent: ["Bob"] });
  const after = state({
    circle: Array.from(addName(new Set(), "Bob")),
    sent: Array.from(removeName(pending.pendingSent, "Bob")),
  });

  assert.equal(isOneWayCircleResponse({ state: "CIRCLE_ONE_WAY" }), true);
  assert.equal(personButtonLabel(personStatusFor("Bob", after)), "In Circle");
});

test("people circle buttons: accepted success changes Add to Mutual Circle", () => {
  const pending = state({ sent: ["Bob"] });
  const circleMembers = addName(new Set(), "Bob");
  const mutualMembers = addName(new Set(), "Bob");
  const after = state({
    circle: Array.from(circleMembers),
    mutual: Array.from(mutualMembers),
    sent: Array.from(removeName(pending.pendingSent, "Bob")),
  });

  assert.equal(isAcceptedCircleResponse({ state: "CIRCLE_MUTUAL" }), true);
  assert.equal(personButtonLabel(personStatusFor("Bob", after)), "Mutual Circle");
});

test("people circle buttons: status priority prefers Mutual over In Circle over Requested", () => {
  const allStates = state({ circle: ["Bob"], mutual: ["Bob"], sent: ["Bob"] });
  assert.equal(personStatusFor("Bob", allStates), "mutual");
  assert.equal(personButtonLabel(personStatusFor("Bob", allStates)), "Mutual Circle");
});

test("people circle buttons: Requested cancel changes back to Add and failure restores Requested", () => {
  const pending = state({ sent: ["Bob"] });
  const afterCancelClick = state({ sent: Array.from(removeName(pending.pendingSent, "Bob")) });
  const afterCancelFailure = state({ sent: Array.from(addName(afterCancelClick.pendingSent, "Bob")) });

  assert.equal(personButtonLabel(personStatusFor("Bob", afterCancelClick)), "Add");
  assert.equal(personButtonLabel(personStatusFor("Bob", afterCancelFailure)), "Requested");
});

test("people circle buttons: incoming accept changes sender to Mutual Circle", () => {
  const afterAccept = state({
    circle: Array.from(addName(new Set(), "Alice")),
    mutual: Array.from(addName(new Set(), "Alice")),
  });

  assert.equal(personButtonLabel(personStatusFor("Alice", afterAccept)), "Mutual Circle");
});

test("people circle buttons: API response aliases are accepted", () => {
  assert.equal(isAcceptedCircleResponse({ status: "accepted" }), true);
  assert.equal(isOneWayCircleResponse({ status: "one_way" }), true);
  assert.equal(isAcceptedCircleResponse({ status: "pending" }), false);
  assert.equal(isOneWayCircleResponse({ state: "PENDING" }), false);
});
