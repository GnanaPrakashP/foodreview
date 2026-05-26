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

function loadCommonJs(code, requireMap = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    console,
    URLSearchParams,
    require(id) {
      if (requireMap[id]) return requireMap[id];
      throw new Error(`Unexpected require: ${id}`);
    },
  });
  return mod.exports;
}

const tasteTrust = loadCommonJs(
  transpile(readFileSync(new URL("../lib/taste-trust.ts", import.meta.url), "utf8"))
);

test("new user default Taste Trust is neutral New Reviewer", () => {
  assert.deepEqual(tasteTrust.calculateTasteTrustFromFeedback([]), tasteTrust.DEFAULT_TASTE_TRUST_SUMMARY);
});

test("positive feedback increases hidden trust score but stays New Reviewer under 5 confirmations", () => {
  const summary = tasteTrust.calculateTasteTrustFromFeedback([{ feedback_value: 1.0 }]);
  assert.equal(summary.trust_score, 100);
  assert.equal(summary.trust_level, "New Reviewer");
  assert.equal(summary.positive_confirmations_count, 1);
  assert.equal(summary.agreement_percentage, 100);
});

test("negative feedback decreases hidden trust score", () => {
  const summary = tasteTrust.calculateTasteTrustFromFeedback([{ feedback_value: -1.0 }]);
  assert.equal(summary.trust_score, 0);
  assert.equal(summary.negative_confirmations_count, 1);
});

test("updated feedback is represented once in recalculated totals", () => {
  const summary = tasteTrust.calculateTasteTrustFromFeedback([{ feedback_value: -0.5 }]);
  assert.equal(summary.confirmed_recommendations_count, 1);
  assert.equal(summary.total_feedback_points, -0.5);
  assert.equal(summary.positive_confirmations_count, 0);
  assert.equal(summary.negative_confirmations_count, 1);
});

test("Taste Trust levels change correctly after 5 or more confirmations", () => {
  assert.equal(tasteTrust.calculateTasteTrustFromFeedback(Array(5).fill({ feedback_value: -1 })).trust_level, "Low Trust");
  assert.equal(tasteTrust.calculateTasteTrustFromFeedback(Array(5).fill({ feedback_value: 0 })).trust_level, "Mixed Trust");
  assert.equal(tasteTrust.calculateTasteTrustFromFeedback(Array(5).fill({ feedback_value: 0.3 })).trust_level, "Growing Trust");
  assert.equal(tasteTrust.calculateTasteTrustFromFeedback(Array(5).fill({ feedback_value: 0.7 })).trust_level, "Trusted");
  assert.equal(tasteTrust.calculateTasteTrustFromFeedback(Array(5).fill({ feedback_value: 1 })).trust_level, "Highly Trusted");
});

function spyDb(...responses) {
  let idx = 0;
  const calls = [];
  return {
    get _calls() { return calls; },
    from(table) {
      const entry = { table, ops: [] };
      calls.push(entry);
      const next = () => Promise.resolve(responses[idx++] ?? { data: null, error: null });
  const chain = {
        then(res, rej) { return next().then(res, rej); },
        catch(rej) { return next().catch(rej); },
      };
      for (const m of ["select", "eq", "insert", "update", "delete", "maybeSingle", "single"]) {
        chain[m] = (...args) => { entry.ops.push([m, ...args]); return chain; };
      }
      return chain;
    },
  };
}

function updateCall(db) {
  return db._calls.find((call) => call.table === "recommendation_feedback" && call.ops.some(([op]) => op === "update"));
}

function insertCall(db) {
  return db._calls.find((call) => call.table === "recommendation_feedback" && call.ops.some(([op]) => op === "insert"));
}

function triedItemCall(db) {
  return db._calls.find((call) => call.table === "user_tried_items" && call.ops.some(([op]) => op === "insert" || op === "update"));
}

function makeReq(body) {
  return { json: async () => body };
}

function makeUrlReq(searchParams) {
  return { nextUrl: { searchParams: new URLSearchParams(searchParams) } };
}

const mockNextResponse = {
  json(body, opts) {
    return { body, status: opts?.status ?? 200 };
  },
};

function loadFeedbackRoute({ db, authName = "Alice", userId = "alice-id", recalcCalls }) {
  const code = transpile(
    readFileSync(new URL("../app/api/taste-trust/feedback/route.ts", import.meta.url), "utf8")
  );
  return loadCommonJs(code, {
    "next/server": { NextRequest: class {}, NextResponse: mockNextResponse },
    "@/lib/circle-db": { hasCircleAccess: async () => true },
    "@/lib/server/cache-invalidation": { invalidateSocialCachesForNames() {} },
    "@/lib/server/review-access": { canActorReadPost: async () => ({ allowed: true }) },
    "@/lib/server/taste-trust": {
      getPostTasteTrustSummary: async () => ({ tried_count: 1, agree_count: 1, agreed_count: 1, okay_count: 0, disagreed_count: 0, agreement_percentage: 100 }),
      recalculateTasteTrust: async (_db, reviewerUserId) => {
        recalcCalls.push(reviewerUserId);
        return { trust_score: 85, trust_level: "Trusted", confirmed_recommendations_count: 5 };
      },
    },
    "@/lib/server/route-supabase": {
      getRouteActor: async () => authName
        ? { actor: { userId, actorName: authName, displayName: authName } }
        : { actor: null },
    },
    "@/lib/supabase/admin": { createAdminClient: () => db },
    "@/lib/taste-trust": { feedbackValueForLabel: tasteTrust.feedbackValueForLabel },
  });
}

