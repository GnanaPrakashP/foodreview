/**
 * Feed visibility enforcement tests.
 *
 * These tests call canViewerSeeReview, canShowInGlobalTrending, and
 * canShowInCircleTrending directly — not through the filter wrappers.
 * The existing visibility.test.mjs exercises the filter wrappers (filterProfile,
 * filterGlobalTrending, filterCircleTrending) and some compound scenarios.
 * This file fills the remaining gaps:
 *
 *   - Basic per-visibility cases tested via canViewerSeeReview (not a filter)
 *   - Logged-out / empty viewerName edge cases
 *   - Private-account poster with public post still publicly visible
 *   - Each individual suppression signal (deleted_at, is_deleted, status=*)
 *   - Suppressed post blocked even from the owner
 *   - canShowInGlobalTrending and canShowInCircleTrending called directly
 *   - Mixed-poster circle feed — viewer sees correct subset per relationship
 *   - Viewer always sees their own posts in any visibility setting
 *   - "New post passes feed filter" and "visibility change affects feed"
 *     complementing the existing visibility-transition test
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// ── load visibility module ────────────────────────────────────────────────────

function loadVisibilityModule() {
  const src = readFileSync(new URL("../lib/visibility.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    module: mod,
    exports: mod.exports,
    require(id) {
      throw new Error(`Unexpected require in visibility module: ${id}`);
    },
  });
  return mod.exports;
}

const {
  canViewerSeeReview,
  canShowInGlobalTrending,
  canShowInCircleTrending,
  isReviewSuppressed,
  filterGlobalTrendingReviews,
  filterCircleTrendingReviews,
} = loadVisibilityModule();

// ── test helpers ──────────────────────────────────────────────────────────────

let seq = 0;
function post(owner, visibility, restaurant = "Spot", extra = {}) {
  seq++;
  return {
    id: `p${seq}`,
    reviewer_name: owner,
    restaurant_name: restaurant,
    visibility,
    items: [{ name: "dish", rating: 4 }],
    body: null,
    photo_url: null,
    created_at: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

// ── Public post visibility ────────────────────────────────────────────────────

test("public post: visible to a stranger with no circle relationship", () => {
  const p = post("Alice", "public");
  assert.equal(canViewerSeeReview(p, { viewerName: "Bob" }), true);
});

test("public post: visible when viewerName is empty string (no-auth context)", () => {
  const p = post("Alice", "public");
  assert.equal(canViewerSeeReview(p, { viewerName: "" }), true);
});

test("public post: visible when viewerName is null", () => {
  const p = post("Alice", "public");
  assert.equal(canViewerSeeReview(p, { viewerName: null }), true);
});

test("public post: visible when no context is passed at all", () => {
  const p = post("Alice", "public");
  assert.equal(canViewerSeeReview(p), true);
});

test("public post from a private-account poster is still publicly visible", () => {
  // account_type is a profile field — it does not affect post visibility.
  // A private-account user can still post public reviews.
  // The visibility flag on the post is what matters, not the poster's account_type.
  const p = post("Private Alice", "public");
  assert.equal(canViewerSeeReview(p, { viewerName: "Bob" }), true);
  assert.equal(canShowInGlobalTrending(p), true);
});

// ── Circle post visibility ────────────────────────────────────────────────────

test("circle post: visible to the owner themselves", () => {
  const p = post("Alice", "circle");
  assert.equal(canViewerSeeReview(p, { viewerName: "Alice" }), true);
});

test("circle post: visible to a viewer who has access to the poster's posts", () => {
  const p = post("Alice", "circle");
  assert.equal(
    canViewerSeeReview(p, {
      viewerName: "Bob",
      circleOwnerNames: ["Alice"],
    }),
    true
  );
});

test("circle post: NOT visible to a stranger with no circle relationship", () => {
  const p = post("Alice", "circle");
  assert.equal(canViewerSeeReview(p, { viewerName: "Charlie" }), false);
});

test("circle post: NOT visible when viewer has circle access only to someone else, not the poster", () => {
  const p = post("Alice", "circle");
  assert.equal(
    canViewerSeeReview(p, {
      viewerName: "Bob",
      circleOwnerNames: ["Carol"], // Bob can see Carol's posts, but not Alice's
    }),
    false
  );
});

test("circle post: NOT visible when viewerName is empty (logged-out), even if circleOwnerNames includes poster", () => {
  const p = post("Alice", "circle");
  assert.equal(
    canViewerSeeReview(p, { viewerName: "", circleOwnerNames: ["Alice"] }),
    false
  );
});

test("circle post: NOT visible with no context (logged-out)", () => {
  const p = post("Alice", "circle");
  assert.equal(canViewerSeeReview(p), false);
});

// ── Me / only-me post visibility ──────────────────────────────────────────────

test("me post: visible only to the owner", () => {
  const p = post("Alice", "me");
  assert.equal(canViewerSeeReview(p, { viewerName: "Alice" }), true);
});

test("me post: NOT visible to a circle member", () => {
  const p = post("Alice", "me");
  assert.equal(
    canViewerSeeReview(p, {
      viewerName: "Bob",
      circleOwnerNames: ["Alice"],
    }),
    false
  );
});

test("me post: NOT visible to any other viewer regardless of relationship", () => {
  const p = post("Alice", "me");
  for (const name of ["Bob", "Charlie", "Dave"]) {
    assert.equal(
      canViewerSeeReview(p, { viewerName: name, circleOwnerNames: ["Alice"] }),
      false,
      `${name} should not see Alice's me-only post`
    );
  }
});

test("me post: NOT visible when viewerName is empty (logged-out)", () => {
  const p = post("Alice", "me");
  assert.equal(canViewerSeeReview(p, { viewerName: "" }), false);
  assert.equal(canViewerSeeReview(p), false);
});

// ── Suppression signals — each one tested explicitly ─────────────────────────

test("isReviewSuppressed: deleted_at timestamp marks post suppressed", () => {
  assert.equal(isReviewSuppressed(post("A", "public", "X", { deleted_at: "2026-01-01" })), true);
});

test("isReviewSuppressed: is_deleted: true marks post suppressed", () => {
  assert.equal(isReviewSuppressed(post("A", "public", "X", { is_deleted: true })), true);
});

test("isReviewSuppressed: is_hidden: true marks post suppressed", () => {
  assert.equal(isReviewSuppressed(post("A", "public", "X", { is_hidden: true })), true);
});

test("isReviewSuppressed: is_reported: true marks post suppressed", () => {
  assert.equal(isReviewSuppressed(post("A", "public", "X", { is_reported: true })), true);
});

test("isReviewSuppressed: hidden: true marks post suppressed", () => {
  assert.equal(isReviewSuppressed(post("A", "public", "X", { hidden: true })), true);
});

test("isReviewSuppressed: status='deleted' marks post suppressed", () => {
  assert.equal(isReviewSuppressed(post("A", "public", "X", { status: "deleted" })), true);
});

test("isReviewSuppressed: status='removed' marks post suppressed", () => {
  assert.equal(isReviewSuppressed(post("A", "public", "X", { status: "removed" })), true);
});

test("isReviewSuppressed: status='hidden' marks post suppressed", () => {
  assert.equal(isReviewSuppressed(post("A", "public", "X", { status: "hidden" })), true);
});

test("isReviewSuppressed: status='reported' marks post suppressed", () => {
  assert.equal(isReviewSuppressed(post("A", "public", "X", { status: "reported" })), true);
});

test("isReviewSuppressed: normal post with no flags is not suppressed", () => {
  assert.equal(isReviewSuppressed(post("A", "public")), false);
});

test("suppressed public post is NOT visible even to the owner", () => {
  const p = post("Alice", "public", "X", { deleted_at: "2026-01-01" });
  assert.equal(canViewerSeeReview(p, { viewerName: "Alice" }), false);
});

test("suppressed public post is excluded from global trending", () => {
  const normal = post("Alice", "public", "Normal Spot");
  const deleted = post("Bob", "public", "Deleted Spot", { deleted_at: "2026-01-01" });
  const isDeleted = post("Carol", "public", "IsDeleted Spot", { is_deleted: true });
  const removed = post("Dave", "public", "Removed Spot", { status: "removed" });
  const result = filterGlobalTrendingReviews([normal, deleted, isDeleted, removed]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, normal.id);
});

test("suppressed circle post is excluded from circle trending even for in-circle viewer", () => {
  const active = post("Alice", "circle", "Active Spot");
  const suppressed = post("Alice", "circle", "Dead Spot", { hidden: true });
  const result = filterCircleTrendingReviews(
    [active, suppressed],
    { viewerName: "Bob", circleOwnerNames: ["Alice"] }
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].id, active.id);
});

// ── canShowInGlobalTrending — direct tests ────────────────────────────────────

test("canShowInGlobalTrending: public post returns true", () => {
  assert.equal(canShowInGlobalTrending(post("Alice", "public")), true);
});

test("canShowInGlobalTrending: circle post returns false", () => {
  assert.equal(canShowInGlobalTrending(post("Alice", "circle")), false);
});

test("canShowInGlobalTrending: me post returns false", () => {
  assert.equal(canShowInGlobalTrending(post("Alice", "me")), false);
});

test("canShowInGlobalTrending: blocked reviewer's public post returns false", () => {
  const p = post("Alice", "public");
  assert.equal(canShowInGlobalTrending(p, { blockedNames: ["Alice"] }), false);
});

test("canShowInGlobalTrending: suppressed public post returns false", () => {
  const p = post("Alice", "public", "X", { is_deleted: true });
  assert.equal(canShowInGlobalTrending(p), false);
});

// ── canShowInCircleTrending — direct tests ────────────────────────────────────

test("canShowInCircleTrending: public post from circle owner is included", () => {
  const p = post("Alice", "public");
  assert.equal(
    canShowInCircleTrending(p, { viewerName: "Bob", circleOwnerNames: ["Alice"] }),
    true
  );
});

test("canShowInCircleTrending: circle post from circle owner is included", () => {
  const p = post("Alice", "circle");
  assert.equal(
    canShowInCircleTrending(p, { viewerName: "Bob", circleOwnerNames: ["Alice"] }),
    true
  );
});

test("canShowInCircleTrending: me post from circle owner is excluded", () => {
  const p = post("Alice", "me");
  assert.equal(
    canShowInCircleTrending(p, { viewerName: "Bob", circleOwnerNames: ["Alice"] }),
    false
  );
});

test("canShowInCircleTrending: post from a non-circle user is excluded", () => {
  const p = post("Carol", "public");
  assert.equal(
    canShowInCircleTrending(p, { viewerName: "Bob", circleOwnerNames: ["Alice"] }),
    false
  );
});

test("canShowInCircleTrending: viewer's own public and circle posts are included, but own private posts are not", () => {
  const ownPublic = post("Bob", "public");
  const ownCircle = post("Bob", "circle");
  const ownPrivate = post("Bob", "me");

  assert.equal(canShowInCircleTrending(ownPublic, { viewerName: "Bob", circleOwnerNames: ["Alice"] }), true);
  assert.equal(canShowInCircleTrending(ownCircle, { viewerName: "Bob", circleOwnerNames: ["Alice"] }), true);
  assert.equal(canShowInCircleTrending(ownPrivate, { viewerName: "Bob", circleOwnerNames: ["Alice"] }), false);
});

test("canShowInCircleTrending: empty viewerName returns false", () => {
  const p = post("Alice", "public");
  assert.equal(
    canShowInCircleTrending(p, { viewerName: "", circleOwnerNames: ["Alice"] }),
    false
  );
});

// ── Mixed-poster circle feed ──────────────────────────────────────────────────

test("circle feed: viewer sees correct subset when circle is asymmetric", () => {
  // Bob has access to Alice's posts (Alice is in circleOwnerNames for Bob)
  // Bob does NOT have access to Carol's circle posts
  const alicePublic  = post("Alice", "public",  "Alice Public");
  const aliceCircle  = post("Alice", "circle",  "Alice Circle");
  const aliceMe      = post("Alice", "me",       "Alice Private");
  const carolPublic  = post("Carol",  "public",  "Carol Public");
  const carolCircle  = post("Carol",  "circle",  "Carol Circle");
  const allPosts = [alicePublic, aliceCircle, aliceMe, carolPublic, carolCircle];

  const ctx = { viewerName: "Bob", circleOwnerNames: ["Alice"] };

  assert.equal(canViewerSeeReview(alicePublic, ctx),  true,  "Alice public post");
  assert.equal(canViewerSeeReview(aliceCircle, ctx),  true,  "Alice circle post");
  assert.equal(canViewerSeeReview(aliceMe,     ctx),  false, "Alice me post");
  assert.equal(canViewerSeeReview(carolPublic,  ctx),  true,  "Carol public post");
  assert.equal(canViewerSeeReview(carolCircle,  ctx),  false, "Carol circle post");

  const visible = allPosts.filter(p => canViewerSeeReview(p, ctx));
  assert.equal(visible.length, 3);
});

test("viewer always sees their own posts in any visibility setting", () => {
  const myPublic = post("Alice", "public",  "My Public");
  const myCircle = post("Alice", "circle",  "My Circle");
  const myMe     = post("Alice", "me",       "My Private");
  const ctx = { viewerName: "Alice" };

  assert.equal(canViewerSeeReview(myPublic, ctx), true,  "own public post");
  assert.equal(canViewerSeeReview(myCircle, ctx), true,  "own circle post");
  assert.equal(canViewerSeeReview(myMe,     ctx), true,  "own me post");
});

// ── Feed appearance after creation / visibility change ────────────────────────

test("newly created public post immediately passes global trending filter", () => {
  const newPost = post("Alice", "public", "New Spot");
  assert.equal(filterGlobalTrendingReviews([newPost]).length, 1);
});

test("newly created circle post does NOT appear in global trending", () => {
  const newPost = post("Alice", "circle", "New Spot");
  assert.equal(filterGlobalTrendingReviews([newPost]).length, 0);
});

test("newly created circle post appears in circle trending for an in-circle viewer", () => {
  const newPost = post("Alice", "circle", "New Spot");
  assert.equal(
    filterCircleTrendingReviews([newPost], { viewerName: "Bob", circleOwnerNames: ["Alice"] }).length,
    1
  );
});

test("newly created me post does NOT appear in any trending feed", () => {
  const newPost = post("Alice", "me", "New Spot");
  assert.equal(filterGlobalTrendingReviews([newPost]).length, 0);
  assert.equal(
    filterCircleTrendingReviews([newPost], { viewerName: "Bob", circleOwnerNames: ["Alice"] }).length,
    0
  );
});

test("changing visibility public→circle removes post from global trending and adds to circle trending", () => {
  const p = post("Alice", "public", "Spot X");
  const circleCtx = { viewerName: "Bob", circleOwnerNames: ["Alice"] };

  assert.equal(filterGlobalTrendingReviews([p]).length, 1);
  assert.equal(filterCircleTrendingReviews([p], circleCtx).length, 1);

  p.visibility = "circle";
  assert.equal(filterGlobalTrendingReviews([p]).length, 0);
  assert.equal(filterCircleTrendingReviews([p], circleCtx).length, 1);
});

test("changing visibility circle→me removes post from circle trending too", () => {
  const p = post("Alice", "circle", "Spot X");
  const circleCtx = { viewerName: "Bob", circleOwnerNames: ["Alice"] };

  assert.equal(filterCircleTrendingReviews([p], circleCtx).length, 1);

  p.visibility = "me";
  assert.equal(filterGlobalTrendingReviews([p]).length, 0);
  assert.equal(filterCircleTrendingReviews([p], circleCtx).length, 0);
});

test("changing visibility me→public makes post appear in global trending", () => {
  const p = post("Alice", "me", "Spot X");
  assert.equal(filterGlobalTrendingReviews([p]).length, 0);
  p.visibility = "public";
  assert.equal(filterGlobalTrendingReviews([p]).length, 1);
});
