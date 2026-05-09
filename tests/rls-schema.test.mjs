/**
 * RLS schema assertions — verifies that open "anyone can" policies have been
 * dropped and replaced with auth-bound ownership policies for reviews, likes,
 * comments, wishlist, and storage.
 *
 * These tests read supabase/schema.sql directly.  They do NOT hit a live DB —
 * they are a regression guard that fails immediately if the schema regresses
 * back to wide-open policies.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const placeDetailsMigration = readFileSync(
  new URL("../supabase/migrations/20260509170000_add_restaurant_place_details.sql", import.meta.url),
  "utf8"
);

// ── helpers ────────────────────────────────────────────────────────────────────

/** Collect all CREATE POLICY blocks for a given table + operation. */
function policiesFor(table, operation) {
  const re = new RegExp(
    `create policy "[^"]*"\\s+on (?:public\\.)?${table} for ${operation}[^;]*;`,
    "gis"
  );
  return schema.match(re) ?? [];
}

/** Return true when at least one policy in `blocks` references auth.uid(). */
function hasAuthUid(blocks) {
  return blocks.some((b) => /auth\.uid\(\)/.test(b));
}

// ── REVIEWS ────────────────────────────────────────────────────────────────────

test("schema: old open reviews INSERT policy is dropped", () => {
  assert.match(schema, /drop policy if exists "Anyone can post reviews" on public\.reviews/i);
});

test("schema: open reviews INSERT policy is not re-created", () => {
  assert.doesNotMatch(schema, /create policy "Anyone can post reviews"/i);
});

test("schema: reviews INSERT policy binds reviewer_name to auth.uid()", () => {
  const blocks = policiesFor("reviews", "insert");
  assert.ok(blocks.length > 0, "No reviews INSERT policy found");
  assert.ok(hasAuthUid(blocks), "reviews INSERT policy must reference auth.uid()");
  assert.ok(
    blocks.some((b) => /reviewer_name/.test(b)),
    "reviews INSERT policy must reference reviewer_name"
  );
});

test("schema: reviews UPDATE policy binds to auth.uid()", () => {
  const blocks = policiesFor("reviews", "update");
  assert.ok(blocks.length > 0, "No reviews UPDATE policy found");
  assert.ok(hasAuthUid(blocks), "reviews UPDATE policy must reference auth.uid()");
});

test("schema: reviews DELETE policy binds to auth.uid()", () => {
  const blocks = policiesFor("reviews", "delete");
  assert.ok(blocks.length > 0, "No reviews DELETE policy found");
  assert.ok(hasAuthUid(blocks), "reviews DELETE policy must reference auth.uid()");
});

test("schema: reviews SELECT policy is visibility-aware, not open", () => {
  assert.doesNotMatch(schema, /create policy "Reviews are readable by everyone"/i);
  const blocks = policiesFor("reviews", "select");
  assert.ok(blocks.length > 0, "No reviews SELECT policy found");
  assert.ok(
    blocks.some((b) => /can_read_review_row/.test(b)),
    "reviews SELECT policy must use the visibility helper"
  );
  assert.ok(
    blocks.every((b) => !/using\s*\(\s*true\s*\)/i.test(b)),
    "reviews SELECT policy must not be USING (true)"
  );
});

test("schema: reviews include Google Places restaurant metadata columns", () => {
  for (const [column, typePattern] of [
    ["restaurant_id", /text/i],
    ["area", /text/i],
    ["restaurant_address", /text/i],
    ["restaurant_lat", /double precision/i],
    ["restaurant_lng", /double precision/i],
  ]) {
    assert.match(
      schema,
      new RegExp(`(?:${column}\\s+${typePattern.source}|add column if not exists ${column}\\s+${typePattern.source})`, "i"),
      `reviews schema must include ${column}`
    );
    assert.match(
      placeDetailsMigration,
      new RegExp(`add column if not exists ${column}\\s+${typePattern.source}`, "i"),
      `place details migration must add ${column}`
    );
  }
});

test("schema: reviews have an index for stored restaurant coordinates", () => {
  assert.match(schema, /reviews_restaurant_location_idx/i);
  assert.match(placeDetailsMigration, /reviews_restaurant_location_idx/i);
  assert.match(placeDetailsMigration, /on public\.reviews\s*\(\s*restaurant_lat\s*,\s*restaurant_lng\s*\)/i);
});

// ── LIKES ──────────────────────────────────────────────────────────────────────

test("schema: old open likes INSERT policy is dropped", () => {
  assert.match(schema, /drop policy if exists "Anyone can like" on public\.likes/i);
});

test("schema: open likes INSERT policy is not re-created", () => {
  assert.doesNotMatch(schema, /create policy "Anyone can like"/i);
});

test("schema: old open likes DELETE policy is dropped", () => {
  assert.match(schema, /drop policy if exists "Anyone can unlike" on public\.likes/i);
});

test("schema: open likes DELETE policy is not re-created", () => {
  assert.doesNotMatch(schema, /create policy "Anyone can unlike"/i);
});