test("POST /taste-trust/feedback rejects own post feedback", async () => {
  const db = spyDb({
    data: {
      id: "post-1",
      reviewer_name: "Alice",
      restaurant_id: "place-1",
      items: [],
      visibility: "public",
      deleted_at: null,
      hidden_at: null,
      reported_at: null,
      status: "active",
    },
    error: null,
  });
  const { POST } = loadFeedbackRoute({ db, recalcCalls: [] });
  const res = await POST(makeReq({ postId: "post-1", feedbackLabel: "Totally worth it" }));
  assert.equal(res.status, 403);
  assert.match(res.body.error, /own post/i);
});

test("POST /taste-trust/feedback rejects private posts", async () => {
  const db = spyDb({
    data: {
      id: "post-1",
      reviewer_name: "Bob",
      restaurant_id: "place-1",
      items: [],
      visibility: "me",
      deleted_at: null,
      hidden_at: null,
      reported_at: null,
      status: "active",
    },
    error: null,
  });
  const { POST } = loadFeedbackRoute({ db, recalcCalls: [] });
  const res = await POST(makeReq({ postId: "post-1", feedbackLabel: "Mostly yes" }));
  assert.equal(res.status, 403);
  assert.match(res.body.error, /private posts/i);
});

test("POST /taste-trust/feedback updates existing feedback and tried history instead of double-counting", async () => {
  const recalcCalls = [];
  const db = spyDb(
    {
      data: {
        id: "post-1",
        reviewer_name: "Bob",
        restaurant_id: "place-1",
        items: [{ name: "Dosa" }],
        visibility: "public",
        deleted_at: null,
        hidden_at: null,
        reported_at: null,
        status: "active",
      },
      error: null,
    },
    { data: { id: "bob-id" }, error: null },
    { data: { id: "feedback-1" }, error: null },
    { error: null },
    { data: { id: "tried-1" }, error: null },
    {
      data: {
        id: "tried-1",
        user_id: "alice-id",
        place_id: "place-1",
        dish_id: "Dosa",
        source_post_id: "post-1",
        source_user_id: "bob-id",
        feedback_id: "feedback-1",
        tried_status: "tried",
        visibility: "private",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    }
  );
  const { POST } = loadFeedbackRoute({ db, recalcCalls });
  const res = await POST(makeReq({ postId: "post-1", feedbackLabel: "Not really" }));
  assert.equal(res.status, 200);
  assert.ok(updateCall(db), "expected existing feedback to be updated");
  assert.equal(insertCall(db), undefined);
  assert.ok(triedItemCall(db), "expected private tried history to be inserted or updated");
  assert.equal(res.body.triedItem.visibility, "private");
  assert.deepEqual(recalcCalls, ["bob-id"]);
});

test("DELETE /taste-trust/feedback removes feedback, keeps tried history private, and recalculates", async () => {
  const recalcCalls = [];
  const db = spyDb(
    {
      data: {
        id: "post-1",
        reviewer_name: "Bob",
        restaurant_id: "place-1",
        items: [{ name: "Dosa" }],
        visibility: "public",
        deleted_at: null,
        hidden_at: null,
        reported_at: null,
        status: "active",
      },
      error: null,
    },
    { data: { id: "feedback-1", reviewer_user_id: "bob-id" }, error: null },
    { error: null },
    {
      data: {
        id: "tried-1",
        user_id: "alice-id",
        place_id: "place-1",
        dish_id: "Dosa",
        source_post_id: "post-1",
        source_user_id: "bob-id",
        feedback_id: null,
        tried_status: "tried",
        visibility: "private",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    }
  );
  const { DELETE } = loadFeedbackRoute({ db, recalcCalls });
  const res = await DELETE(makeUrlReq({ postId: "post-1" }));

  assert.equal(res.status, 200);
  assert.ok(db._calls.find((call) => call.table === "recommendation_feedback" && call.ops.some(([op]) => op === "delete")));
  assert.ok(db._calls.find((call) => call.table === "user_tried_items" && call.ops.some(([op]) => op === "update")));
  assert.equal(res.body.myFeedbackLabel, null);
  assert.equal(res.body.triedItem.visibility, "private");
  assert.equal(res.body.triedItem.feedback_id, null);
  assert.deepEqual(recalcCalls, ["bob-id"]);
});
