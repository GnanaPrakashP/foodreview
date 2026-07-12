import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

function loadModules() {
  const cache = new Map();
  function load(relativePath) {
    if (cache.has(relativePath)) return cache.get(relativePath);
    const { outputText } = ts.transpileModule(source(relativePath), {
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
      Date,
      module: mod,
      exports: mod.exports,
      require(id) {
        if (id === "@/lib/server/dish-identity") return load("lib/server/dish-identity.ts");
        if (id === "@/lib/server/dish-identity-backfill") return load("lib/server/dish-identity-backfill.ts");
        if (id === "@/lib/server/dish-missing-profile-map") return load("lib/server/dish-missing-profile-map.ts");
        if (id === "@/lib/server/dish-trigram") return load("lib/server/dish-trigram.ts");
        if (id === "@/lib/types") return {};
        throw new Error(`Unexpected require in missing-profile map tests: ${id}`);
      }
    });
    cache.set(relativePath, mod.exports);
    return mod.exports;
  }
  return load("lib/server/dish-missing-profile-map.ts");
}

function createReview(overrides = {}) {
  return {
    area: "T. Nagar",
    created_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    hidden_at: null,
    id: `review-${Math.random().toString(36).slice(2)}`,
    items: [{ name: "Chicken Biryani", rating: 5 }],
    reported_at: null,
    restaurant_id: "ChIJPlaceOne",
    restaurant_name: "Good Food",
    reviewer_name: "Rahul Gupta",
    status: "active",
    visibility: "public",
    ...overrides
  };
}

function createProfile(overrides = {}) {
  return {
    first_name: "Rahul",
    id: `profile-${Math.random().toString(36).slice(2)}`,
    last_name: "Gupta",
    username: "rahul_g",
    ...overrides
  };
}

