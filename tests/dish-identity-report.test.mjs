import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadModules() {
  const cache = new Map();
  function load(relativePath) {
    if (cache.has(relativePath)) return cache.get(relativePath);
    const source = readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    });
    const mod = { exports: {} };
    cache.set(relativePath, mod.exports);
    vm.runInNewContext(outputText, {
      console,
      module: mod,
      exports: mod.exports,
      require(id) {
        if (id === "@/lib/server/dish-identity") return load("lib/server/dish-identity.ts");
        if (id === "@/lib/server/dish-identity-backfill") return load("lib/server/dish-identity-backfill.ts");
        if (id === "@/lib/server/dish-candidate-review") return load("lib/server/dish-candidate-review.ts");
        if (id === "@/lib/server/dish-identity-report") return load("lib/server/dish-identity-report.ts");
        if (id === "@/lib/server/dish-trigram") return load("lib/server/dish-trigram.ts");
        if (id === "@/lib/types") return {};
        throw new Error(`Unexpected require in dish identity report tests: ${id}`);
      }
    });
    cache.set(relativePath, mod.exports);
    return mod.exports;
  }
  return load("lib/server/dish-identity-report.ts");
}

function createReview(overrides = {}) {
  return {
    deleted_at: null,
    hidden_at: null,
    id: "review-1",
    items: [{ name: "Chicken Biryani", rating: 5 }],
    reported_at: null,
    restaurant_id: "ChIJPlaceOne",
    reviewer_name: "alice",
    status: "active",
    visibility: "public",
    ...overrides
  };
}

function createReadOnlyDb(seed = {}) {
  const state = {
    canonical_dishes: [...(seed.canonical_dishes ?? [])],
    dish_aliases: [...(seed.dish_aliases ?? [])],
    dish_candidates: [...(seed.dish_candidates ?? [])],
    profiles: [...(seed.profiles ?? [{ id: "user-alice", username: "alice" }, { id: "user-bob", username: "bob" }])],
    review_dish_mentions: [...(seed.review_dish_mentions ?? [])],
    reviews: [...(seed.reviews ?? [])]
  };
  let mutationCount = 0;

  function rowsFor(table) {
    if (!Object.hasOwn(state, table)) throw new Error(`Unexpected table ${table}`);
    return state[table];
  }

  function chainFor(table) {
    let rangeBounds = null;
    const chain = {
      select() { return chain; },
      range(from, to) {
        rangeBounds = { from, to };
        return chain;
      },
      insert() {
        mutationCount += 1;
        throw new Error("report must not insert");
      },
      update() {
        mutationCount += 1;
        throw new Error("report must not update");
      },
      delete() {
        mutationCount += 1;
        throw new Error("report must not delete");
      },
      upsert() {
        mutationCount += 1;
        throw new Error("report must not upsert");
      },
      then(resolve, reject) {
        return execute().then(resolve, reject);
      },
      catch(reject) {
        return execute().catch(reject);
      }
    };

    async function execute() {
      let rows = rowsFor(table);
      if (rangeBounds) rows = rows.slice(rangeBounds.from, rangeBounds.to + 1);
      return { data: rows, error: null };
    }

    return chain;
  }

  return {
    from(table) {
      return chainFor(table);
    },
    get mutationCount() {
      return mutationCount;
    },
    state
  };
}

const { buildDishIdentityReport, formatDishIdentityReport } = loadModules();

function baseSeed() {
  return {
    canonical_dishes: [{
      display_name: "Chicken Biryani",
      id: "dish-chicken-biryani",
      merged_into_dish_id: null,
      normalized_name: "chicken biryani",
      status: "verified"
    }],
    dish_aliases: [{
      alias_text: "chiken biryani",
      canonical_dish_id: "dish-chicken-biryani",
      id: "alias-1",
      normalized_alias: "chiken biryani",
      status: "active"
    }],
    dish_candidates: [{
      evidence_count: 7,
      id: "candidate-sumchi",
      normalized_name: "sumchi",
      place_id: "ChIJPlaceOne",
      raw_name: "Sumchi",
      status: "new"
    }, {
      evidence_count: 5,
      id: "candidate-chiken",
      normalized_name: "chiken biryani",
      place_id: "ChIJPlaceOne",
      raw_name: "Chiken Biryani",
      status: "new"
    }],
    review_dish_mentions: [{
      candidate_id: null,
      canonical_dish_id: "dish-chicken-biryani",
      created_at: "2026-01-03T00:00:00.000Z",
      deleted_at: null,
      family_id: "family-biryani",
      id: "mention-canonical",
      item_position: 0,
      match_status: "exact",
      normalized_name: "chicken biryani",
      place_id: "ChIJPlaceOne",
      raw_name: "Chicken Biryani",
      review_id: "review-canonical",
      source: "server",
      user_id: "user-alice"
    }, {
      candidate_id: "candidate-sumchi",
      canonical_dish_id: null,
      created_at: "2026-01-04T00:00:00.000Z",
      deleted_at: null,
      family_id: null,
      id: "mention-candidate",
      item_position: 0,
      match_status: "candidate",
      normalized_name: "sumchi",
      place_id: "ChIJPlaceOne",
      raw_name: "Sumchi",
      review_id: "review-candidate",
      source: "backfill",
      user_id: "user-bob"
    }],
    reviews: [
      createReview({ id: "review-canonical", items: [{ name: "Chicken Biryani", rating: 5 }] }),
      createReview({ id: "review-candidate", items: [{ name: "Sumchi", rating: 3 }], reviewer_name: "bob" }),
      createReview({ id: "review-missing", items: [{ name: "Missing Mention", rating: 4 }], reviewer_name: "charlie" }),
      createReview({ deleted_at: "2026-01-05T00:00:00.000Z", id: "review-deleted", items: [{ name: "Deleted Dish", rating: 4 }] })
    ]
  };
}

