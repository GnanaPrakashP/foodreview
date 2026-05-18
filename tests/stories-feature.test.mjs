import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("stories feature has API, create page, and circle tray wiring", () => {
  const api = source("app/api/stories/route.ts");
  const circlePage = source("app/CirclePageClient.tsx");
  const tray = source("components/stories/StoriesTray.tsx");
  const form = source("components/stories/StoryForm.tsx");
  const newStoryPage = source("app/stories/new/page.tsx");
  const newReviewPage = source("app/reviews/new/page.tsx");

  assert.match(api, /export async function GET/);
  assert.match(api, /export async function POST/);
  assert.match(api, /getStoriesPage/);
  assert.match(api, /createStory/);

  assert.match(circlePage, /<StoriesTray \/>/);
  assert.match(tray, /\/api\/stories/);
  assert.match(tray, /href="\/stories\/new"/);
  assert.match(tray, /role="dialog"/);

  assert.match(newStoryPage, /<StoryForm \/>/);
  assert.match(form, /\/api\/photos\/moderate/);
  assert.match(form, /\/api\/stories/);
  assert.match(form, /24 \* 60 \* 60|Share story/);
  assert.match(newReviewPage, /href="\/stories\/new"/);
});

test("stories schema uses expiring rows and visibility-aware RLS", () => {
  const schema = source("supabase/schema.sql");
  const migration = source("supabase/migrations/202605180001_stories.sql");

  for (const sql of [schema, migration]) {
    assert.match(sql, /create table if not exists public\.stories/i);
    assert.match(sql, /expires_at\s+timestamptz/i);
    assert.match(sql, /interval '24 hours'/i);
    assert.match(sql, /stories_visibility_check/i);
    assert.match(sql, /can_read_story_row/i);
    assert.match(sql, /Stories readable by visibility/i);
    assert.match(sql, /Authenticated users can insert own stories/i);
  }
});
