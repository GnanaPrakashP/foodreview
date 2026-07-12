import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadDishIdentityModule() {
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
      Number,
      module: mod,
      exports: mod.exports,
      require(id) {
        if (id === "@/lib/server/dish-trigram") return load("lib/server/dish-trigram.ts");
        if (id === "@/lib/types") return {};
        throw new Error(`Unexpected require in dish identity resolver tests: ${id}`);
      }
    });
    cache.set(relativePath, mod.exports);
    return mod.exports;
  }
  return load("lib/server/dish-identity.ts");
}

function createMemoryDb(seed = {}) {
  const state = {
    canonical_dishes: [...(seed.canonical_dishes ?? [])],
    dish_aliases: [...(seed.dish_aliases ?? [])],
    dish_candidates: [...(seed.dish_candidates ?? [])],
    dish_families: [...(seed.dish_families ?? [])],
    review_dish_mentions: [...(seed.review_dish_mentions ?? [])]
  };
  let dishSeq = state.canonical_dishes.length + 1;
  let mentionSeq = state.review_dish_mentions.length + 1;

  function matches(row, filters) {
    return filters.every((filter) => {
      if (filter.type === "eq") return row[filter.column] === filter.value;
      if (filter.type === "in") return filter.values.includes(row[filter.column]);
      if (filter.type === "is") return (row[filter.column] ?? null) === filter.value;
      return true;
    });
  }

  function tableRows(table) {
    if (!Object.hasOwn(state, table)) throw new Error(`Unexpected table ${table}`);
    return state[table];
  }

  function chainFor(table) {
    const filters = [];
    let insertPayload;
    let updatePayload;
    let limitCount = null;
    let rangeBounds = null;
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
      limit(value) {
        limitCount = value;
        return chain;
      },
      range(from, to) {
        rangeBounds = [from, to];
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
      const rows = tableRows(table);
      if (updatePayload) {
        for (const row of rows) {
          if (matches(row, filters)) Object.assign(row, updatePayload);
        }
        return { data: null, error: null };
      }

      if (insertPayload) {
        const values = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
        const inserted = values.map((value) => {
          const row = { ...value };
          if (table === "canonical_dishes") row.id ??= `dish-gen-${dishSeq++}`;
          if (table === "review_dish_mentions") row.id ??= `mention-${mentionSeq++}`;
          rows.push(row);
          return row;
        });
        return { data: singleMode ? inserted[0] : inserted, error: null };
      }

      let result = rows.filter((row) => matches(row, filters));
      if (rangeBounds !== null) result = result.slice(rangeBounds[0], rangeBounds[1] + 1);
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

const {
  applyMajorityDishDisplayNames,
  normalizeDishIdentityName,
  replaceReviewDishMentions,
  resolveDishIdentity
} = loadDishIdentityModule();

const REVIEW_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

test("normalizer lowercases, trims, collapses whitespace, strips accents, and removes punctuation", () => {
  assert.equal(normalizeDishIdentityName("  Chïcken   Biryani!!! "), "chicken biryani");
});

test("known canonical exact match attaches canonical dish id", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      display_name: "Chicken Biryani",
      family_id: "family-biryani",
      id: "dish-chicken-biryani",
      merged_into_dish_id: null,
      normalized_name: "chicken biryani",
      status: "verified"
    }]
  });

  const result = await resolveDishIdentity(db, {
    normalizedName: normalizeDishIdentityName("Chicken Biryani"),
    rawName: "Chicken Biryani"
  });

  assert.equal(result.error, null);
  assert.equal(result.data.canonicalDishId, "dish-chicken-biryani");
  assert.equal(result.data.matchStatus, "exact");
  assert.equal(result.data.createdCanonical, false);
});

test("active alias exact match attaches the safe canonical target", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      display_name: "Chicken Biryani",
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
    }]
  });

  const result = await resolveDishIdentity(db, {
    normalizedName: normalizeDishIdentityName("Chiken Biryani"),
    rawName: "Chiken Biryani"
  });

  assert.equal(result.error, null);
  assert.equal(result.data.canonicalDishId, "dish-chicken-biryani");
  assert.equal(result.data.matchStatus, "alias");
});

test("close misspelling merges into the nearest canonical dish", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      display_name: "Chicken Manchurian",
      family_id: "family-manchurian",
      id: "dish-chicken-manchurian",
      merged_into_dish_id: null,
      normalized_name: "chicken manchurian",
      status: "verified"
    }]
  });

  const result = await resolveDishIdentity(db, {
    normalizedName: normalizeDishIdentityName("Chicken Manchuria"),
    rawName: "Chicken Manchuria"
  });

  assert.equal(result.error, null);
  assert.equal(result.data.canonicalDishId, "dish-chicken-manchurian");
  assert.equal(result.data.matchStatus, "high_confidence");
  assert.ok(result.data.matchConfidence >= 0.5);
  assert.equal(db.state.canonical_dishes.length, 1, "no new dish should be created for a spelling variant");
});