test("report summarizes canonical, candidate, missing, and suppressed review coverage", async () => {
  const db = createReadOnlyDb(baseSeed());
  const report = await buildDishIdentityReport(db, { limit: 10 });

  assert.equal(report.reviewCoverage.totalReviewsWithItems, 4);
  assert.equal(report.reviewCoverage.scopedReviewsWithItems, 3);
  assert.equal(report.reviewCoverage.scopedReviewsWithActiveMentionRows, 2);
  assert.equal(report.reviewCoverage.scopedReviewsMissingMentionRows, 1);
  assert.equal(report.reviewCoverage.suppressedReviewsWithItems, 1);
  assert.equal(report.mentionDistribution.bySourceAndStatus["server exact"], 1);
  assert.equal(report.mentionDistribution.bySourceAndStatus["backfill candidate"], 1);
  assert.equal(report.mentionDistribution.canonicalDishId.present, 1);
  assert.equal(report.mentionDistribution.candidateId.present, 1);
  assert.equal(report.missingProfileAudit.activePublicReviewsMissingProfile, 1);
  assert.equal(report.missingProfileAudit.recommendation, "create_missing_profile_rows");
  assert.equal(db.mutationCount, 0);
});

test("report lists top candidate quality and place readiness", async () => {
  const db = createReadOnlyDb(baseSeed());
  const report = await buildDishIdentityReport(db, { limit: 10 });

  assert.equal(report.candidateQuality[0].candidateId, "candidate-sumchi");
  assert.equal(report.candidateQuality[0].reviewCount, 1);
  assert.equal(report.candidateQuality[0].userCount, 1);
  assert.equal(report.candidateQuality[0].placeCount, 1);
  assert.equal(report.candidateQuality[0].classification, "needs_self_curation");
  assert.equal(report.candidateQuality[0].examplePlaceNames.join(","), "ChIJPlaceOne");
  assert.equal(report.placeReadiness.mentionsWithPlaceId, 2);
  assert.equal(report.placeReadiness.mentionsMissingPlaceId, 0);
  assert.equal(report.placeReadiness.placeIdShape.overall, "google_provider");
  assert.equal(report.placeReadiness.topPlacesByMentionCount[0].placeId, "ChIJPlaceOne");
});

test("report emits duplicate active mention warnings", async () => {
  const seed = baseSeed();
  seed.review_dish_mentions.push({
    ...seed.review_dish_mentions[1],
    id: "mention-candidate-duplicate"
  });
  const report = await buildDishIdentityReport(createReadOnlyDb(seed), { limit: 10 });

  assert.equal(report.integrity.duplicateActiveMentionKeys.length, 1);
  assert.equal(report.readiness.status, "NEEDS_DATA_CLEANUP");
});

test("report suggests alias opportunities without mutating aliases", async () => {
  const seed = baseSeed();
  seed.review_dish_mentions.push({
    candidate_id: "candidate-chiken",
    canonical_dish_id: null,
    created_at: "2026-01-06T00:00:00.000Z",
    deleted_at: null,
    family_id: null,
    id: "mention-chiken",
    item_position: 0,
    match_status: "candidate",
    normalized_name: "chiken biryani",
    place_id: "ChIJPlaceOne",
    raw_name: "Chiken Biryani",
    review_id: "review-chiken",
    source: "backfill",
    user_id: "user-dana"
  });
  seed.reviews.push(createReview({ id: "review-chiken", items: [{ name: "Chiken Biryani", rating: 5 }], reviewer_name: "dana" }));
  const db = createReadOnlyDb(seed);
  const report = await buildDishIdentityReport(db, { limit: 10 });

  assert.ok(report.aliasOpportunities.some((item) => item.candidateId === "candidate-chiken"));
  assert.equal(db.state.dish_aliases.length, 1);
  assert.equal(db.mutationCount, 0);
});

