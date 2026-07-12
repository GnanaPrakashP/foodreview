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
        if (id === "@/lib/server/dish-trigram") return load("lib/server/dish-trigram.ts");
        if (id === "@/lib/types") return {};
        throw new Error(`Unexpected require in dish identity backfill tests: ${id}`);
      }
    });
    cache.set(relativePath, mod.exports);
    return mod.exports;
  }
  return {
    backfill: load("lib/server/dish-identity-backfill.ts"),
    identity: load("lib/server/dish-identity.ts")
  };
}

function createReview(overrides = {}) {
  return {
    created_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    hidden_at: null,
    id: `review-${Math.random().toString(36).slice(2)}`,
    items: [],
    reported_at: null,
    restaurant_id: "place-1",
    reviewer_name: "alice",
    status: "active",
    ...overrides
  };
}

function createMemoryDb(seed = {}) {
  const state = {
    canonical_dishes: [...(seed.canonical_dishes ?? [])],
    dish_aliases: [...(seed.dish_aliases ?? [])],
    dish_candidates: [...(seed.dish_candidates ?? [])],
    dish_families: [...(seed.dish_families ?? [])],
    profiles: [...(seed.profiles ?? [{ id: "user-alice", username: "alice" }])],
    review_dish_mentions: [...(seed.review_dish_mentions ?? [])],
    reviews: [...(seed.reviews ?? [])]
  };
  let candidateSeq = state.dish_candidates.length + 1;
  let dishSeq = state.canonical_dishes.length + 1;
  let mentionSeq = state.review_dish_mentions.length + 1;

  function rowsFor(table) {
    if (!Object.hasOwn(state, table)) throw new Error(`Unexpected table ${table}`);
    return state[table];
  }

  function matches(row, filters) {
    return filters.every((filter) => {
      if (filter.type === "eq") return row[filter.column] === filter.value;
      if (filter.type === "in") return filter.values.includes(row[filter.column]);
      if (filter.type === "is") return (row[filter.column] ?? null) === filter.value;
      return true;
    });
  }

  function chainFor(table) {
    const filters = [];
    const orders = [];
    let rangeBounds = null;
    let limitCount = null;
    let insertPayload;
    let updatePayload;
    let singleMode = false;
    let maybeSingleMode = false;

    const chain = {
      select() { return chain; },
      eq(column, value) {
        filters.push({ column, type: "eq", value });
        return chain;
      },
      in(column, values) {
        filters.push({ column, type: "in", values });
        return chain;
      },
      is(column, value) {
        filters.push({ column, type: "is", value });
        return chain;
      },
      order(column, options = {}) {
        orders.push({ ascending: options.ascending !== false, column });
        return chain;
      },
      range(from, to) {
        rangeBounds = { from, to };
        return chain;
      },
      limit(value) {
        limitCount = value;
        return chain;
      },
      maybeSingle() {
        maybeSingleMode = true;
        return chain;
      },
      single() {
        singleMode = true;
        return chain;
      },
      insert(value) {
        insertPayload = value;
        return chain;
      },
      update(value) {
        updatePayload = value;
        return chain;
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
        for (const row of rows) {
          if (matches(row, filters)) Object.assign(row, updatePayload);
        }
        return { data: null, error: null };
      }
      if (insertPayload) {
        const payloads = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
        const inserted = payloads.map((payload) => {
          const row = { ...payload };
          if (table === "canonical_dishes") row.id ??= `dish-gen-${dishSeq++}`;
          if (table === "dish_candidates") row.id ??= `candidate-${candidateSeq++}`;
          if (table === "review_dish_mentions") row.id ??= `mention-${mentionSeq++}`;
          rows.push(row);
          return row;
        });
        return { data: singleMode ? inserted[0] : inserted, error: null };
      }

      let result = rows.filter((row) => matches(row, filters));
      for (const order of orders.reverse()) {
        result = result.slice().sort((left, right) => {
          const a = left[order.column] ?? "";
          const b = right[order.column] ?? "";
          if (a < b) return order.ascending ? -1 : 1;
          if (a > b) return order.ascending ? 1 : -1;
          return 0;
        });
      }
      if (rangeBounds) result = result.slice(rangeBounds.from, rangeBounds.to + 1);
      if (limitCount !== null) result = result.slice(0, limitCount);
      if (singleMode || maybeSingleMode) return { data: result[0] ?? null, error: null };
      return { data: result, error: null };
    }

    return chain;
  }

  return {
    from(table) {
      return chainFor(table);
    },
    state
  };
}

