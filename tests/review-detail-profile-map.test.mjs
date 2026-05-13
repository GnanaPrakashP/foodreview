import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reviewPage = readFileSync(new URL("../app/reviews/[id]/page.tsx", import.meta.url), "utf8");
const commentPage = readFileSync(new URL("../app/comments/[id]/page.tsx", import.meta.url), "utf8");
const helper = readFileSync(new URL("../lib/profile-display.ts", import.meta.url), "utf8");

test("review detail pages build a display-name profile map for reviewer, viewer, and commenters", () => {
  for (const source of [reviewPage, commentPage]) {
    assert.match(source, /buildProfileDisplayMap\(supabase, \[/);
    assert.match(source, /review\.reviewer_name/);
    assert.match(source, /myName/);
    assert.match(source, /\.\.\.\(comments \?\? \[\]\)\.map\(\(c: Comment\) => c\.user_name\)/);
    assert.match(source, /profileMap=\{profileMap\}/);
  }
});

test("profile display lookup prefers the admin client and falls back to the request client", () => {
  assert.match(helper, /createAdminClient\(\)/);
  assert.match(helper, /catch \{\s*db = fallbackDb;\s*\}/);
  assert.match(helper, /\.from\("profiles"\)/);
  assert.match(helper, /\.in\("username", usernames\)/);
});