test("report JSON shape and human output are stable enough for operators", async () => {
  const report = await buildDishIdentityReport(createReadOnlyDb(baseSeed()), { limit: 10 });
  const json = JSON.parse(JSON.stringify(report));
  const text = formatDishIdentityReport(report);

  assert.equal(typeof json.reviewCoverage.coveragePercentage, "number");
  assert.equal(typeof json.readiness.status, "string");
  assert.match(text, /Dish Identity Report/);
  assert.match(text, /Review Coverage/);
  assert.match(text, /Backfill Readiness Recommendation/);
});

test("report can include private and suppressed rows when requested", async () => {
  const seed = baseSeed();
  seed.reviews.push(createReview({
    id: "review-private",
    items: [{ name: "Private Dish", rating: 4 }],
    reviewer_name: "erin",
    visibility: "me"
  }));
  seed.review_dish_mentions.push({
    candidate_id: "candidate-sumchi",
    canonical_dish_id: null,
    created_at: "2026-01-07T00:00:00.000Z",
    deleted_at: null,
    family_id: null,
    id: "mention-private",
    item_position: 0,
    match_status: "candidate",
    normalized_name: "private dish",
    place_id: null,
    raw_name: "Private Dish",
    review_id: "review-private",
    source: "backfill",
    user_id: "user-erin"
  });

  const defaultReport = await buildDishIdentityReport(createReadOnlyDb(seed), { limit: 10 });
  const expandedReport = await buildDishIdentityReport(createReadOnlyDb(seed), {
    includePrivate: true,
    includeSuppressed: true,
    limit: 10
  });

  assert.equal(defaultReport.reviewCoverage.scopedReviewsWithItems, 3);
  assert.equal(expandedReport.reviewCoverage.scopedReviewsWithItems, 5);
  assert.ok(expandedReport.integrity.mentionsForSuppressedReviews.length >= 0);
});

test("place scoped report keeps missing mention place ids and excludes other places", async () => {
  const seed = baseSeed();
  seed.dish_candidates.push({
    evidence_count: 9,
    id: "candidate-other-place",
    normalized_name: "other place dish",
    place_id: "ChIJOtherPlace",
    raw_name: "Other Place Dish",
    status: "new"
  });
  seed.reviews.push(
    createReview({
      id: "review-place-with-missing-mention-place",
      items: [{ name: "Sumchi", rating: 4 }],
      reviewer_name: "fran",
      restaurant_id: "ChIJPlaceOne"
    }),
    createReview({
      id: "review-other-place",
      items: [{ name: "Other Place Dish", rating: 4 }],
      reviewer_name: "gabe",
      restaurant_id: "ChIJOtherPlace"
    })
  );
  seed.review_dish_mentions.push({
    candidate_id: "candidate-sumchi",
    canonical_dish_id: null,
    created_at: "2026-01-08T00:00:00.000Z",
    deleted_at: null,
    family_id: null,
    id: "mention-missing-place-id",
    item_position: 0,
    match_status: "candidate",
    normalized_name: "sumchi",
    place_id: null,
    raw_name: "Sumchi",
    review_id: "review-place-with-missing-mention-place",
    source: "backfill",
    user_id: "user-fran"
  }, {
    candidate_id: "candidate-other-place",
    canonical_dish_id: null,
    created_at: "2026-01-09T00:00:00.000Z",
    deleted_at: null,
    family_id: null,
    id: "mention-other-place",
    item_position: 0,
    match_status: "candidate",
    normalized_name: "other place dish",
    place_id: "ChIJOtherPlace",
    raw_name: "Other Place Dish",
    review_id: "review-other-place",
    source: "backfill",
    user_id: "user-gabe"
  });

  const report = await buildDishIdentityReport(createReadOnlyDb(seed), {
    limit: 10,
    placeId: "ChIJPlaceOne"
  });

  assert.equal(report.placeReadiness.mentionsWithPlaceId, 2);
  assert.equal(report.placeReadiness.mentionsMissingPlaceId, 1);
  assert.ok(report.candidateQuality.some((candidate) => candidate.candidateId === "candidate-sumchi"));
  assert.ok(!report.candidateQuality.some((candidate) => candidate.candidateId === "candidate-other-place"));
});