const { backfill } = loadModules();
const { backfillReviewDishMentions } = backfill;

test("backfill maps existing exact canonical reviews to canonical mentions", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      family_id: "family-biryani",
      id: "dish-chicken-biryani",
      merged_into_dish_id: null,
      normalized_name: "chicken biryani",
      status: "verified"
    }],
    reviews: [createReview({
      id: "review-exact",
      items: [{ name: "Chicken Biryani", rating: 5 }]
    })]
  });

  const summary = await backfillReviewDishMentions(db, { batchSize: 10 });
  const mention = db.state.review_dish_mentions[0];

  assert.equal(summary.reviewsBackfilled, 1);
  assert.equal(mention.canonical_dish_id, "dish-chicken-biryani");
  assert.equal(mention.candidate_id, null);
  assert.equal(mention.match_status, "exact");
  assert.equal(mention.source, "backfill");
});

test("backfill maps active aliases through safe canonical targets", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      family_id: "family-biryani",
      id: "dish-chicken-biryani",
      merged_into_dish_id: null,
      normalized_name: "chicken biryani",
      status: "verified"
    }],
    dish_aliases: [{
      canonical_dish_id: "dish-chicken-biryani",
      normalized_alias: "chiken biryani",
      status: "active"
    }],
    reviews: [createReview({
      id: "review-alias",
      items: [{ name: "Chicken Biryani", rawDishName: "Chiken Biryani", rating: 4 }]
    })]
  });

  const summary = await backfillReviewDishMentions(db, { batchSize: 10 });
  const mention = db.state.review_dish_mentions[0];

  assert.equal(summary.reviewsBackfilled, 1);
  assert.equal(mention.canonical_dish_id, "dish-chicken-biryani");
  assert.equal(mention.match_status, "alias");
  assert.equal(mention.raw_name, "Chiken Biryani");
});

test("backfill turns unknown Sumchi into a generated canonical instead of fuzzy Sushi", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      family_id: "family-sushi",
      id: "dish-sushi",
      merged_into_dish_id: null,
      normalized_name: "sushi",
      status: "verified"
    }],
    reviews: [createReview({
      id: "review-sumchi",
      items: [{ name: "Sumchi", rating: 3 }]
    })]
  });

  const summary = await backfillReviewDishMentions(db, { batchSize: 10 });
  const mention = db.state.review_dish_mentions[0];

  assert.equal(summary.reviewsBackfilled, 1);
  assert.notEqual(mention.canonical_dish_id, "dish-sushi");
  assert.equal(mention.candidate_id, null);
  assert.equal(mention.match_status, "exact");
  assert.equal(db.state.dish_candidates.length, 0);
  assert.equal(db.state.canonical_dishes.some((row) => row.normalized_name === "sumchi" && row.status === "generated"), true);
});

test("backfill preserves legacy generated metadata without trusting it", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      family_id: "family-sushi",
      id: "dish-sushi",
      merged_into_dish_id: null,
      normalized_name: "sushi",
      status: "verified"
    }],
    reviews: [createReview({
      id: "review-legacy",
      items: [{
        canonicalDishId: "sushi",
        canonicalDishName: "Sushi",
        canonicalDishSource: "known",
        dishNormalizationConfidence: 1,
        name: "Sushi",
        rating: 4,
        rawDishName: "Sumchi"
      }]
    })]
  });

  await backfillReviewDishMentions(db, { batchSize: 10 });
  const mention = db.state.review_dish_mentions[0];

  assert.equal(mention.raw_name, "Sumchi");
  assert.equal(mention.normalized_name, "sumchi");
  assert.notEqual(mention.canonical_dish_id, "dish-sushi");
  assert.equal(mention.candidate_id, null);
  assert.equal(mention.legacy_metadata.legacyCanonicalDishId, "sushi");
  assert.equal(mention.legacy_metadata.legacyCanonicalDishName, "Sushi");
});

