import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

function loadComparisonModule() {
  const moduleSource = source("lib/server/explore-canonical-comparison.ts");
  const { outputText } = ts.transpileModule(moduleSource, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    console,
    Date,
    module: mod,
    exports: mod.exports
  });
  return mod.exports;
}

function place(overrides = {}) {
  return {
    area: "HITEC City",
    averageRating: 4.5,
    categoryTags: [],
    circleReviewers: [],
    key: "place:place-1",
    name: "Paradise HITEC City",
    photo: null,
    placeId: "place-1",
    postCount: 2,
    ratingCount: 2,
    tags: [],
    topDishes: ["Chicken Biryani"],
    ...overrides
  };
}

function dish(overrides = {}) {
  return {
    averageRating: 4.5,
    categoryTags: [],
    familyId: "biryani",
    familyName: "Biryani",
    key: "raw:chicken biryani",
    mentionCount: 1,
    name: "Chicken Biryani",
    photo: null,
    ratingCount: 1,
    snippet: null,
    tags: [],
    topRestaurantNames: ["Paradise HITEC City"],
    ...overrides
  };
}

function page(overrides = {}) {
  return {
    dishes: [dish()],
    people: [],
    places: [place()],
    viewerName: "",
    ...overrides
  };
}

function review(overrides = {}) {
  return {
    area: "HITEC City",
    created_at: "2026-07-10T10:00:00.000Z",
    deleted_at: null,
    hidden_at: null,
    id: "review-1",
    items: [{ name: "Chicken Biryani", rating: 5 }],
    reported_at: null,
    restaurant_address: "HITEC City",
    restaurant_id: "place-1",
    restaurant_lat: 17.45,
    restaurant_lng: 78.38,
    restaurant_name: "Paradise HITEC City",
    reviewer_name: "alice",
    status: "active",
    visibility: "public",
    ...overrides
  };
}

function mention(overrides = {}) {
  return {
    candidate_id: null,
    canonical_dish_id: "dish-biryani",
    deleted_at: null,
    id: "mention-1",
    item_position: 0,
    normalized_name: "chicken biryani",
    place_id: "place-1",
    raw_name: "Chicken Biryani",
    review_id: "review-1",
    ...overrides
  };
}

function createReadOnlyDb(seed = {}) {
  const tables = {
    canonical_dishes: seed.canonical_dishes ?? [{
      display_name: "Chicken Biryani",
      id: "dish-biryani",
      merged_into_dish_id: null,
      status: "verified"
    }],
    dish_candidates: seed.dish_candidates ?? [],
    review_dish_mentions: seed.review_dish_mentions ?? [mention()],
    reviews: seed.reviews ?? [review()]
  };
  const rpcResponses = {
    explore_discovery_canonical_v2: seed.canonicalResponse ?? page(),
    explore_discovery_v1: seed.oldResponse ?? page()
  };
  const rpcErrors = seed.rpcErrors ?? {};
  const rpcCalls = [];
  let mutationCount = 0;

  function chainFor(table) {
    let rangeBounds = null;
    const chain = {
      select() {
        return chain;
      },
      range(from, to) {
        rangeBounds = { from, to };
        return chain;
      },
      insert() {
        mutationCount += 1;
        throw new Error("comparison report must not write");
      },
      update() {
        mutationCount += 1;
        throw new Error("comparison report must not write");
      },
      delete() {
        mutationCount += 1;
        throw new Error("comparison report must not write");
      },
      upsert() {
        mutationCount += 1;
        throw new Error("comparison report must not write");
      },
      then(resolve, reject) {
        return execute().then(resolve, reject);
      },
      catch(reject) {
        return execute().catch(reject);
      }
    };

    async function execute() {
      let rows = tables[table];
      if (!rows) throw new Error(`Unexpected table ${table}`);
      if (rangeBounds) rows = rows.slice(rangeBounds.from, rangeBounds.to + 1);
      return { data: rows, error: null };
    }

    return chain;
  }

  return {
    from(table) {
      return chainFor(table);
    },
    rpc(name, args) {
      rpcCalls.push({ args, name });
      if (rpcErrors[name]) return Promise.resolve({ data: null, error: { message: rpcErrors[name] } });
      return Promise.resolve({ data: rpcResponses[name], error: null });
    },
    get mutationCount() {
      return mutationCount;
    },
    rpcCalls
  };
}

const {
  buildExploreCanonicalComparisonReport,
  formatExploreCanonicalComparisonReport
} = loadComparisonModule();

test("comparison report succeeds when both RPCs return compatible payloads", async () => {
  const db = createReadOnlyDb();
  const report = await buildExploreCanonicalComparisonReport(db, { limit: 30 });

  assert.equal(report.rpcAvailability.old_rpc.status, "success");
  assert.equal(report.rpcAvailability.canonical_rpc.status, "success");
  assert.equal(report.comparison.places.oldCount, 1);
  assert.equal(report.comparison.places.canonicalCount, 1);
  assert.equal(report.comparison.dishes.oldCount, 1);
  assert.equal(report.recommendation.status, "READY_TO_ENABLE_CANONICAL_EXPLORE");
  assert.equal(db.mutationCount, 0);
  assert.deepEqual(db.rpcCalls.map((call) => call.name), [
    "explore_discovery_v1",
    "explore_discovery_canonical_v2"
  ]);
});

