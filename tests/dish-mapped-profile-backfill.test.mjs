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
      Date,
      module: mod,
      exports: mod.exports,
      require(id) {
        if (id === "@/lib/server/dish-identity") return load("lib/server/dish-identity.ts");
        if (id === "@/lib/server/dish-identity-backfill") return load("lib/server/dish-identity-backfill.ts");
        if (id === "@/lib/server/dish-mapped-profile-backfill") return load("lib/server/dish-mapped-profile-backfill.ts");
        if (id === "@/lib/server/dish-trigram") return load("lib/server/dish-trigram.ts");
        if (id === "@/lib/types") return {};
        throw new Error(`Unexpected require in mapped-profile backfill tests: ${id}`);
      }
    });
    cache.set(relativePath, mod.exports);
    return mod.exports;
  }
  return load("lib/server/dish-mapped-profile-backfill.ts");
}

function createReview(overrides = {}) {
  return {
    created_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    hidden_at: null,
    id: `review-${Math.random().toString(36).slice(2)}`,
    items: [{ name: "Chicken Biryani", rating: 5 }],
    reported_at: null,
    restaurant_id: "place-1",
    restaurant_name: "Good Food",
    reviewer_name: "Rahul Gupta",
    status: "active",
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

function createMemoryDb(seed = {}, options = {}) {
  const state = {
    canonical_dishes: [...(seed.canonical_dishes ?? [])],
    dish_aliases: [...(seed.dish_aliases ?? [])],
    dish_candidates: [...(seed.dish_candidates ?? [])],
    dish_families: [...(seed.dish_families ?? [])],
    profiles: [...(seed.profiles ?? [createProfile({ id: "profile-rahul" })])],
    review_dish_mentions: [...(seed.review_dish_mentions ?? [])],
    reviews: [...(seed.reviews ?? [])]
  };
  const mutations = [];
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
      order(column, orderOptions = {}) {
        orders.push({ ascending: orderOptions.ascending !== false, column });
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
        if (options.rejectMutations) throw new Error("dry-run must not insert");
        insertPayload = value;
        return chain;
      },
      update(value) {
        if (options.rejectMutations) throw new Error("dry-run must not update");
        updatePayload = value;
        return chain;
      },
      delete() {
        if (options.rejectMutations) throw new Error("dry-run must not delete");
        throw new Error("delete not expected");
      },
      upsert() {
        if (options.rejectMutations) throw new Error("dry-run must not upsert");
        throw new Error("upsert not expected");
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
        mutations.push({ op: "update", table, payload: updatePayload });
        for (const row of rows) {
          if (matches(row, filters)) Object.assign(row, updatePayload);
        }
        return { data: null, error: null };
      }
      if (insertPayload) {
        mutations.push({ op: "insert", table, payload: insertPayload });
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
    mutations,
    state
  };
}

const { backfillMappedProfileDishMentions } = loadModules();

test("dry-run maps display-name review to exactly one profile", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      family_id: "family-biryani",
      id: "dish-chicken-biryani",
      merged_into_dish_id: null,
      normalized_name: "chicken biryani",
      status: "verified"
    }],
    reviews: [createReview({ id: "review-rahul" })]
  });

  const summary = await backfillMappedProfileDishMentions(db, { batchSize: 10 });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.reviewsSafeMapped, 1);
  assert.equal(summary.mentionsThatWouldBeCreated, 1);
  assert.equal(summary.canonicalMatchesExpected, 1);
  assert.equal(summary.generatedCanonicalsExpected, 0);
  assert.equal(db.state.review_dish_mentions.length, 0);
});

test("ambiguous display-name profile match is skipped", async () => {
  const db = createMemoryDb({
    profiles: [
      createProfile({ id: "profile-1", username: "rahul_g" }),
      createProfile({ id: "profile-2", username: "rahul_gupta" })
    ],
    reviews: [createReview({ id: "review-ambiguous" })]
  });

  const summary = await backfillMappedProfileDishMentions(db, { batchSize: 10 });

  assert.equal(summary.reviewsSafeMapped, 0);
  assert.equal(summary.reviewsAmbiguous, 1);
  assert.match(summary.safetyBlockers[0], /ambiguous/);
});

test("unmatched display-name review is skipped", async () => {
  const db = createMemoryDb({
    profiles: [createProfile({ id: "profile-rahul" })],
    reviews: [createReview({ id: "review-unmatched", reviewer_name: "Unknown Person" })]
  });

  const summary = await backfillMappedProfileDishMentions(db, { batchSize: 10 });

  assert.equal(summary.reviewsSafeMapped, 0);
  assert.equal(summary.reviewsUnmatched, 1);
  assert.match(summary.safetyBlockers[0], /no safe display-name/);
});

test("existing active mention rows are skipped", async () => {
  const db = createMemoryDb({
    review_dish_mentions: [{
      deleted_at: null,
      id: "mention-existing",
      review_id: "review-existing",
      source: "backfill"
    }],
    reviews: [createReview({ id: "review-existing" })]
  });

  const summary = await backfillMappedProfileDishMentions(db, { batchSize: 10 });

  assert.equal(summary.reviewsSkippedExistingMentions, 1);
  assert.equal(summary.reviewsSafeMapped, 0);
});

