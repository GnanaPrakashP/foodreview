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

function loadReputation() {
  const source = readFileSync(new URL("../lib/reputation.ts", import.meta.url), "utf8");
  const mod = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module: mod,
    exports: mod.exports,
    console,
    require(id) {
      if (id === "@/lib/profile") {
        return { detectCuisine: (name) => /biryani/i.test(name) ? "Biryani" : "Other" };
      }
      throw new Error(`Unexpected require in reputation tests: ${id}`);
    },
  });
  return mod.exports;
}

const R = loadReputation();
const reputationServerSource = readFileSync(new URL("../lib/server/reputation.ts", import.meta.url), "utf8");

test("earning badges does not create inbox or push notifications", () => {
  assert.doesNotMatch(reputationServerSource, /ACHIEVEMENT_UNLOCKED/);
  assert.doesNotMatch(reputationServerSource, /notifyNewBadges/);
  assert.doesNotMatch(reputationServerSource, /createNotificationForNames/);
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePost(overrides = {}) {
  return {
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function score(input) {
  return R.calculateProfileScore(input);
}

// ─── Tier labels ─────────────────────────────────────────────────────────────

test("getUserTier maps scores to correct tier names", () => {
  assert.equal(R.getUserTier(0).displayName, "New Taster");
  assert.equal(R.getUserTier(4).displayName, "New Taster");
  assert.equal(R.getUserTier(5).displayName, "Rising Taster");
  assert.equal(R.getUserTier(12).displayName, "Rising Taster");
  assert.equal(R.getUserTier(13).displayName, "Food Regular");
  assert.equal(R.getUserTier(28).displayName, "Food Regular");
  assert.equal(R.getUserTier(29).displayName, "Known Regular");
  assert.equal(R.getUserTier(55).displayName, "Known Regular");
  assert.equal(R.getUserTier(56).displayName, "Trusted Palate");
  assert.equal(R.getUserTier(100).displayName, "Trusted Palate");
  assert.equal(R.getUserTier(101).displayName, "Sharp Palate");
  assert.equal(R.getUserTier(175).displayName, "Sharp Palate");
  assert.equal(R.getUserTier(176).displayName, "Tastemaker");
  assert.equal(R.getUserTier(320).displayName, "Tastemaker");
  assert.equal(R.getUserTier(321).displayName, "Local Tastemaker");
  assert.equal(R.getUserTier(580).displayName, "Local Tastemaker");
  assert.equal(R.getUserTier(581).displayName, "Food Authority");
  assert.equal(R.getUserTier(1000).displayName, "Food Authority");
  assert.equal(R.getUserTier(1001).displayName, "Top Food Authority");
  assert.equal(R.getUserTier(1700).displayName, "Top Food Authority");
  assert.equal(R.getUserTier(1701).displayName, "Culinary Legend");
  assert.equal(R.getUserTier(99999).displayName, "Culinary Legend");
});

// ─── Trust multiplier ────────────────────────────────────────────────────────

test("trustMultiplier: new user with no feedback gets near-neutral multiplier", () => {
  // confidence = 0 → always 0.9 regardless of trust score
  assert.equal(R.trustMultiplier(0, 0), 0.9);
  assert.equal(R.trustMultiplier(50, 0), 0.9);
  assert.equal(R.trustMultiplier(100, 0), 0.9);
});

test("trustMultiplier: established user penalty grows with more feedback evidence", () => {
  // confidence = 1 (30+ feedback events); low trust should now be penalised
  const lowTrustPenalty = R.trustMultiplier(0, 30);
  const defaultTrust = R.trustMultiplier(50, 30);
  const highTrust = R.trustMultiplier(100, 30);

  assert.ok(lowTrustPenalty < 0.8, `expected penalty for trust=0, got ${lowTrustPenalty}`);
  assert.ok(Math.abs(defaultTrust - 1.0) < 0.05, `trust=50 should be ~1.0, got ${defaultTrust}`);
  assert.ok(highTrust > 1.0 && highTrust <= 1.15, `trust=100 should give small boost, got ${highTrust}`);
});

test("trustMultiplier: partial confidence interpolates smoothly", () => {
  const half = R.trustMultiplier(50, 15); // confidence = 0.5
  assert.ok(half >= 0.9 && half <= 1.0, `half-confidence trust=50 should be 0.9–1.0, got ${half}`);
});

// ─── Recency decay ────────────────────────────────────────────────────────────

test("getRecencyDecay returns expected decay tiers", () => {
  const now = new Date("2026-05-27T00:00:00.000Z");
  assert.equal(R.getRecencyDecay("2026-05-01T00:00:00.000Z", now), 1);    // 26 days
  assert.equal(R.getRecencyDecay("2026-01-01T00:00:00.000Z", now), 0.8);  // ~146 days
  assert.equal(R.getRecencyDecay("2025-07-01T00:00:00.000Z", now), 0.6);  // ~330 days
  assert.equal(R.getRecencyDecay("2024-01-01T00:00:00.000Z", now), 0.4);  // >1 year
});

// ─── Scenario 1: New user ─────────────────────────────────────────────────────

test("scenario: new user — first review gives visible score movement", () => {
  // One quality review: photo, new place, new area
  const s = score({
    posts: [makePost({ hasPhoto: true, isNewPlaceForUser: true, isNewAreaForUser: true })],
    trustScore: 20,
    totalFeedbackReceived: 0,
  });
  assert.ok(s > 0 && s <= 4, `new user first review should land in New Taster, got ${s}`);
  assert.equal(R.getUserTier(s).displayName, "New Taster");
});

// ─── Scenario 2: Casual user ─────────────────────────────────────────────────

test("scenario: casual user — 5 useful reviews reaches Rising Taster", () => {
  const posts = [
    makePost({ hasPhoto: true, isNewPlaceForUser: true, isNewAreaForUser: true, saveCount: 1 }),
    makePost({ hasPhoto: true, isNewPlaceForUser: true, isNewCuisineForUser: true }),
    makePost({ hasPhoto: true }),
    makePost({ tagCount: 3, isNewAreaForUser: true }),
    makePost({}),
  ];
  const s = score({ posts, communityReactionCount: 3, activeWeeksRecent: 1, trustScore: 20, totalFeedbackReceived: 3 });
  assert.ok(s >= 5 && s <= 12, `casual user should be Rising Taster (5–12), got ${s}`);
  assert.equal(R.getUserTier(s).displayName, "Rising Taster");
});

// ─── Scenario 3: Active useful user ──────────────────────────────────────────

test("scenario: active useful user — 20 quality reviews reaches Trusted Palate", () => {
  const posts = Array.from({ length: 20 }, (_, i) => makePost({
    hasPhoto: true,
    tagCount: 3,
    itemCount: 3,
    saveCount: 2,
    SA: 1,
    isNewPlaceForUser: i < 12,
    isNewAreaForUser: i < 8,
    isNewCuisineForUser: i < 5,
    isLowPostPlace: i < 10,
  }));
  const s = score({
    posts,
    communityReactionCount: 10,
    activeWeeksRecent: 3,
    trustScore: 55,
    totalFeedbackReceived: 20,
  });
  assert.ok(s >= 56, `20 quality reviews should reach Trusted Palate (56+), got ${s}`);
  const tier = R.getUserTier(s).displayName;
  assert.ok(
    ["Trusted Palate", "Sharp Palate", "Tastemaker"].includes(tier),
    `expected Trusted Palate or above, got ${tier}`,
  );
});

// ─── Scenario 4: Power user ───────────────────────────────────────────────────

test("scenario: power user — 80 quality reviews + driven visits reaches Tastemaker or above", () => {
  // Posts spread across 960 days: recent ones score fully, old ones are decayed.
  // Expect Tastemaker (176+). Local Tastemaker+ requires ~150+ reviews.
  const posts = Array.from({ length: 80 }, (_, i) => makePost({
    hasPhoto: true,
    tagCount: 3,
    itemCount: 3,
    saveCount: i < 30 ? 3 : 1,
    SA: i < 40 ? 2 : 0,
    A: 1,
    isNewPlaceForUser: i < 50,
    isLowPostPlace: i < 30,
    isNewAreaForUser: i < 25,
    isNewCuisineForUser: i < 10,
    createdAt: new Date(Date.now() - i * 12 * 86_400_000).toISOString(),
  }));
  const s = score({
    posts,
    communityReactionCount: 50,
    uniqueDrivenVisitors: 10,
    activeWeeksRecent: 4,
    trustScore: 70,
    totalFeedbackReceived: 50,
  });
  assert.ok(s >= 176, `power user should reach Tastemaker (176+), got ${s}`);
  assert.ok(s < 581, `power user should not yet reach Food Authority (food auth is very hard), got ${s}`);
});

// ─── Scenario 5: Spam user ────────────────────────────────────────────────────

test("scenario: spam user — 200 bare reviews cannot reach Food Authority", () => {
  // 200 reviews with no photos, tags, items, or engagement. All recent.
  const posts = Array.from({ length: 200 }, () => makePost({}));
  const s = score({ posts, trustScore: 20, totalFeedbackReceived: 0 });
  assert.ok(
    s < 581,
    `200 bare reviews should NOT reach Food Authority (581), got ${s}`,
  );
});

test("scenario: spam user with many bare reviews + low trust cannot exceed Sharp Palate", () => {
  // 200 bare reviews spread over time (recency decay); trust=20, some negative feedback
  const posts = Array.from({ length: 200 }, (_, i) =>
    makePost({
      createdAt: new Date(Date.now() - i * 10 * 86_400_000).toISOString(),
    }),
  );
  const s = score({ posts, trustScore: 20, totalFeedbackReceived: 10, communityReactionCount: 0 });
  assert.ok(s < 176, `bare-review spam should stay below Tastemaker (176), got ${s}`);
});

// ─── Scenario 6: Reaction farmer ─────────────────────────────────────────────

test("scenario: reaction farmer — community reactions alone cannot reach Known Regular", () => {
  // Max community lifetime cap = 20 pts; with confidence=0 (no reviews), 0.9× → 18 max
  // Food Regular top boundary is 28; Known Regular starts at 29
  const s = score({
    posts: [],
    communityReactionCount: 10000, // will be capped at 20 pts by formula
    trustScore: 20,
    totalFeedbackReceived: 0,
  });
  assert.ok(s < 29, `reaction farming with no reviews should not reach Known Regular, got ${s}`);
});

// ─── Scenario 7: One viral post ───────────────────────────────────────────────

test("scenario: viral post — single excellent post cannot skip past Rising Taster", () => {
  // Max possible post: photo + items + tags + new place + low post + new area + new cuisine
  //   + max saves (cap 2.5) + max confirms (cap 4) + max likes (cap 0.8) → capped at 10
  const s = score({
    posts: [makePost({
      hasPhoto: true,
      tagCount: 5,
      itemCount: 5,
      isNewPlaceForUser: true,
      isLowPostPlace: true,
      isNewAreaForUser: true,
      isNewCuisineForUser: true,
      saveCount: 50,
      SA: 30,
      likeCount: 20,
    })],
    trustScore: 50,
    totalFeedbackReceived: 30,
  });
  assert.ok(s <= 12, `one viral post should not go past Rising Taster (12), got ${s}`);
});

// ─── Scenario 8: Long-term top creator ───────────────────────────────────────

test("scenario: top creator — 150 quality reviews + driven visits reaches Local Tastemaker or above", () => {
  // Posts spread across ~1200 days; heavy recency decay on older reviews.
  // Expect Local Tastemaker (321+). Food Authority is intentionally very hard.
  const posts = Array.from({ length: 150 }, (_, i) => makePost({
    hasPhoto: true,
    tagCount: 3,
    itemCount: 3,
    saveCount: i < 60 ? 4 : 2,
    SA: i < 80 ? 2 : 1,
    A: 1,
    isNewPlaceForUser: i < 90,
    isLowPostPlace: i < 50,
    isNewAreaForUser: i < 40,
    isNewCuisineForUser: i < 15,
    createdAt: new Date(Date.now() - i * 8 * 86_400_000).toISOString(),
  }));
  const s = score({
    posts,
    communityReactionCount: 120,
    uniqueDrivenVisitors: 20,
    activeWeeksRecent: 4,
    trustScore: 80,
    totalFeedbackReceived: 100,
  });
  assert.ok(s >= 321, `top creator should reach Local Tastemaker (321+), got ${s}`);
});

// ─── Scoring pillar tests ─────────────────────────────────────────────────────

test("saves contribute more to score than likes", () => {
  const withSaves = score({ posts: [makePost({ saveCount: 5 })], trustScore: 50, totalFeedbackReceived: 20 });
  const withLikes = score({ posts: [makePost({ likeCount: 5 })], trustScore: 50, totalFeedbackReceived: 20 });
  assert.ok(withSaves > withLikes, `saves should outweigh likes (saves=${withSaves}, likes=${withLikes})`);
});

test("review with photo + items + tags scores higher than bare review", () => {
  const quality = score({ posts: [makePost({ hasPhoto: true, itemCount: 3, tagCount: 3 })], trustScore: 50, totalFeedbackReceived: 20 });
  const bare = score({ posts: [makePost({})], trustScore: 50, totalFeedbackReceived: 20 });
  assert.ok(quality > bare, `quality review (${quality}) should beat bare review (${bare})`);
});

test("new place / area / cuisine discovery adds meaningful score", () => {
  const withDiscovery = score({
    posts: [makePost({ isNewPlaceForUser: true, isNewAreaForUser: true, isNewCuisineForUser: true })],
    trustScore: 50,
    totalFeedbackReceived: 20,
  });
  const withoutDiscovery = score({
    posts: [makePost({ isNewPlaceForUser: false, isNewAreaForUser: false, isNewCuisineForUser: false })],
    trustScore: 50,
    totalFeedbackReceived: 20,
  });
  assert.ok(withDiscovery > withoutDiscovery * 1.5, `discovery signals should add >50% boost`);
});

test("bare reviews have diminishing returns — review #60 contributes less than review #1", () => {
  // Build 61 bare posts; compare marginal contribution of first vs last
  const base = score({ posts: Array.from({ length: 60 }, () => makePost({})), trustScore: 50, totalFeedbackReceived: 20 });
  const withOne = score({ posts: Array.from({ length: 61 }, () => makePost({})), trustScore: 50, totalFeedbackReceived: 20 });
  const marginal60 = withOne - base;

  const first = score({ posts: [makePost({})], trustScore: 50, totalFeedbackReceived: 20 });
  const second = score({ posts: [makePost({}), makePost({})], trustScore: 50, totalFeedbackReceived: 20 });
  const marginalFirst = second - first;

  assert.ok(marginal60 < marginalFirst, `marginal60=${marginal60} should be < marginalFirst=${marginalFirst}`);
});

test("saves + confirmations received contribute meaningfully to score", () => {
  const withInfluence = score({
    posts: [makePost({ saveCount: 8, SA: 5 })],
    trustScore: 50,
    totalFeedbackReceived: 20,
  });
  const bare = score({ posts: [makePost({})], trustScore: 50, totalFeedbackReceived: 20 });
  assert.ok(withInfluence > bare * 2, `saves+confirmations should at least double a bare review score`);
});

test("high trust gives only a small boost, not a huge jump", () => {
  const opts = { posts: Array.from({ length: 20 }, () => makePost({ hasPhoto: true })), totalFeedbackReceived: 30 };
  const highTrust = score({ ...opts, trustScore: 100 });
  const normalTrust = score({ ...opts, trustScore: 50 });
  const ratio = highTrust / normalTrust;
  assert.ok(ratio <= 1.2, `high trust boost should be ≤20%, got ${((ratio - 1) * 100).toFixed(1)}%`);
});

test("low trust with evidence slows growth but does not erase reputation", () => {
  const opts = { posts: Array.from({ length: 20 }, () => makePost({ hasPhoto: true })), totalFeedbackReceived: 40 };
  const lowTrust = score({ ...opts, trustScore: 10 });
  const normalTrust = score({ ...opts, trustScore: 50 });
  assert.ok(lowTrust > 0, "low trust should still produce positive score");
  assert.ok(lowTrust < normalTrust * 0.8, `low trust should reduce score by >20%, got ${lowTrust.toFixed(1)} vs ${normalTrust.toFixed(1)}`);
});

// ─── Trust Score isolation ────────────────────────────────────────────────────

test("Trust Score functions (calculateTrustScore) are not present in reputation module", () => {
  // Reputation module must not export any taste-trust calculation logic.
  // Trust Score lives in lib/taste-trust.ts; reputation module only uses the value as a multiplier.
  assert.equal(typeof R.calculateTasteTrust, "undefined");
  assert.equal(typeof R.recalculateTasteTrust, "undefined");
  assert.equal(typeof R.summarizePostFeedback, "undefined");
});

// ─── Score always non-negative ────────────────────────────────────────────────

test("calculateProfileScore always returns a non-negative value", () => {
  assert.ok(score({ posts: [] }) >= 0);
  assert.ok(score({ posts: [makePost({ D: 10, SD: 10 })], trustScore: 0, totalFeedbackReceived: 100 }) >= 0);
  // Legacy posts[] call signature still works
  assert.ok(R.calculateProfileScore([{ SA: 2, A: 1, createdAt: new Date().toISOString() }]) >= 0);
});
