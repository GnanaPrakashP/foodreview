import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

function loadModules() {
  const moduleSource = source("lib/server/dish-place-id-repair-report.ts");
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

function createReview(overrides = {}) {
  return {
    area: "Anna Nagar",
    created_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    hidden_at: null,
    id: `review-${Math.random().toString(36).slice(2)}`,
    items: [{ name: "Khow Suey", rating: 5 }],
    reported_at: null,
    restaurant_address: null,
    restaurant_id: null,
    restaurant_name: "Nagi Ramen",
    reviewer_name: "alice",
    status: "active",
    visibility: "public",
    ...overrides
  };
}

function createMention(overrides = {}) {
  return {
    candidate_id: "candidate-khow-suey",
    canonical_dish_id: null,
    deleted_at: null,
    id: `mention-${Math.random().toString(36).slice(2)}`,
    normalized_name: "khow suey",
    place_id: null,
    raw_name: "Khow Suey",
    review_id: "review-missing",
    source: "backfill",
    ...overrides
  };
}

function createReadOnlyDb(seed = {}) {
  const state = {
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
      rpc() {
        mutationCount += 1;
        throw new Error("report must not call rpc");
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

const { buildPlaceIdRepairReport, formatPlaceIdRepairReport } = loadModules();

test("missing restaurant_id review maps to exactly one slug using restaurant_name and area", async () => {
  const db = createReadOnlyDb({
    reviews: [
      createReview({ id: "review-source", restaurant_id: "nagi-ramen-anna-nagar" }),
      createReview({ id: "review-missing", restaurant_id: null })
    ],
    review_dish_mentions: [
      createMention({ id: "mention-source", place_id: "nagi-ramen-anna-nagar", review_id: "review-source" }),
      createMention({ id: "mention-missing", place_id: null, review_id: "review-missing" })
    ]
  });

  const report = await buildPlaceIdRepairReport(db, { limit: 10 });
  const row = report.rows[0];

  assert.equal(row.classification, "safe_unique_slug_match");
  assert.equal(row.mappingStrategy, "restaurant_name_area");
  assert.equal(row.candidateSlug, "nagi-ramen-anna-nagar");
  assert.equal(row.missingMentionCount, 1);
  assert.equal(report.summary.mentionsEligibleForSafeRepair, 1);
});

test("ambiguous group with two slug IDs is classified as ambiguous", async () => {
  const report = await buildPlaceIdRepairReport(createReadOnlyDb({
    reviews: [
      createReview({ id: "source-1", restaurant_id: "nagi-ramen-anna-nagar" }),
      createReview({ id: "source-2", restaurant_id: "nagi-ramen-new-anna-nagar" }),
      createReview({ id: "review-missing", restaurant_id: null })
    ],
    review_dish_mentions: [
      createMention({ id: "source-mention-1", place_id: "nagi-ramen-anna-nagar", review_id: "source-1" }),
      createMention({ id: "source-mention-2", place_id: "nagi-ramen-new-anna-nagar", review_id: "source-2" }),
      createMention({ id: "mention-missing", review_id: "review-missing" })
    ]
  }), { includeAmbiguous: true, limit: 10 });

  assert.equal(report.rows[0].classification, "ambiguous_slug_match");
  assert.equal(
    JSON.stringify(report.rows[0].candidateSlugIds),
    JSON.stringify(["nagi-ramen-anna-nagar", "nagi-ramen-new-anna-nagar"])
  );
  assert.equal(report.summary.ambiguousGroups, 1);
});

test("Google-only match is not used as slug repair", async () => {
  const report = await buildPlaceIdRepairReport(createReadOnlyDb({
    reviews: [
      createReview({ id: "source-google", restaurant_id: "ChIJGooglePlace123" }),
      createReview({ id: "review-missing", restaurant_id: null })
    ],
    review_dish_mentions: [
      createMention({ id: "source-mention", place_id: "ChIJGooglePlace123", review_id: "source-google" }),
      createMention({ id: "mention-missing", review_id: "review-missing" })
    ]
  }), { limit: 10 });

  assert.equal(report.rows[0].classification, "google_only_match");
  assert.equal(report.rows[0].candidateSlug, null);
  assert.equal(JSON.stringify(report.rows[0].googlePlaceIds), JSON.stringify(["ChIJGooglePlace123"]));
});

test("missing area and address is classified as insufficient data", async () => {
  const report = await buildPlaceIdRepairReport(createReadOnlyDb({
    reviews: [
      createReview({ area: null, id: "review-missing", restaurant_address: null, restaurant_id: null })
    ],
    review_dish_mentions: [
      createMention({ id: "mention-missing", review_id: "review-missing" })
    ]
  }), { limit: 10 });

  assert.equal(report.rows[0].classification, "insufficient_place_data");
  assert.equal(report.summary.insufficientDataGroups, 1);
});

test("junk or test place is not repaired", async () => {
  const report = await buildPlaceIdRepairReport(createReadOnlyDb({
    reviews: [
      createReview({ area: "Test Area", id: "review-test", restaurant_id: null, restaurant_name: "test" })
    ],
    review_dish_mentions: [
      createMention({ id: "mention-test", review_id: "review-test" })
    ]
  }), { limit: 10 });

  assert.equal(report.rows[0].classification, "junk_or_test_place");
  assert.equal(report.summary.junkOrTestGroups, 1);
});

test("candidate place split impact is reported", async () => {
  const report = await buildPlaceIdRepairReport(createReadOnlyDb({
    reviews: [
      createReview({ id: "source", restaurant_id: "burma-burma-nungambakkam", restaurant_name: "Burma Burma", area: "Nungambakkam" }),
      createReview({ id: "missing", restaurant_id: null, restaurant_name: "Burma Burma", area: "Nungambakkam" })
    ],
    review_dish_mentions: [
      createMention({ id: "source-khow", place_id: "burma-burma-nungambakkam", review_id: "source" }),
      createMention({ id: "missing-khow", place_id: null, review_id: "missing" })
    ]
  }), { limit: 10 });
  const impact = report.candidatePlaceSplitImpact.find((row) => row.normalizedName === "khow suey");

  assert.equal(impact.mentionCount, 2);
  assert.equal(impact.currentPlaceIdPresent, 1);
  assert.equal(impact.wouldGainPlaceId, 1);
  assert.equal(impact.afterRepairPlaceIdPresent, 2);
  assert.equal(JSON.stringify(impact.candidateSlugs), JSON.stringify(["burma-burma-nungambakkam"]));
});

test("projected coverage is calculated correctly", async () => {
  const report = await buildPlaceIdRepairReport(createReadOnlyDb({
    reviews: [
      createReview({ id: "source", restaurant_id: "nagi-ramen-anna-nagar" }),
      createReview({ id: "safe-missing", restaurant_id: null }),
      createReview({ area: null, id: "unsafe-missing", restaurant_address: null, restaurant_id: null })
    ],
    review_dish_mentions: [
      createMention({ id: "source-mention", place_id: "nagi-ramen-anna-nagar", review_id: "source" }),
      createMention({ id: "safe-missing-mention", place_id: null, review_id: "safe-missing" }),
      createMention({ id: "unsafe-missing-mention", place_id: null, review_id: "unsafe-missing" })
    ]
  }), { limit: 10 });

  assert.equal(report.summary.totalActiveMentions, 3);
  assert.equal(report.summary.mentionsMissingPlaceId, 2);
  assert.equal(report.summary.mentionsEligibleForSafeRepair, 1);
  assert.equal(report.summary.mentionsStillMissingAfterPossibleRepair, 1);
  assert.equal(Number(report.summary.projectedPlaceIdCoverageAfterRepair.toFixed(2)), 66.67);
});

test("JSON shape and human output are stable enough for operators", async () => {
  const report = await buildPlaceIdRepairReport(createReadOnlyDb({
    reviews: [
      createReview({ id: "source", restaurant_id: "nagi-ramen-anna-nagar" }),
      createReview({ id: "review-missing", restaurant_id: null })
    ],
    review_dish_mentions: [
      createMention({ id: "source-mention", place_id: "nagi-ramen-anna-nagar", review_id: "source" }),
      createMention({ id: "missing-mention", place_id: null, review_id: "review-missing" })
    ]
  }), { limit: 10 });
  const formatted = formatPlaceIdRepairReport(report);

  assert.equal(report.summary.safeUniqueGroups, 1);
  assert.equal(report.recommendation.status, "SAFE_TO_IMPLEMENT_PLACE_ID_REPAIR_APPLY");
  assert.match(formatted, /Legacy Place-ID Repair Report/);
  assert.match(formatted, /mentions eligible for safe repair: 1/);
});

test("command and report are read-only", async () => {
  const db = createReadOnlyDb({
    reviews: [
      createReview({ id: "source", restaurant_id: "nagi-ramen-anna-nagar" }),
      createReview({ id: "review-missing", restaurant_id: null })
    ],
    review_dish_mentions: [
      createMention({ id: "source-mention", place_id: "nagi-ramen-anna-nagar", review_id: "source" }),
      createMention({ id: "missing-mention", place_id: null, review_id: "review-missing" })
    ]
  });

  await buildPlaceIdRepairReport(db, { limit: 10 });

  assert.equal(db.mutationCount, 0);
  const moduleSource = source("lib/server/dish-place-id-repair-report.ts");
  const scriptSource = source("scripts/dish-place-id-repair-report.mjs");
  for (const text of [moduleSource, scriptSource]) {
    assert.doesNotMatch(text, /\.insert\s*\(/);
    assert.doesNotMatch(text, /\.update\s*\(/);
    assert.doesNotMatch(text, /\.delete\s*\(/);
    assert.doesNotMatch(text, /\.upsert\s*\(/);
    assert.doesNotMatch(text, /\.rpc\s*\(/);
  }
});