test("canonical RPC failure makes the recommendation not ready", async () => {
  const db = createReadOnlyDb({
    rpcErrors: {
      explore_discovery_canonical_v2: "function not deployed"
    }
  });
  const report = await buildExploreCanonicalComparisonReport(db);

  assert.equal(report.rpcAvailability.canonical_rpc.status, "failure");
  assert.equal(report.recommendation.status, "NOT_READY_CANONICAL_EXPLORE");
  assert.match(report.recommendation.blockers[0], /Canonical RPC failed/);
});

test("places can keep coverage while canonical top dishes are reduced", async () => {
  const db = createReadOnlyDb({
    oldResponse: page({
      places: [place({ topDishes: ["Chicken Manchuria", "Chiken Biryani"] })]
    }),
    canonicalResponse: page({
      places: [place({ topDishes: ["Chicken Biryani"] })]
    })
  });
  const report = await buildExploreCanonicalComparisonReport(db);
  const sharedPlace = report.comparison.places.shared[0];

  assert.equal(report.coverage.placeCoverage, 1);
  assert.equal(sharedPlace.status, "reduced");
  assert.deepEqual(sharedPlace.topDishes.canonical, ["Chicken Biryani"]);
  assert.equal(report.comparison.places.topDishEmptyRegressions.length, 0);
});

test("raw dish variants can be reported as collapsing into one canonical dish", async () => {
  const db = createReadOnlyDb({
    oldResponse: page({
      dishes: [
        dish({ key: "raw:chicken-manchuria", name: "Chicken Manchuria" }),
        dish({ key: "raw:chicken-manchurian", name: "Chicken Manchurian" }),
        dish({ key: "raw:chiken-manchurian", name: "Chiken Manchurian" })
      ]
    }),
    canonicalResponse: page({
      dishes: [
        dish({ key: "canonical:dish-manchurian", name: "Chicken Manchurian" })
      ]
    })
  });
  const report = await buildExploreCanonicalComparisonReport(db);

  assert.equal(report.comparison.dishes.potentialVariantCollapses.length, 1);
  assert.equal(report.comparison.dishes.potentialVariantCollapses[0].canonicalName, "Chicken Manchurian");
  assert.ok(report.comparison.dishes.potentialVariantCollapses[0].oldNames.includes("Chicken Manchuria"));
});

test("candidate exclusion impact is reported from selected active mentions", async () => {
  const db = createReadOnlyDb({
    dish_candidates: [{
      evidence_count: 7,
      id: "candidate-sumchi",
      normalized_name: "sumchi",
      place_id: "place-1",
      raw_name: "Sumchi",
      status: "new"
    }],
    review_dish_mentions: [
      mention(),
      mention({
        candidate_id: "candidate-sumchi",
        canonical_dish_id: null,
        id: "mention-candidate",
        normalized_name: "sumchi",
        raw_name: "Sumchi",
        review_id: "review-2"
      })
    ],
    reviews: [
      review(),
      review({
        id: "review-2",
        items: [{ name: "Sumchi", rating: 4 }],
        reviewer_name: "bob"
      })
    ]
  });
  const report = await buildExploreCanonicalComparisonReport(db);

  assert.equal(report.candidateExclusionImpact.candidateMentionCount, 1);
  assert.equal(report.candidateExclusionImpact.topExcludedCandidates[0].candidateId, "candidate-sumchi");
  assert.equal(report.candidateExclusionImpact.placesMostAffected[0].candidateMentionCount, 1);
});

test("JSON output shape and human output are stable", async () => {
  const report = await buildExploreCanonicalComparisonReport(createReadOnlyDb(), { includeRaw: true });
  const json = JSON.parse(JSON.stringify(report));
  const text = formatExploreCanonicalComparisonReport(report);

  assert.equal(typeof json.rpcAvailability.old_rpc.status, "string");
  assert.equal(typeof json.coverage.placeCoverage, "number");
  assert.ok(json.raw.old.places.length > 0);
  assert.match(text, /Canonical Explore Comparison Report/);
  assert.match(text, /Candidate Exclusion Impact/);
  assert.match(text, /Recommendation/);
});

test("comparison implementation and CLI stay read-only", async () => {
  const db = createReadOnlyDb();
  await buildExploreCanonicalComparisonReport(db);
  const moduleSource = source("lib/server/explore-canonical-comparison.ts");
  const scriptSource = source("scripts/compare-canonical-explore.mjs");

  assert.equal(db.mutationCount, 0);
  assert.doesNotMatch(moduleSource, /\.(?:insert|update|delete|upsert)\(/);
  assert.doesNotMatch(scriptSource, /\.(?:insert|update|delete|upsert)\(/);
});