test("unknown Sumchi becomes a new canonical dish, not a fuzzy Sushi match", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      display_name: "Sushi",
      family_id: "family-sushi",
      id: "dish-sushi",
      merged_into_dish_id: null,
      normalized_name: "sushi",
      status: "verified"
    }]
  });

  const result = await resolveDishIdentity(db, {
    normalizedName: normalizeDishIdentityName("Sumchi"),
    rawName: "Sumchi"
  });

  assert.equal(result.error, null);
  assert.notEqual(result.data.canonicalDishId, "dish-sushi");
  assert.equal(result.data.matchStatus, "exact");
  assert.equal(result.data.createdCanonical, true);
  const created = db.state.canonical_dishes.find((row) => row.normalized_name === "sumchi");
  assert.ok(created, "expected a new canonical dish for Sumchi");
  assert.equal(created.display_name, "Sumchi");
  assert.equal(created.status, "generated");
});

test("an extra word is a different dish even when spelling is close", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      display_name: "Paneer Tikka",
      family_id: "family-paneer",
      id: "dish-paneer-tikka",
      merged_into_dish_id: null,
      normalized_name: "paneer tikka",
      status: "verified"
    }]
  });

  const result = await resolveDishIdentity(db, {
    normalizedName: normalizeDishIdentityName("Paneer Tikka Masala"),
    rawName: "Paneer Tikka Masala"
  });

  assert.equal(result.error, null);
  assert.notEqual(result.data.canonicalDishId, "dish-paneer-tikka");
  assert.equal(result.data.createdCanonical, true);
  assert.ok(db.state.canonical_dishes.some((row) => row.normalized_name === "paneer tikka masala"));
});

test("different first words never merge despite a shared second word", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      display_name: "Chicken Manchurian",
      family_id: null,
      id: "dish-chicken-manchurian",
      merged_into_dish_id: null,
      normalized_name: "chicken manchurian",
      status: "verified"
    }]
  });

  const result = await resolveDishIdentity(db, {
    normalizedName: normalizeDishIdentityName("Veg Manchurian"),
    rawName: "Veg Manchurian"
  });

  assert.equal(result.error, null);
  assert.notEqual(result.data.canonicalDishId, "dish-chicken-manchurian");
  assert.equal(result.data.createdCanonical, true);
});

test("new canonical dishes derive multiple family tokens from the typed name", async () => {
  const db = createMemoryDb({
    dish_families: [
      { id: "family-biryani", normalized_name: "biryani", status: "active" }
    ]
  });

  const result = await resolveDishIdentity(db, {
    normalizedName: normalizeDishIdentityName("Hyderabadi Veg Biryani"),
    rawName: "Hyderabadi Veg Biryani"
  });

  assert.equal(result.error, null);
  assert.equal(result.data.familyId, "family-biryani");
  assert.equal(JSON.stringify(result.data.familyTokens), JSON.stringify(["hyderabadi", "veg", "biryani"]));
  const created = db.state.canonical_dishes.find((row) => row.normalized_name === "hyderabadi veg biryani");
  assert.equal(created.family_id, "family-biryani");
  assert.equal(JSON.stringify(created.family_tokens), JSON.stringify(["hyderabadi", "veg", "biryani"]));
});

test("mention writes are idempotent and dish creation does not duplicate", async () => {
  const db = createMemoryDb();
  const items = [{ name: "Sumchi", rating: 4, rawDishName: "Sumchi" }];
  const submittedItems = [{ name: "Sumchi", rating: 4 }];

  const first = await replaceReviewDishMentions(db, {
    items,
    placeId: "place-1",
    reviewId: REVIEW_ID,
    submittedItems,
    userId: USER_ID
  });
  const second = await replaceReviewDishMentions(db, {
    items,
    placeId: "place-1",
    reviewId: REVIEW_ID,
    submittedItems,
    userId: USER_ID
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const activeMentions = db.state.review_dish_mentions.filter((row) => row.review_id === REVIEW_ID && row.deleted_at == null);
  assert.equal(activeMentions.length, 1);
  assert.equal(db.state.canonical_dishes.length, 1, "second write must reuse the dish created by the first");
  assert.equal(activeMentions[0].canonical_dish_id, db.state.canonical_dishes[0].id);
  assert.equal(activeMentions[0].candidate_id, null);
  assert.equal(JSON.stringify(activeMentions[0].family_tokens), JSON.stringify(["sumchi"]));
  assert.equal(db.state.dish_candidates.length, 0, "the write path no longer creates candidates");
});

test("raw and display names preserve the submitted text even when an alias maps canonically", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      display_name: "Chicken Manchurian",
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
    }]
  });

  const result = await replaceReviewDishMentions(db, {
    items: [{
      canonicalDishId: "generated:chicken-manchuria",
      canonicalDishName: "Chicken Manchuria",
      canonicalDishSource: "generated",
      dishClusterKey: "chicken-manchuria",
      dishFamilyId: "chicken",
      dishFamilyName: "Chicken",
      dishNormalizationConfidence: 0.65,
      name: "Chicken Manchuria",
      rating: 5,
      rawDishName: "Chicken Manchuria"
    }],
    placeId: "place-1",
    reviewId: REVIEW_ID,
    submittedItems: [{ name: "Chicken Manchuria", rating: 5 }],
    userId: USER_ID
  });

  assert.equal(result.ok, true);
  const mention = db.state.review_dish_mentions.find((row) => row.review_id === REVIEW_ID);
  assert.equal(mention.canonical_dish_id, "dish-chicken-manchurian");
  assert.equal(mention.candidate_id, null);
  assert.equal(mention.match_status, "alias");
  assert.equal(mention.raw_name, "Chicken Manchuria");
  assert.equal(mention.display_name, "Chicken Manchuria");
  assert.equal(mention.legacy_metadata.legacyCanonicalDishId, "generated:chicken-manchuria");
});