test("backfill is idempotent and does not duplicate active rows", async () => {
  const db = createMemoryDb({
    reviews: [createReview({
      id: "review-repeat",
      items: [{ name: "Sumchi", rating: 3 }]
    })]
  });

  const first = await backfillReviewDishMentions(db, { batchSize: 10 });
  const second = await backfillReviewDishMentions(db, { batchSize: 10 });
  const activeMentions = db.state.review_dish_mentions.filter((row) => row.deleted_at == null);

  assert.equal(first.reviewsBackfilled, 1);
  assert.equal(second.reviewsBackfilled, 0);
  assert.equal(second.skippedExistingActive, 1);
  assert.equal(second.skippedBackfillMentions, 1);
  assert.equal(activeMentions.length, 1);
  assert.equal(db.state.dish_candidates.length, 0);
  assert.equal(db.state.canonical_dishes.length, 1);
});

test("backfill skips reviews that already have active server mentions", async () => {
  const db = createMemoryDb({
    review_dish_mentions: [{
      candidate_id: null,
      deleted_at: null,
      id: "mention-server",
      item_position: 0,
      normalized_name: "chicken biryani",
      review_id: "review-server",
      source: "server"
    }],
    reviews: [createReview({
      id: "review-server",
      items: [{ name: "Chicken Biryani", rating: 5 }]
    })]
  });

  const summary = await backfillReviewDishMentions(db, { batchSize: 10 });

  assert.equal(summary.reviewsBackfilled, 0);
  assert.equal(summary.skippedExistingActive, 1);
  assert.equal(summary.skippedServerMentions, 1);
  assert.equal(db.state.review_dish_mentions.length, 1);
});

test("backfill preserves raw/display names for Chicken Manchuria alias rows", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      family_id: "family-chicken",
      id: "dish-chicken-manchurian",
      merged_into_dish_id: null,
      normalized_name: "chicken manchurian",
      status: "verified"
    }],
    dish_aliases: [{
      canonical_dish_id: "dish-chicken-manchurian",
      normalized_alias: "chicken manchuria",
      status: "active"
    }],
    reviews: [createReview({
      id: "review-manchuria",
      items: [{ name: "Chicken Manchuria", rating: 5 }]
    })]
  });

  await backfillReviewDishMentions(db, { batchSize: 10 });
  const mention = db.state.review_dish_mentions[0];

  assert.equal(mention.match_status, "alias");
  assert.equal(mention.raw_name, "Chicken Manchuria");
  assert.equal(mention.display_name, "Chicken Manchuria");
});

test("backfill skips suppressed reviews by default and includes private active reviews", async () => {
  const db = createMemoryDb({
    reviews: [
      createReview({
        id: "review-deleted",
        deleted_at: "2026-01-02T00:00:00.000Z",
        items: [{ name: "Deleted Dish", rating: 4 }]
      }),
      createReview({
        id: "review-private",
        items: [{ name: "Private Dish", rating: 4 }],
        visibility: "me"
      })
    ]
  });

  const summary = await backfillReviewDishMentions(db, { batchSize: 10 });
  const activeMentions = db.state.review_dish_mentions.filter((row) => row.deleted_at == null);

  assert.equal(summary.skippedSuppressed, 1);
  assert.equal(summary.reviewsBackfilled, 1);
  assert.equal(activeMentions.length, 1);
  assert.equal(activeMentions[0].review_id, "review-private");
});