test("schema: likes INSERT policy binds user_name to auth.uid()", () => {
  const blocks = policiesFor("likes", "insert");
  assert.ok(blocks.length > 0, "No likes INSERT policy found");
  assert.ok(hasAuthUid(blocks), "likes INSERT policy must reference auth.uid()");
  assert.ok(blocks.some((b) => /user_name/.test(b)), "likes INSERT policy must reference user_name");
});

test("schema: likes DELETE policy binds user_name to auth.uid()", () => {
  const blocks = policiesFor("likes", "delete");
  assert.ok(blocks.length > 0, "No likes DELETE policy found");
  assert.ok(hasAuthUid(blocks), "likes DELETE policy must reference auth.uid()");
  assert.ok(blocks.some((b) => /user_name/.test(b)), "likes DELETE policy must reference user_name");
});

test("schema: likes SELECT policy inherits parent review visibility", () => {
  assert.doesNotMatch(schema, /create policy "Likes readable by everyone"/i);
  const blocks = policiesFor("likes", "select");
  assert.ok(blocks.length > 0, "No likes SELECT policy found");
  assert.ok(
    blocks.some((b) => /can_read_review_id\(post_id\)/.test(b)),
    "likes SELECT policy must check parent review readability"
  );
});

// ── COMMENTS ──────────────────────────────────────────────────────────────────

test("schema: old open comments INSERT policy is dropped", () => {
  assert.match(schema, /drop policy if exists "Anyone can comment" on public\.comments/i);
});

test("schema: open comments INSERT policy is not re-created", () => {
  assert.doesNotMatch(schema, /create policy "Anyone can comment"/i);
});

test("schema: old open comments DELETE policy is dropped", () => {
  assert.match(schema, /drop policy if exists "Anyone can delete own comments" on public\.comments/i);
});

test("schema: open comments DELETE policy is not re-created", () => {
  assert.doesNotMatch(schema, /create policy "Anyone can delete own comments"/i);
});

test("schema: comments INSERT policy binds user_name to auth.uid()", () => {
  const blocks = policiesFor("comments", "insert");
  assert.ok(blocks.length > 0, "No comments INSERT policy found");
  assert.ok(hasAuthUid(blocks), "comments INSERT policy must reference auth.uid()");
  assert.ok(blocks.some((b) => /user_name/.test(b)), "comments INSERT policy must reference user_name");
});

test("schema: comments DELETE policy binds user_name to auth.uid()", () => {
  const blocks = policiesFor("comments", "delete");
  assert.ok(blocks.length > 0, "No comments DELETE policy found");
  assert.ok(hasAuthUid(blocks), "comments DELETE policy must reference auth.uid()");
  assert.ok(blocks.some((b) => /user_name/.test(b)), "comments DELETE policy must reference user_name");
});

test("schema: comments SELECT policy inherits parent review visibility", () => {
  assert.doesNotMatch(schema, /create policy "Comments readable by everyone"/i);
  const blocks = policiesFor("comments", "select");
  assert.ok(blocks.length > 0, "No comments SELECT policy found");
  assert.ok(
    blocks.some((b) => /can_read_review_id\(post_id\)/.test(b)),
    "comments SELECT policy must check parent review readability"
  );
});

// ── STORAGE ────────────────────────────────────────────────────────────────────

test("schema: open storage upload policy is dropped", () => {
  assert.match(schema, /drop policy if exists "Anyone can upload review photos" on storage\.objects/i);
});

test("schema: open storage upload policy is not re-created", () => {
  assert.doesNotMatch(schema, /create policy "Anyone can upload review photos"/i);
});

test("schema: storage upload policy restricts to authenticated users", () => {
  const re = /create policy "[^"]*"\s+on storage\.objects for insert[^;]*;/gis;
  const blocks = schema.match(re) ?? [];
  assert.ok(blocks.length > 0, "No storage INSERT policy found");
  assert.ok(
    blocks.some((b) => /to authenticated/i.test(b)),
    "storage upload policy must use TO AUTHENTICATED"
  );
});

// ── WISHLIST ───────────────────────────────────────────────────────────────────

test("schema: old open wishlist INSERT policy is dropped", () => {
  assert.match(schema, /drop policy if exists "Anyone can bookmark" on public\.wishlist/i);
});

test("schema: open wishlist INSERT policy is not re-created", () => {
  assert.doesNotMatch(schema, /create policy "Anyone can bookmark"/i);
});

test("schema: old open wishlist DELETE policy is dropped", () => {
  assert.match(schema, /drop policy if exists "Anyone can unbookmark" on public\.wishlist/i);
});

test("schema: open wishlist DELETE policy is not re-created", () => {
  assert.doesNotMatch(schema, /create policy "Anyone can unbookmark"/i);
});

test("schema: wishlist SELECT policy is owner-only", () => {
  assert.doesNotMatch(schema, /create policy "Wishlist readable by everyone"/i);
  const blocks = policiesFor("wishlist", "select");
  assert.ok(blocks.length > 0, "No wishlist SELECT policy found");
  assert.ok(
    blocks.some((b) => /user_name/.test(b) && /auth\.uid\(\)/.test(b)),
    "wishlist SELECT policy must bind user_name to auth.uid()"
  );
});
