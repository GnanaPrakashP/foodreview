import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

const migration = source("supabase/migrations/202607110001_dish_identity_foundation.sql");

test("dish identity migration comes from the canonical root history", () => {
  assert.match(migration, /dish identity/i);
});

test("dish identity migration creates stable canonical, alias, candidate, mention, and merge tables", () => {
  for (const table of [
    "dish_families",
    "canonical_dishes",
    "dish_aliases",
    "dish_candidates",
    "review_dish_mentions",
    "dish_merge_history"
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, "i"));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(migration, new RegExp(`grant all privileges on table[\\s\\S]+public\\.${table}[\\s\\S]+to service_role`, "i"));
  }

  assert.match(migration, /id uuid primary key default gen_random_uuid\(\)/i);
  assert.match(migration, /family_id uuid references public\.dish_families\(id\) on delete set null/i);
  assert.match(migration, /merged_into_dish_id uuid references public\.canonical_dishes\(id\) on delete set null/i);
  assert.match(migration, /canonical_dishes_status_check check \(status in \('verified', 'generated', 'merged', 'hidden', 'rejected'\)\)/i);
  assert.match(migration, /canonical_dishes_merged_pointer_check/i);
  assert.match(migration, /dish_families_status_check check \(status in \('active', 'hidden', 'merged'\)\)/i);
});

test("aliases and legacy candidates remain service-owned compatibility tables", () => {
  assert.match(migration, /canonical_dish_id uuid not null references public\.canonical_dishes\(id\) on delete cascade/i);
  assert.match(migration, /alias_type in \([\s\S]*'typo'[\s\S]*'seed'[\s\S]*\)/i);
  assert.match(migration, /dish_aliases_status_check check \(status in \('active', 'candidate', 'rejected', 'hidden'\)\)/i);
  assert.match(migration, /dish_aliases_active_normalized_alias_unique[\s\S]+where status = 'active'/i);

  assert.match(migration, /create table if not exists public\.dish_candidates/i);
  assert.match(migration, /suggested_canonical_dish_id uuid references public\.canonical_dishes\(id\) on delete set null/i);
  assert.match(migration, /dish_candidates_status_check check \(status in \('new', 'needs_review', 'promoted', 'rejected', 'hidden', 'merged'\)\)/i);
  assert.match(migration, /dish_candidates_open_normalized_place_unique[\s\S]+where status in \('new', 'needs_review'\)/i);

  assert.doesNotMatch(migration, /insert into public\.canonical_dishes/i);
  assert.doesNotMatch(migration, /\bsumchi\b/i);
  assert.doesNotMatch(migration, /\bsushi\b/i);
});

test("review dish mentions can represent canonical, candidate, and legacy unresolved rows", () => {
  assert.match(migration, /review_id uuid not null references public\.reviews\(id\) on delete cascade/i);
  assert.match(migration, /user_id uuid not null references auth\.users\(id\) on delete cascade/i);
  assert.match(migration, /canonical_dish_id uuid references public\.canonical_dishes\(id\) on delete set null/i);
  assert.match(migration, /candidate_id uuid references public\.dish_candidates\(id\) on delete set null/i);
  assert.match(migration, /family_id uuid references public\.dish_families\(id\) on delete set null/i);
  assert.match(migration, /source in \('server', 'mobile_legacy', 'backfill', 'admin', 'user'\)/i);
  assert.match(migration, /match_status in \('exact', 'alias', 'user_selected', 'high_confidence', 'candidate', 'unresolved', 'needs_review', 'legacy'\)/i);
  assert.doesNotMatch(migration, /canonical_dish_id is not null/i);
  assert.doesNotMatch(migration, /candidate_id is not null/i);
  assert.match(migration, /review_dish_mentions_review_position_active_unique[\s\S]+where deleted_at is null/i);
});