test("suppressed and deleted reviews are skipped", async () => {
  const db = createMemoryDb({
    reviews: [
      createReview({ deleted_at: "2026-01-02T00:00:00.000Z", id: "review-deleted" }),
      createReview({ id: "review-hidden", hidden_at: "2026-01-02T00:00:00.000Z" })
    ]
  });

  const summary = await backfillMappedProfileDishMentions(db, { batchSize: 10 });

  assert.equal(summary.reviewsSkippedSuppressedDeleted, 2);
  assert.equal(summary.reviewsSafeMapped, 0);
});

test("dry-run does not insert update delete or upsert", async () => {
  const db = createMemoryDb({
    reviews: [createReview({ id: "review-dry" })]
  }, { rejectMutations: true });

  const summary = await backfillMappedProfileDishMentions(db, { batchSize: 10, dryRun: true });

  assert.equal(summary.reviewsSafeMapped, 1);
  assert.equal(db.mutations.length, 0);
});

test("apply mode writes mentions for safe unique matches", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      family_id: "family-biryani",
      id: "dish-chicken-biryani",
      merged_into_dish_id: null,
      normalized_name: "chicken biryani",
      status: "verified"
    }],
    reviews: [createReview({ id: "review-apply" })]
  });

  const summary = await backfillMappedProfileDishMentions(db, { apply: true, batchSize: 10 });
  const mention = db.state.review_dish_mentions[0];

  assert.equal(summary.reviewsBackfilled, 1);
  assert.equal(summary.mentionsCreated, 1);
  assert.equal(mention.review_id, "review-apply");
  assert.equal(mention.user_id, "profile-rahul");
  assert.equal(mention.canonical_dish_id, "dish-chicken-biryani");
  assert.equal(mention.source, "backfill");
});

test("apply mode does not update reviews or create profiles", async () => {
  const db = createMemoryDb({
    reviews: [createReview({ id: "review-no-profile-mutation", items: [{ name: "New Dish", rating: 4 }] })]
  });

  await backfillMappedProfileDishMentions(db, { apply: true, batchSize: 10 });

  assert.equal(db.state.profiles.length, 1);
  assert.equal(db.mutations.some((mutation) => mutation.table === "reviews"), false);
  assert.equal(db.mutations.some((mutation) => mutation.table === "profiles"), false);
});

test("unknown dish becomes a generated canonical", async () => {
  const db = createMemoryDb({
    reviews: [createReview({ id: "review-candidate", items: [{ name: "New Dish", rating: 4 }] })]
  });

  await backfillMappedProfileDishMentions(db, { apply: true, batchSize: 10 });
  const mention = db.state.review_dish_mentions[0];

  assert.equal(db.state.dish_candidates.length, 0);
  assert.equal(db.state.canonical_dishes.some((row) => row.normalized_name === "new dish" && row.status === "generated"), true);
  assert.equal(mention.candidate_id, null);
  assert.equal(mention.match_status, "exact");
});

test("exact seeded canonical dish becomes canonical mention", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      family_id: "family-hummus",
      id: "dish-hummus",
      merged_into_dish_id: null,
      normalized_name: "hummus",
      status: "verified"
    }],
    reviews: [createReview({ id: "review-hummus", items: [{ name: "Hummus", rating: 5 }] })]
  });

  await backfillMappedProfileDishMentions(db, { apply: true, batchSize: 10 });
  const mention = db.state.review_dish_mentions[0];

  assert.equal(mention.canonical_dish_id, "dish-hummus");
  assert.equal(mention.candidate_id, null);
  assert.equal(mention.match_status, "exact");
});

test("no fuzzy matching: Sumchi does not become Sushi", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      family_id: "family-sushi",
      id: "dish-sushi",
      merged_into_dish_id: null,
      normalized_name: "sushi",
      status: "verified"
    }],
    reviews: [createReview({ id: "review-sumchi", items: [{ name: "Sumchi", rating: 3 }] })]
  });

  await backfillMappedProfileDishMentions(db, { apply: true, batchSize: 10 });
  const mention = db.state.review_dish_mentions[0];

  assert.notEqual(mention.canonical_dish_id, "dish-sushi");
  assert.equal(mention.match_status, "exact");
  assert.equal(mention.candidate_id, null);
  assert.equal(db.state.dish_candidates.length, 0);
  assert.equal(db.state.canonical_dishes.some((row) => row.normalized_name === "sumchi" && row.status === "generated"), true);
});

test("idempotency: rerun does not duplicate mentions", async () => {
  const db = createMemoryDb({
    reviews: [createReview({ id: "review-repeat", items: [{ name: "New Dish", rating: 4 }] })]
  });

  const first = await backfillMappedProfileDishMentions(db, { apply: true, batchSize: 10 });
  const second = await backfillMappedProfileDishMentions(db, { apply: true, batchSize: 10 });
  const activeMentions = db.state.review_dish_mentions.filter((row) => row.deleted_at == null);

  assert.equal(first.reviewsBackfilled, 1);
  assert.equal(second.reviewsBackfilled, 0);
  assert.equal(second.reviewsSkippedExistingMentions, 1);
  assert.equal(activeMentions.length, 1);
  assert.equal(db.state.dish_candidates.length, 0);
  assert.equal(db.state.canonical_dishes.length, 1);
});
