import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reviewPage = readFileSync(new URL("../app/reviews/[id]/page.tsx", import.meta.url), "utf8");
const commentPage = readFileSync(new URL("../app/comments/[id]/page.tsx", import.meta.url), "utf8");
const helper = readFileSync(new URL("../lib/profile-display.ts", import.meta.url), "utf8");
const selects = readFileSync(new URL("../lib/selects.ts", import.meta.url), "utf8");

test("review detail pages build a display-name profile map for reviewer, viewer, and commenters", () => {
  for (const source of [reviewPage, commentPage]) {
    assert.match(source, /buildProfileDisplayMap\(supabase, \[/);
    assert.match(source, /(review|normalizedReview)\.reviewer_name/);
    assert.match(source, /myName/);
    assert.match(source, /\.\.\.\(comments \?\? \[\]\)\.map\(\(c: Comment\) => c\.user_name\)/);
    assert.match(source, /profileMap=\{profileMap\}/);
  }
});

test("review detail page uses explicit review and comment select lists", () => {
  assert.match(selects, /export const REVIEW_SELECT = \[/);
  assert.match(selects, /"reviewer_name"/);
  assert.match(selects, /"photo_urls"/);
  assert.match(selects, /"visibility"/);
  assert.match(selects, /"deleted_at"/);
  assert.match(selects, /export const COMMENT_SELECT = "id, post_id, user_name, content, created_at"/);
  assert.match(reviewPage, /\.select\(REVIEW_SELECT\)/);
  assert.match(reviewPage, /\.select\(COMMENT_SELECT\)/);
  assert.match(commentPage, /\.select\(REVIEW_SELECT\)/);
  assert.match(commentPage, /\.select\(COMMENT_SELECT\)/);
  assert.doesNotMatch(reviewPage, /\.select\("\*"\)/);
  assert.doesNotMatch(commentPage, /\.select\("\*"\)/);
});

test("profile display lookup prefers the admin client and falls back to the request client", () => {
  assert.match(helper, /createAdminClient\(\)/);
  assert.match(helper, /catch \{\s*db = fallbackDb;\s*\}/);
  assert.match(helper, /\.from\("profiles"\)/);
  assert.match(helper, /\.in\("username", usernames\)/);
});