test("dish identity indexes include lookup, review, and trigram search paths", () => {
  for (const index of [
    "canonical_dishes_normalized_name_idx",
    "canonical_dishes_family_id_idx",
    "canonical_dishes_status_idx",
    "dish_aliases_normalized_alias_idx",
    "dish_aliases_canonical_dish_id_idx",
    "dish_aliases_status_idx",
    "dish_candidates_normalized_name_idx",
    "dish_candidates_status_idx",
    "review_dish_mentions_review_id_idx",
    "review_dish_mentions_place_id_idx",
    "review_dish_mentions_canonical_dish_id_idx",
    "review_dish_mentions_candidate_id_idx",
    "review_dish_mentions_family_id_idx",
    "review_dish_mentions_user_id_idx",
    "review_dish_mentions_deleted_at_idx"
  ]) {
    assert.match(migration, new RegExp(index, "i"));
  }

  assert.match(migration, /create extension if not exists pg_trgm with schema extensions/i);
  assert.match(migration, /canonical_dishes using gin \(normalized_name gin_trgm_ops\)/i);
  assert.match(migration, /dish_aliases using gin \(normalized_alias gin_trgm_ops\)/i);
  assert.match(migration, /dish_candidates using gin \(normalized_name gin_trgm_ops\)/i);
});

test("RLS exposes only safe reads and keeps catalogue writes service-owned", () => {
  assert.match(migration, /Verified canonical dishes are readable[\s\S]+status = 'verified' and merged_into_dish_id is null/i);
  assert.match(migration, /Active dish aliases are readable[\s\S]+status = 'active'[\s\S]+dish\.status = 'verified'/i);
  assert.match(migration, /Review dish mentions readable with review[\s\S]+deleted_at is null and public\.can_read_review_id\(review_id\)/i);

  assert.match(migration, /revoke all on table[\s\S]+public\.dish_candidates[\s\S]+from anon, authenticated/i);
  assert.match(migration, /grant select on table[\s\S]+public\.dish_families[\s\S]+public\.canonical_dishes[\s\S]+public\.dish_aliases[\s\S]+public\.review_dish_mentions[\s\S]+to anon, authenticated/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all privileges) on table[\s\S]+public\.canonical_dishes[\s\S]+to anon, authenticated/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all privileges) on table[\s\S]+public\.dish_aliases[\s\S]+to anon, authenticated/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all privileges) on table[\s\S]+public\.dish_candidates[\s\S]+to anon, authenticated/i);
});

test("prepared legacy backfill is idempotent and does not trust generated string IDs", () => {
  assert.match(migration, /create or replace function public\.backfill_review_dish_mentions\(p_batch_size integer default 1000\)/i);
  assert.match(migration, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/i);
  assert.match(migration, /'legacyCanonicalDishId', legacy_item ->> 'canonicalDishId'/i);
  assert.match(migration, /'legacyCanonicalDishName', legacy_item ->> 'canonicalDishName'/i);
  assert.match(migration, /null,\s+null,\s+null,\s+'backfill',\s+'legacy'/i);
  assert.match(migration, /on conflict \(review_id, item_position\) where deleted_at is null do nothing/i);
  assert.match(migration, /grant execute on function public\.backfill_review_dish_mentions\(integer\) to service_role/i);
});

test("optional aggregate tables are rebuildable projections and not wired for client writes", () => {
  for (const table of ["place_stats", "place_dish_stats", "dish_place_stats"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, "i"));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(migration, new RegExp(`grant all privileges on table[\\s\\S]+public\\.${table}[\\s\\S]+to service_role`, "i"));
  }

  assert.match(migration, /source text not null default 'rebuild'/i);
  assert.match(migration, /Phase 1 does not read from this table/i);
  assert.doesNotMatch(migration, /grant select on table[\s\S]+public\.place_stats[\s\S]+to anon, authenticated/i);
  assert.doesNotMatch(migration, /grant select on table[\s\S]+public\.place_dish_stats[\s\S]+to anon, authenticated/i);
  assert.doesNotMatch(migration, /grant select on table[\s\S]+public\.dish_place_stats[\s\S]+to anon, authenticated/i);
});
