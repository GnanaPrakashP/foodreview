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

function state({ circle = [], sent = [] } = {}) {
  return {
    circleMembers: new Set(circle),
    pendingSent: new Set(sent),
  };
}

test("people circle buttons: status maps to the visible label", () => {
  assert.equal(personButtonLabel("none"), "Request");
  assert.equal(personButtonLabel("sent"), "Requested");
  assert.equal(personButtonLabel("one_way"), "In Circle");
});

test("people circle buttons: Request becomes Requested during optimistic send", () => {
  const before = state();
  assert.equal(personButtonLabel(personStatusFor("Bob", before)), "Request");

  const after = state({ sent: Array.from(addName(before.pendingSent, "Bob")) });
  assert.equal(personButtonLabel(personStatusFor("Bob", after)), "Requested");
});

test("people circle buttons: failed send rolls Requested back to Request", () => {
  const pending = state({ sent: ["Bob"] });
  const after = state({ sent: Array.from(removeName(pending.pendingSent, "Bob")) });

  assert.equal(personButtonLabel(personStatusFor("Bob", pending)), "Requested");
  assert.equal(personButtonLabel(personStatusFor("Bob", after)), "Request");
});

test("people circle buttons: public-account success changes Request to In Circle", () => {
  const pending = state({ sent: ["Bob"] });
  const after = state({
    circle: Array.from(addName(new Set(), "Bob")),
    sent: Array.from(removeName(pending.pendingSent, "Bob")),
  });

  assert.equal(isOneWayCircleResponse({ state: "CIRCLE_ONE_WAY" }), true);
  assert.equal(personButtonLabel(personStatusFor("Bob", after)), "In Circle");
});

test("people circle buttons: accepted alias maps to In Circle", () => {
  const pending = state({ sent: ["Bob"] });
  const after = state({
    circle: Array.from(addName(new Set(), "Bob")),
    sent: Array.from(removeName(pending.pendingSent, "Bob")),
  });

  assert.equal(isAcceptedCircleResponse({ status: "accepted" }), true);
  assert.equal(personButtonLabel(personStatusFor("Bob", after)), "In Circle");
});

test("people circle buttons: status priority prefers In Circle over Requested", () => {
  const allStates = state({ circle: ["Bob"], sent: ["Bob"] });
  assert.equal(personStatusFor("Bob", allStates), "one_way");
  assert.equal(personButtonLabel(personStatusFor("Bob", allStates)), "In Circle");
});

test("people circle buttons: Requested cancel changes back to Request and failure restores Requested", () => {
  const pending = state({ sent: ["Bob"] });
  const afterCancelClick = state({ sent: Array.from(removeName(pending.pendingSent, "Bob")) });
  const afterCancelFailure = state({ sent: Array.from(addName(afterCancelClick.pendingSent, "Bob")) });

  assert.equal(personButtonLabel(personStatusFor("Bob", afterCancelClick)), "Request");
  assert.equal(personButtonLabel(personStatusFor("Bob", afterCancelFailure)), "Requested");
});

test("people circle buttons: accepted request changes sender to In Circle", () => {
  const afterAccept = state({
    circle: Array.from(addName(new Set(), "Alice")),
  });

  assert.equal(personButtonLabel(personStatusFor("Alice", afterAccept)), "In Circle");
});

test("people circle buttons: API response aliases are accepted", () => {
  assert.equal(isAcceptedCircleResponse({ status: "accepted" }), true);
  assert.equal(isAcceptedCircleResponse({ state: "CIRCLE_ONE_WAY" }), true);
  assert.equal(isOneWayCircleResponse({ status: "one_way" }), true);
  assert.equal(isAcceptedCircleResponse({ status: "pending" }), false);
  assert.equal(isOneWayCircleResponse({ state: "PENDING" }), false);
});
