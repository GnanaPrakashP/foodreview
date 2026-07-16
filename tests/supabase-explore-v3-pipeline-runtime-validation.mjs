#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { loadServerModule } from "../scripts/load-server-module.mjs";

function localEnvironment() {
  const result = spawnSync("npx", ["supabase", "status", "-o", "json"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status !== 0) throw new Error("local_supabase_unavailable; run npm run db:start and npm run db:reset");
  const status = JSON.parse(result.stdout);
  return { anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY, url: status.API_URL };
}

function client(url, key) {
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function allowed(result, label) {
  assert.equal(result.error, null, `${label}: ${result.error?.message ?? "failed"}`);
  return result.data;
}

async function authenticatedClient(admin, env, email) {
  const link = allowed(await admin.auth.admin.generateLink({ email, type: "magiclink" }), "magic link");
  const userClient = client(env.url, env.anonKey);
  const session = allowed(await userClient.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink"
  }), "OTP session");
  assert.ok(session.session, "authenticated Explore session missing");
  return userClient;
}

const env = localEnvironment();
const admin = client(env.url, env.serviceRoleKey);
const { replaceReviewDishMentionBatch } = loadServerModule("lib/server/dish-identity.ts");
const { buildDishIdentityReport } = loadServerModule("lib/server/dish-identity-report.ts");
const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const username = `xv3${suffix}`.slice(0, 20);
const email = `explore-v3-${suffix}@example.test`;
const placeId = `explore-v3-place-${suffix}`;
const dishNames = ["Masala Dosa", "Idli", "Pizza", "Biryani"];
const reviewIds = dishNames.map(() => randomUUID());
let userId = null;
let generatedBiryaniId = null;

