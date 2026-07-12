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
        if (id === "@/lib/server/dish-place-id-repair") return load("lib/server/dish-place-id-repair.ts");
        if (id === "@/lib/server/dish-place-id-repair-report") return load("lib/server/dish-place-id-repair-report.ts");
        throw new Error(`Unexpected require in place-id repair tests: ${id}`);
      }
    });
    cache.set(relativePath, mod.exports);
    return mod.exports;
  }
  return load("lib/server/dish-place-id-repair.ts");
}

function createReview(overrides = {}) {
  return {
    area: "Anna Nagar",
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

function safeSeed() {
  return {
    reviews: [
      createReview({ id: "review-source", restaurant_id: "nagi-ramen-anna-nagar" }),
      createReview({ id: "review-missing", restaurant_id: null })
    ],
    review_dish_mentions: [
      createMention({ id: "mention-source", place_id: "nagi-ramen-anna-nagar", review_id: "review-source" }),
      createMention({ id: "mention-missing", place_id: null, review_id: "review-missing" })
    ]
  };
}

function createMemoryDb(seed = {}, options = {}) {
  const state = {
    review_dish_mentions: [...(seed.review_dish_mentions ?? [])],
    reviews: [...(seed.reviews ?? [])]
  };
  const mutations = [];

  function rowsFor(table) {
    if (!Object.hasOwn(state, table)) throw new Error(`Unexpected table ${table}`);
    return state[table];
  }

  function matches(row, filters) {
    return filters.every((filter) => {
      if (filter.type === "eq") return row[filter.column] === filter.value;
      if (filter.type === "is") return (row[filter.column] ?? null) === filter.value;
      return true;
    });
  }

  function chainFor(table) {
    const filters = [];
    let rangeBounds = null;
    let updatePayload = null;
    const chain = {
      select() { return chain; },
      range(from, to) {
        rangeBounds = { from, to };
        return chain;
      },
      eq(column, value) {
        filters.push({ column, type: "eq", value });
        return chain;
      },
      is(column, value) {
        filters.push({ column, type: "is", value });
        return chain;
      },
      insert() {
        throw new Error("repair command must not insert");
      },
      update(value) {
        if (options.rejectUpdates) throw new Error("dry-run must not update");
        updatePayload = value;
        return chain;
      },
      delete() {
        throw new Error("repair command must not delete");
      },
      upsert() {
        throw new Error("repair command must not upsert");
      },
      rpc() {
        throw new Error("repair command must not call rpc");
      },
      then(resolve, reject) {
        return execute().then(resolve, reject);
      },
      catch(reject) {
        return execute().catch(reject);
      }
    };

    async function execute() {
      const rows = rowsFor(table);
      if (updatePayload) {
        mutations.push({ filters: [...filters], payload: updatePayload, table });
        for (const row of rows) {
          if (matches(row, filters)) Object.assign(row, updatePayload);
        }
        return { data: null, error: null };
      }
      let result = rows;
      if (rangeBounds) result = result.slice(rangeBounds.from, rangeBounds.to + 1);
      return { data: result, error: null };
    }

    return chain;
  }

  return {
    from(table) {
      return chainFor(table);
    },
    mutations,
    state
  };
}

const { formatPlaceIdRepairSummary, repairReviewDishMentionPlaceIds } = loadModules();

test("dry-run identifies safe unique slug repair", async () => {
  const db = createMemoryDb(safeSeed(), { rejectUpdates: true });
  const summary = await repairReviewDishMentionPlaceIds(db, { dryRun: true, limit: 10 });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.mentionsEligibleForRepair, 1);
  assert.equal(summary.mentionsThatWouldBeUpdated, 1);
  assert.equal(summary.mentionsUpdated, 0);
  assert.equal(summary.safeGroupsUsed, 1);
  assert.equal(db.state.review_dish_mentions.find((row) => row.id === "mention-missing").place_id, null);
});

test("apply updates only review_dish_mentions.place_id", async () => {
  const db = createMemoryDb(safeSeed());
  const summary = await repairReviewDishMentionPlaceIds(db, { apply: true, limit: 10 });

  assert.equal(summary.mentionsUpdated, 1);
  assert.equal(db.state.review_dish_mentions.find((row) => row.id === "mention-missing").place_id, "nagi-ramen-anna-nagar");
  assert.equal(db.mutations.length, 1);
  assert.equal(db.mutations[0].table, "review_dish_mentions");
  assert.equal(JSON.stringify(db.mutations[0].payload), JSON.stringify({ place_id: "nagi-ramen-anna-nagar" }));
});

test("apply does not update reviews restaurant_id", async () => {
  const db = createMemoryDb(safeSeed());
  await repairReviewDishMentionPlaceIds(db, { apply: true, limit: 10 });

  assert.equal(db.state.reviews.find((row) => row.id === "review-missing").restaurant_id, null);
  assert.equal(db.mutations.some((mutation) => mutation.table === "reviews"), false);
});

test("ambiguous groups are skipped", async () => {
  const db = createMemoryDb({
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
  });

  const summary = await repairReviewDishMentionPlaceIds(db, { apply: true, limit: 10 });

  assert.equal(summary.mentionsUpdated, 0);
  assert.equal(summary.mentionsSkippedAmbiguous, 1);
});

test("insufficient-data group is skipped", async () => {
  const db = createMemoryDb({
    reviews: [
      createReview({ area: null, id: "review-missing", restaurant_address: null, restaurant_id: null })
    ],
    review_dish_mentions: [createMention({ id: "mention-missing", review_id: "review-missing" })]
  });

  const summary = await repairReviewDishMentionPlaceIds(db, { apply: true, limit: 10 });

  assert.equal(summary.mentionsUpdated, 0);
  assert.equal(summary.mentionsSkippedInsufficientData, 1);
});

test("google-only group is skipped", async () => {
  const db = createMemoryDb({
    reviews: [
      createReview({ id: "source-google", restaurant_id: "ChIJGooglePlace123" }),
      createReview({ id: "review-missing", restaurant_id: null })
    ],
    review_dish_mentions: [
      createMention({ id: "source-mention", place_id: "ChIJGooglePlace123", review_id: "source-google" }),
      createMention({ id: "mention-missing", review_id: "review-missing" })
    ]
  });

  const summary = await repairReviewDishMentionPlaceIds(db, { apply: true, limit: 10 });

  assert.equal(summary.mentionsUpdated, 0);
  assert.equal(summary.mentionsSkippedGoogleOnly, 1);
});

test("already-filled mention place_id is skipped", async () => {
  const db = createMemoryDb(safeSeed());
  db.state.review_dish_mentions.find((row) => row.id === "mention-missing").place_id = "existing-place-id";

  const summary = await repairReviewDishMentionPlaceIds(db, { apply: true, limit: 10 });

  assert.equal(summary.mentionsUpdated, 0);
  assert.equal(summary.mentionsSkippedAlreadyWithPlaceId, 2);
});

test("suppressed or deleted review mention is skipped", async () => {
  const db = createMemoryDb({
    reviews: [
      createReview({ id: "review-source", restaurant_id: "nagi-ramen-anna-nagar" }),
      createReview({ deleted_at: "2026-01-02T00:00:00.000Z", id: "review-missing", restaurant_id: null })
    ],
    review_dish_mentions: [
      createMention({ id: "mention-source", place_id: "nagi-ramen-anna-nagar", review_id: "review-source" }),
      createMention({ id: "mention-missing", review_id: "review-missing" })
    ]
  });

  const summary = await repairReviewDishMentionPlaceIds(db, { apply: true, limit: 10 });

  assert.equal(summary.mentionsUpdated, 0);
  assert.equal(summary.mentionsSkippedSuppressedDeleted, 1);
});

test("Bawarchi-like missing area and address group is skipped", async () => {
  const db = createMemoryDb({
    reviews: [
      createReview({
        area: null,
        id: "review-bawarchi",
        restaurant_address: null,
        restaurant_id: null,
        restaurant_name: "Bawarchi Restaurant"
      })
    ],
    review_dish_mentions: [
      createMention({
        id: "mention-bawarchi",
        normalized_name: "chicken biriyani",
        raw_name: "Chicken Biriyani",
        review_id: "review-bawarchi"
      })
    ]
  });

  const summary = await repairReviewDishMentionPlaceIds(db, { apply: true, limit: 10 });

  assert.equal(summary.mentionsUpdated, 0);
  assert.equal(summary.mentionsSkippedInsufficientData, 1);
});

test("idempotency: rerun does not rewrite already repaired rows", async () => {
  const db = createMemoryDb(safeSeed());

  const first = await repairReviewDishMentionPlaceIds(db, { apply: true, limit: 10 });
  const second = await repairReviewDishMentionPlaceIds(db, { apply: true, limit: 10 });

  assert.equal(first.mentionsUpdated, 1);
  assert.equal(second.mentionsUpdated, 0);
  assert.equal(second.mentionsSkippedAlreadyWithPlaceId, 2);
  assert.equal(db.mutations.length, 1);
});

test("dry-run makes no update calls", async () => {
  const db = createMemoryDb(safeSeed(), { rejectUpdates: true });
  await repairReviewDishMentionPlaceIds(db, { dryRun: true, limit: 10 });

  assert.equal(db.mutations.length, 0);
});

test("JSON output shape and human output are stable", async () => {
  const db = createMemoryDb(safeSeed());
  const summary = await repairReviewDishMentionPlaceIds(db, { dryRun: true, limit: 10 });
  const formatted = formatPlaceIdRepairSummary(summary);

  assert.equal(summary.safeGroupsUsed, 1);
  assert.equal(summary.safeGroups[0].candidateSlug, "nagi-ramen-anna-nagar");
  assert.match(formatted, /Controlled Place-ID Repair/);
  assert.match(formatted, /mentions that would be updated: 1/);
});
