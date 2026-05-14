/**
 * Static guard for the production RLS hardening schema.
 *
 * These tests do not connect to Supabase. They verify that the fresh-db schema
 * closes the direct-read leaks for reviews,
 * engagement tables, wishlist, and the missing circle_memberships table.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");

function policyBlock(table, operation, policyName) {
  const escapedName = policyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `create policy "${escapedName}"\\s+on public\\.${table} for ${operation}[^;]*;`,
    "is"
  );
  return schema.match(re)?.[0] ?? "";
}

function functionBlock(sql, functionName) {
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return sql.match(new RegExp(`create or replace function public\\.${escapedName}[\\s\\S]*?\\$\\$;`, "i"))?.[0] ?? "";
}

test("fresh schema creates circle_memberships with RLS", () => {
  assert.match(schema, /create table if not exists public\.circle_memberships/i);
  assert.match(schema, /unique\s*\(\s*user_name\s*,\s*member_name\s*\)/i);
  assert.match(schema, /create index if not exists circle_memberships_user_idx/i);
  assert.match(schema, /create index if not exists circle_memberships_member_idx/i);
  assert.match(schema, /alter table public\.circle_memberships enable row level security/i);
});

test("circle_memberships only exposes an authenticated read policy", () => {
  assert.match(schema, /create policy "Circle memberships readable by authenticated users"/i);
  assert.match(schema, /on public\.circle_memberships for select to authenticated\s+using \(true\)/i);
  assert.doesNotMatch(schema, /on public\.circle_memberships for insert/i);
  assert.doesNotMatch(schema, /on public\.circle_memberships for update/i);
  assert.doesNotMatch(schema, /on public\.circle_memberships for delete/i);
});

test("reviews open SELECT policy is dropped and replaced by visibility helper", () => {
  assert.match(schema, /drop policy if exists "Reviews are readable by everyone" on public\.reviews/i);
  const block = policyBlock("reviews", "select", "Reviews readable by visibility");
  assert.ok(block, "Reviews readable by visibility policy missing");
  assert.match(block, /to anon,\s*authenticated/i);
  assert.match(block, /public\.can_read_review_row/i);
  assert.doesNotMatch(block, /using\s*\(\s*true\s*\)/i);
});

test("review visibility helper enforces public, circle, owner, and suppression rules", () => {
  assert.match(schema, /create or replace function public\.can_read_review_row/i);
  assert.match(schema, /coalesce\(review_visibility,\s*'public'\)\s*=\s*'public'/i);
  assert.match(schema, /v\.name\s*=\s*review_owner_name/i);
  assert.match(schema, /coalesce\(review_visibility,\s*'public'\)\s*=\s*'circle'/i);
  assert.match(schema, /from public\.circle_memberships cm/i);
  assert.doesNotMatch(functionBlock(schema, "can_read_review_row"), /from public\.circle_requests cr/i);
  assert.match(schema, /public\.review_is_unsuppressed/i);
  assert.match(schema, /not in \('deleted', 'hidden', 'reported', 'removed'\)/i);
});

test("comments read and insert policies inherit parent review visibility", () => {
  assert.match(schema, /drop policy if exists "Comments readable by everyone" on public\.comments/i);
  const selectBlock = policyBlock("comments", "select", "Comments readable by visible review");
  assert.ok(selectBlock, "Comments readable by visible review policy missing");
  assert.match(selectBlock, /public\.can_read_review_id\(post_id\)/i);
  assert.doesNotMatch(selectBlock, /using\s*\(\s*true\s*\)/i);

  const insertBlock = policyBlock("comments", "insert", "Authenticated users can insert own comments");
  assert.ok(insertBlock, "Comments insert policy missing");
  assert.match(insertBlock, /user_name\s*=\s*public\.current_profile_name\(\)/i);
  assert.match(insertBlock, /public\.can_read_review_id\(post_id\)/i);
});

test("likes read and insert policies inherit parent review visibility", () => {
  assert.match(schema, /drop policy if exists "Likes readable by everyone" on public\.likes/i);
  const selectBlock = policyBlock("likes", "select", "Likes readable by visible review");
  assert.ok(selectBlock, "Likes readable by visible review policy missing");
  assert.match(selectBlock, /public\.can_read_review_id\(post_id\)/i);
  assert.doesNotMatch(selectBlock, /using\s*\(\s*true\s*\)/i);

  const insertBlock = policyBlock("likes", "insert", "Authenticated users can insert own likes");
  assert.ok(insertBlock, "Likes insert policy missing");
  assert.match(insertBlock, /user_name\s*=\s*public\.current_profile_name\(\)/i);
  assert.match(insertBlock, /public\.can_read_review_id\(post_id\)/i);
});

test("wishlist reads are private to the owner and bookmarks cannot target hidden reviews", () => {
  assert.match(schema, /drop policy if exists "Wishlist readable by everyone" on public\.wishlist/i);
  const selectBlock = policyBlock("wishlist", "select", "Wishlist readable by owner");
  assert.ok(selectBlock, "Wishlist readable by owner policy missing");
  assert.match(selectBlock, /user_name\s*=\s*public\.current_profile_name\(\)/i);
  assert.doesNotMatch(selectBlock, /using\s*\(\s*true\s*\)/i);

  const insertBlock = policyBlock("wishlist", "insert", "Authenticated users can bookmark");
  assert.ok(insertBlock, "Wishlist insert policy missing");
  assert.match(insertBlock, /user_name\s*=\s*public\.current_profile_name\(\)/i);
  assert.match(insertBlock, /post_id is null/i);
  assert.match(insertBlock, /public\.can_read_review_id\(post_id\)/i);
});

test("migration grants helper execution to anon and authenticated roles", () => {
  assert.match(schema, /grant execute on function public\.current_profile_name\(\) to anon, authenticated/i);
  assert.match(schema, /grant execute on function public\.can_read_review_row/i);
  assert.match(schema, /grant execute on function public\.can_read_review_id\(uuid\) to anon, authenticated/i);
});

test("schema backfills memberships and keeps the active review helper on memberships", () => {
  assert.match(
    schema,
    /insert into public\.circle_memberships\s*\(\s*user_name\s*,\s*member_name\s*\)\s*select sender_name,\s*receiver_name\s*from public\.circle_requests\s*where status = 'accepted'/i
  );
  assert.match(
    schema,
    /insert into public\.circle_memberships\s*\(\s*user_name\s*,\s*member_name\s*\)\s*select receiver_name,\s*sender_name\s*from public\.circle_requests\s*where status = 'accepted'/i
  );

  const helper = functionBlock(schema, "can_read_review_row");
  assert.ok(helper, "schema must create the active review helper");
  assert.match(helper, /from public\.circle_memberships cm/i);
  assert.doesNotMatch(helper, /from public\.circle_requests cr/i);
});