function createReadOnlyDb(seed = {}) {
  const state = {
    profiles: [...(seed.profiles ?? [])],
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

const { buildMissingProfileMapReport, formatMissingProfileMapReport } = loadModules();

test("Rahul Gupta maps to profile first_name Rahul and last_name Gupta", async () => {
  const db = createReadOnlyDb({
    profiles: [createProfile({ id: "profile-rahul", username: "rahul_g" })],
    reviews: [createReview({ id: "review-rahul", reviewer_name: "Rahul Gupta" })]
  });

  const report = await buildMissingProfileMapReport(db, { limit: 10 });
  const row = report.rows[0];

  assert.equal(row.classification, "safe_unique_match");
  assert.equal(row.matchStrategy, "display_name");
  assert.equal(row.matchedProfileId, "profile-rahul");
  assert.equal(row.matchedUsername, "rahul_g");
});

test("username exact match works", async () => {
  const report = await buildMissingProfileMapReport(createReadOnlyDb({
    profiles: [createProfile({ id: "profile-rahul", username: "rahul_g" })],
    reviews: [createReview({ id: "review-rahul", reviewer_name: "rahul_g" })]
  }), { limit: 10 });

  assert.equal(report.rows[0].classification, "safe_unique_match");
  assert.equal(report.rows[0].matchStrategy, "exact_username");
});

test("case-insensitive username match works", async () => {
  const report = await buildMissingProfileMapReport(createReadOnlyDb({
    profiles: [createProfile({ id: "profile-rahul", username: "rahul_g" })],
    reviews: [createReview({ id: "review-rahul", reviewer_name: "Rahul_G" })]
  }), { limit: 10 });

  assert.equal(report.rows[0].classification, "safe_unique_match");
  assert.equal(report.rows[0].matchStrategy, "case_insensitive_username");
});

test("ambiguous display name produces ambiguous_match", async () => {
  const report = await buildMissingProfileMapReport(createReadOnlyDb({
    profiles: [
      createProfile({ id: "profile-rahul-1", username: "rahul_g" }),
      createProfile({ id: "profile-rahul-2", username: "rahul_gupta" })
    ],
    reviews: [createReview({ id: "review-rahul", reviewer_name: "Rahul Gupta" })]
  }), { includeAmbiguous: true, limit: 10 });

  assert.equal(report.rows[0].classification, "ambiguous_match");
  assert.equal(report.rows[0].matchStrategy, "display_name");
  assert.equal(report.rows[0].matchedProfileCandidates.length, 2);
  assert.equal(report.recommendation.status, "NEEDS_MANUAL_REVIEW");
});

test("unmatched name produces unmatched", async () => {
  const report = await buildMissingProfileMapReport(createReadOnlyDb({
    profiles: [createProfile({ id: "profile-rahul", username: "rahul_g" })],
    reviews: [createReview({ id: "review-unknown", reviewer_name: "Unknown Person" })]
  }), { includeUnmatched: true, limit: 10 });

  assert.equal(report.rows[0].classification, "unmatched");
  assert.equal(report.summary.unmatchedReviews, 1);
});

test("blank name produces unsafe_blank_name", async () => {
  const report = await buildMissingProfileMapReport(createReadOnlyDb({
    profiles: [createProfile({ id: "profile-rahul", username: "rahul_g" })],
    reviews: [createReview({ id: "review-blank", reviewer_name: "  " })]
  }), { limit: 10 });

  assert.equal(report.rows[0].classification, "unsafe_blank_name");
  assert.equal(report.summary.blankUnsafeNames, 1);
});

test("junk/test review classification works conservatively", async () => {
  const report = await buildMissingProfileMapReport(createReadOnlyDb({
    profiles: [createProfile({ id: "profile-rahul", username: "rahul_g" })],
    reviews: [createReview({
      id: "review-test",
      items: [{ name: "Cghj", rating: 1 }],
      restaurant_name: "test",
      reviewer_name: "Rahul Gupta"
    })]
  }), { limit: 10 });

  assert.equal(report.rows[0].classification, "test_or_junk_review");
  assert.equal(report.summary.testOrJunkReviews, 1);
});

test("command/report is read-only", async () => {
  const db = createReadOnlyDb({
    profiles: [createProfile({ id: "profile-rahul", username: "rahul_g" })],
    reviews: [createReview({ id: "review-rahul", reviewer_name: "Rahul Gupta" })]
  });
  await buildMissingProfileMapReport(db, { limit: 10 });

  assert.equal(db.mutationCount, 0);
  const moduleSource = source("lib/server/dish-missing-profile-map.ts");
  const scriptSource = source("scripts/dish-missing-profile-map.mjs");
  for (const text of [moduleSource, scriptSource]) {
    assert.doesNotMatch(text, /\.insert\s*\(/);
    assert.doesNotMatch(text, /\.update\s*\(/);
    assert.doesNotMatch(text, /\.delete\s*\(/);
    assert.doesNotMatch(text, /\.upsert\s*\(/);
    assert.doesNotMatch(text, /\.rpc\s*\(/);
  }
});

test("JSON shape and human output are stable enough for operators", async () => {
  const report = await buildMissingProfileMapReport(createReadOnlyDb({
    profiles: [createProfile({ id: "profile-rahul", username: "rahul_g" })],
    reviews: [createReview({ id: "review-rahul", reviewer_name: "Rahul Gupta" })]
  }), { limit: 10 });
  const formatted = formatMissingProfileMapReport(report);

  assert.equal(report.summary.totalMissingProfileReviews, 1);
  assert.equal(report.summary.safeUniqueMatches, 1);
  assert.equal(report.recommendation.status, "SAFE_TO_IMPLEMENT_CONTROLLED_MAPPING_BACKFILL");
  assert.match(formatted, /Missing-Profile Review Owner Mapping Report/);
  assert.match(formatted, /safe unique matches: 1/);
  assert.match(formatted, /SAFE_TO_IMPLEMENT_CONTROLLED_MAPPING_BACKFILL/);
});