test("the pastam story: majority spelling takes over the canonical name", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      display_name: "Pastam",
      family_id: null,
      id: "dish-pastam",
      merged_into_dish_id: null,
      normalized_name: "pastam",
      status: "generated"
    }],
    review_dish_mentions: [
      { canonical_dish_id: "dish-pastam", deleted_at: null, id: "m-1", raw_name: "Pastam", review_id: "r-1" },
      { canonical_dish_id: "dish-pastam", deleted_at: null, id: "m-2", raw_name: "Pasta", review_id: "r-2" },
      { canonical_dish_id: "dish-pastam", deleted_at: null, id: "m-3", raw_name: "Pasta", review_id: "r-3" }
    ]
  });

  // A new review adds one more "Pasta" — the fuzzy match lands on Pastam,
  // and the write's rename pass flips the canonical name to the majority.
  const result = await replaceReviewDishMentions(db, {
    items: [{ name: "Pasta", rating: 4 }],
    placeId: "place-1",
    reviewId: REVIEW_ID,
    submittedItems: [{ name: "Pasta", rating: 4 }],
    userId: USER_ID
  });
  assert.equal(result.ok, true);

  const mention = db.state.review_dish_mentions.find((row) => row.review_id === REVIEW_ID);
  assert.equal(mention.canonical_dish_id, "dish-pastam");
  assert.equal(mention.match_status, "high_confidence");
  assert.equal(JSON.stringify(mention.family_tokens), JSON.stringify(["pasta"]));

  const dish = db.state.canonical_dishes.find((row) => row.id === "dish-pastam");
  assert.equal(dish.display_name, "Pasta");
  assert.equal(dish.normalized_name, "pasta");
  assert.equal(JSON.stringify(dish.family_tokens), JSON.stringify(["pasta"]));
  const alias = db.state.dish_aliases.find((row) => row.normalized_alias === "pastam");
  assert.ok(alias, "old spelling should remain reachable as an alias");
  assert.equal(alias.canonical_dish_id, "dish-pastam");
});

test("no rename without a clear majority", async () => {
  const db = createMemoryDb({
    canonical_dishes: [{
      display_name: "Pastam",
      family_id: null,
      id: "dish-pastam",
      merged_into_dish_id: null,
      normalized_name: "pastam",
      status: "generated"
    }],
    review_dish_mentions: [
      { canonical_dish_id: "dish-pastam", deleted_at: null, id: "m-1", raw_name: "Pastam", review_id: "r-1" },
      { canonical_dish_id: "dish-pastam", deleted_at: null, id: "m-2", raw_name: "Pasta", review_id: "r-2" }
    ]
  });

  const summary = await applyMajorityDishDisplayNames(db, ["dish-pastam"]);
  assert.equal(summary.renamed, 0);
  const dish = db.state.canonical_dishes.find((row) => row.id === "dish-pastam");
  assert.equal(dish.display_name, "Pastam", "a 1-vote lead must not flip the name");
});

test("rename never steals a name owned by another live dish", async () => {
  const db = createMemoryDb({
    canonical_dishes: [
      {
        display_name: "Pastam",
        family_id: null,
        id: "dish-pastam",
        merged_into_dish_id: null,
        normalized_name: "pastam",
        status: "generated"
      },
      {
        display_name: "Pasta",
        family_id: null,
        id: "dish-pasta",
        merged_into_dish_id: null,
        normalized_name: "pasta",
        status: "verified"
      }
    ],
    review_dish_mentions: [
      { canonical_dish_id: "dish-pastam", deleted_at: null, id: "m-1", raw_name: "Pasta", review_id: "r-1" },
      { canonical_dish_id: "dish-pastam", deleted_at: null, id: "m-2", raw_name: "Pasta", review_id: "r-2" },
      { canonical_dish_id: "dish-pastam", deleted_at: null, id: "m-3", raw_name: "Pasta", review_id: "r-3" }
    ]
  });

  const summary = await applyMajorityDishDisplayNames(db, ["dish-pastam"]);
  assert.equal(summary.renamed, 0);
  const dish = db.state.canonical_dishes.find((row) => row.id === "dish-pastam");
  assert.equal(dish.normalized_name, "pastam");
});
