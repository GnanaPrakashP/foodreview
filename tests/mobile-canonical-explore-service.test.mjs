import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const discovery = readFileSync(new URL("../mobile/src/services/exploreDiscovery.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/202607130009_backend_feed_performance.sql", import.meta.url), "utf8");

test("mobile Explore requires the canonical v3 production contract", () => {
  assert.match(discovery, /const CANONICAL_EXPLORE_DISCOVERY_RPC = "explore_discovery_canonical_v3"/);
  assert.doesNotMatch(discovery, /EXPO_PUBLIC_CANONICAL_EXPLORE/);
  assert.match(discovery, /Explore deployment contract unavailable/);
});

test("mobile Explore makes one bounded RPC and exposes missing schema", () => {
  assert.match(discovery, /supabase\.rpc\(rpcName/);
  assert.match(discovery, /getExploreDiscoveryFromRpc\(input, CANONICAL_EXPLORE_DISCOVERY_RPC\)/);
  assert.doesNotMatch(discovery, /getExploreDiscoveryFallback\(input\)/);
  assert.doesNotMatch(discovery, /getExploreFeed\(/);
  assert.doesNotMatch(discovery, /\.range\(/);
});

test("canonical Explore parser preserves places dishes and people", () => {
  assert.match(discovery, /places: Array\.isArray\(value\.places\)/);
  assert.match(discovery, /dishes: Array\.isArray\(value\.dishes\)/);
  assert.match(discovery, /people: Array\.isArray\(value\.people\)/);
  assert.match(discovery, /familyIds: string\[\]/);
  assert.match(discovery, /familyNames: string\[\]/);
});

test("Explore v3 reads maintained projections and a fixed people window", () => {
  assert.match(migration, /create or replace function public\.explore_discovery_canonical_v3/);
  assert.match(migration, /from public\.place_stats/);
  assert.match(migration, /from public\.dish_place_stats/);
  assert.match(migration, /limit 120/);
  assert.match(migration, /least\(greatest\(coalesce\(p_limit, 30\), 1\), 50\)/);
});

test("Explore v3 remains authenticated and location aware", () => {
  assert.match(migration, /grant execute on function public\.explore_discovery_canonical_v3[\s\S]*to authenticated/);
  assert.match(migration, /p_lat double precision/);
  assert.match(migration, /p_lng double precision/);
  assert.match(migration, /latitude/);
  assert.match(migration, /longitude/);
});