try {
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  assert.ifError(created.error);
  assert.ok(created.data.user);
  userId = created.data.user.id;

  allowed(await admin.from("profiles").insert({
    account_status: "active",
    account_type: "public",
    first_name: "Explore",
    id: userId,
    last_name: "Pipeline",
    username
  }), "profile fixture");

  const reviews = dishNames.map((dishName, index) => ({
    area: "Pipeline Test Area",
    body: `Explore pipeline ${dishName}`,
    id: reviewIds[index],
    items: [{ name: dishName, rating: 5 - (index % 2) }],
    restaurant_id: placeId,
    restaurant_lat: 12.85,
    restaurant_lng: 77.5,
    restaurant_name: `Pipeline Cafe ${suffix}`,
    restaurant_primary_type: "coffee_shop",
    restaurant_types: index % 2 === 0 ? ["coffee_shop", "cafe"] : ["cafe", "bakery"],
    reviewer_name: username,
    status: "active",
    tags: ["pipeline"],
    visibility: "public"
  }));
  allowed(await admin.from("reviews").insert(reviews), "review fixtures");

  const orphanMentionId = randomUUID();
  allowed(await admin.from("review_dish_mentions").insert({
    candidate_id: null,
    canonical_dish_id: null,
    display_name: "Masala Dosa",
    id: orphanMentionId,
    item_position: 0,
    match_confidence: 0,
    match_status: "unresolved",
    normalized_name: "masala dosa",
    place_id: placeId,
    raw_name: "Masala Dosa",
    review_id: reviewIds[0],
    review_rating: 5,
    source: "admin",
    user_id: userId
  }), "orphan failure fixture");
  const blockedRebuild = await admin.rpc("rebuild_explore_v3_projections");
  assert.ok(blockedRebuild.error, "orphan mention unexpectedly remained projection-eligible");
  assert.match(blockedRebuild.error.message, /orphan_mentions/i);
  allowed(await admin.from("review_dish_mentions").delete().eq("id", orphanMentionId), "orphan failure fixture cleanup");

  const mentionInputs = reviews.map((review) => ({
    items: review.items,
    placeId,
    reviewId: review.id,
    source: "server",
    submittedItems: review.items,
    userId
  }));
  const firstResolution = await replaceReviewDishMentionBatch(admin, mentionInputs);
  assert.equal(firstResolution.ok, true, JSON.stringify(firstResolution.errors));
  assert.equal(firstResolution.reviewsWritten, 4);

  const activeMentions = allowed(await admin.from("review_dish_mentions")
    .select("id, review_id, canonical_dish_id, candidate_id, family_tokens")
    .in("review_id", reviewIds)
    .is("deleted_at", null), "resolved mentions");
  assert.equal(activeMentions.length, 4);
  assert.ok(activeMentions.every((mention) => Boolean(mention.canonical_dish_id) !== Boolean(mention.candidate_id)));
  assert.ok(activeMentions.every((mention) => mention.family_tokens.length > 0));

  const biryani = allowed(await admin.from("canonical_dishes")
    .select("id, status, normalized_name, family_tokens")
    .eq("normalized_name", "biryani")
    .is("merged_into_dish_id", null)
    .single(), "generic Biryani canonical");
  assert.equal(biryani.status, "generated");
  assert.deepEqual(biryani.family_tokens, ["biryani"]);
  generatedBiryaniId = biryani.id;

  const firstRebuild = allowed(await admin.rpc("rebuild_explore_v3_projections"), "first projection rebuild");
  assert.equal(firstRebuild.reconciliation.ready, true);
  const fixturePlaceStats = allowed(await admin.from("place_stats").select("place_id").eq("place_id", placeId), "fixture place projection");
  const fixtureDishStats = allowed(await admin.from("place_dish_stats").select("canonical_dish_id").eq("place_id", placeId), "fixture dish projections");
  assert.equal(fixturePlaceStats.length, 1);
  assert.equal(fixtureDishStats.length, 4);

  const authenticated = await authenticatedClient(admin, env, email);
  const globalExplore = allowed(await authenticated.rpc("explore_discovery_canonical_v3", {
    p_lat: null, p_lng: null, p_limit: 30
  }), "global Explore");
  const nearExplore = allowed(await authenticated.rpc("explore_discovery_canonical_v3", {
    p_lat: 12.85, p_lng: 77.5, p_limit: 30
  }), "nearby Explore");
  const distantExplore = allowed(await authenticated.rpc("explore_discovery_canonical_v3", {
    p_lat: 51.5072, p_lng: -0.1276, p_limit: 30
  }), "distant Explore");
  assert.ok(globalExplore.places.length > 0 && globalExplore.dishes.length > 0);
  assert.ok(nearExplore.places.length > 0 && nearExplore.dishes.length > 0);
  assert.equal(distantExplore.places.length, 0);
  assert.equal(distantExplore.dishes.length, 0);
  const fixturePlace = nearExplore.places.find((place) => place.placeId === placeId);
  assert.ok(fixturePlace, "nearby Explore omitted the fixture place");
  assert.equal(fixturePlace.primaryType, "coffee_shop");
  assert.ok(fixturePlace.types.includes("cafe"));
  assert.ok(fixturePlace.categoryTags.includes("cafe"));
  for (const dishName of dishNames) {
    assert.ok(nearExplore.dishes.some((dish) => dish.name === dishName), `nearby Explore omitted ${dishName}`);
  }

  const report = await buildDishIdentityReport(admin, {
    includePrivate: true,
    includeSuppressed: true,
    placeId
  });
  assert.equal(report.mentionDistribution.structurallyOrphaned, 0);
  assert.equal(report.mentionDistribution.missingRequiredFamilyTokens, 0);
  assert.equal(report.projectionReconciliation.ready, true);
  assert.equal(report.readiness.status, "READY_FOR_EXPLORE_MIGRATION");

  const beforeRerun = allowed(await admin.from("review_dish_mentions")
    .select("id", { count: "exact" })
    .in("review_id", reviewIds), "pre-rerun mention count");
  const secondResolution = await replaceReviewDishMentionBatch(admin, mentionInputs);
  assert.equal(secondResolution.ok, true);
  assert.equal(secondResolution.reviewsUnchanged, 4);
  const afterRerun = allowed(await admin.from("review_dish_mentions")
    .select("id", { count: "exact" })
    .in("review_id", reviewIds), "post-rerun mention count");
  assert.equal(afterRerun.length, beforeRerun.length, "rerun created physical mention duplicates");
  const genericBiryaniRows = allowed(await admin.from("canonical_dishes")
    .select("id")
    .eq("normalized_name", "biryani")
    .is("merged_into_dish_id", null), "generic Biryani deduplication");
  assert.equal(genericBiryaniRows.length, 1);

  const secondRebuild = allowed(await admin.rpc("rebuild_explore_v3_projections"), "second projection rebuild");
  assert.deepEqual(secondRebuild.stats, firstRebuild.stats, "projection rebuild inflated counts");

  console.log(JSON.stringify({
    explore: {
      distant: { dishes: distantExplore.dishes.length, people: distantExplore.people.length, places: distantExplore.places.length },
      global: { dishes: globalExplore.dishes.length, people: globalExplore.people.length, places: globalExplore.places.length },
      near: { dishes: nearExplore.dishes.length, people: nearExplore.people.length, places: nearExplore.places.length }
    },
    googleTypes: {
      categoryTags: fixturePlace.categoryTags,
      primaryType: fixturePlace.primaryType,
      types: fixturePlace.types
    },
    mentions: report.mentionDistribution,
    projections: secondRebuild,
    readiness: report.readiness.status,
    rerun: { mentionsUnchanged: secondResolution.reviewsUnchanged, projectionInflation: false },
    status: "PASS"
  }, null, 2));
} finally {
  if (reviewIds.length > 0) {
    await admin.from("review_dish_mentions").delete().in("review_id", reviewIds);
    await admin.from("reviews").delete().in("id", reviewIds);
    await admin.rpc("rebuild_explore_v3_projections");
  }
  if (generatedBiryaniId) {
    await admin.from("canonical_dishes").delete().eq("id", generatedBiryaniId).eq("status", "generated");
  }
  if (userId) await admin.auth.admin.deleteUser(userId);
}
