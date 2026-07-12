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
        if (id === "@/lib/server/dish-candidate-review") return load("lib/server/dish-candidate-review.ts");
        if (id === "@/lib/server/dish-candidate-reresolve") return load("lib/server/dish-candidate-reresolve.ts");
        if (id === "@/lib/server/dish-trigram") return load("lib/server/dish-trigram.ts");
        if (id === "@/lib/types") return {};
        throw new Error(`Unexpected require in candidate review tests: ${id}`);
      }
    });
    cache.set(relativePath, mod.exports);
    return mod.exports;
  }
  return {
    review: load("lib/server/dish-candidate-review.ts"),
    reresolve: load("lib/server/dish-candidate-reresolve.ts")
  };
}

function createReadOnlyDb(seed = {}) {
  const state = {
    canonical_dishes: [...(seed.canonical_dishes ?? [])],
    dish_aliases: [...(seed.dish_aliases ?? [])],
    dish_candidates: [...(seed.dish_candidates ?? [])],
    review_dish_mentions: [...(seed.review_dish_mentions ?? [])]
  };
  let mutationCount = 0;

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
      update() {
        mutationCount += 1;
        throw new Error("dry-run must not update");
      },
      insert() {
        mutationCount += 1;
        throw new Error("dry-run must not insert");
      },
      delete() {
        mutationCount += 1;
        throw new Error("dry-run must not delete");
      },
      upsert() {
        mutationCount += 1;
        throw new Error("dry-run must not upsert");
      },
      then(resolve, reject) {
        return execute().then(resolve, reject);
      },
      catch(reject) {
        return execute().catch(reject);
      }
    };

    async function execute() {
      let rows = rowsFor(table).filter((row) => matches(row, filters));
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

const { review, reresolve } = loadModules();
const { classifyDishCandidate } = review;
const { reresolveCandidateDishMentions } = reresolve;

test("candidate classifier marks Khow Suey as safe_to_seed", () => {
  const result = classifyDishCandidate({ rawName: "Khow Suey" });

  assert.equal(result.classification, "safe_to_seed");
});

test("candidate classifier marks Cghj as likely_junk_or_test", () => {
  const result = classifyDishCandidate({ rawName: "Cghj" });

  assert.equal(result.classification, "likely_junk_or_test");
});

test("candidate classifier marks Mutton as too_vague", () => {
  const result = classifyDishCandidate({ rawName: "Mutton" });

  assert.equal(result.classification, "too_vague");
});

test("safe seed expansion migration is mirrored, idempotent, and avoids junk inputs", () => {
  const rootMigration = source("supabase/migrations/202607110004_dish_identity_safe_seed_expansion.sql");
  const mobileMigration = source("mobile/supabase/migrations/202607110004_dish_identity_safe_seed_expansion.sql");

  assert.equal(mobileMigration, rootMigration);
  assert.match(rootMigration, /where not exists/i);
  assert.doesNotMatch(rootMigration, /\bdelete\s+from\b/i);
  assert.doesNotMatch(rootMigration, /\btruncate\b/i);
  assert.doesNotMatch(rootMigration, /\bdo update\b/i);
  for (const safeDish of ["Khow Suey", "Dindigul Biryani", "Chicken Shawarma", "Hummus", "Mutton Kuzhambu", "Shan Noodles", "Tonkotsu Ramen"]) {
    assert.match(rootMigration, new RegExp(`'${safeDish}'`, "i"));
  }
  for (const unsafeName of ["Hui", "Cghj"]) {
    assert.doesNotMatch(rootMigration, new RegExp(`'${unsafeName}'`, "i"));
  }
});

test("safe seed expansion does not duplicate Parotta from the base seed catalog", () => {
  const baseMigration = source("supabase/migrations/202607110002_dish_identity_seed_catalog.sql");
  const expansion = source("supabase/migrations/202607110004_dish_identity_safe_seed_expansion.sql");

  assert.equal((baseMigration.match(/'Parotta'/g) ?? []).length, 1);
  assert.equal((expansion.match(/Parotta/g) ?? []).length, 0);
});

test("re-resolve dry-run maps exact and alias candidates without mutating", async () => {
  const db = createReadOnlyDb({
    canonical_dishes: [{
      display_name: "Khow Suey",
      family_id: "family-noodles",
      id: "dish-khow-suey",
      merged_into_dish_id: null,
      normalized_name: "khow suey",
      status: "verified"
    }, {
      display_name: "Dindigul Biryani",
      family_id: "family-biryani",
      id: "dish-dindigul-biryani",
      merged_into_dish_id: null,
      normalized_name: "dindigul biryani",
      status: "verified"
    }],
    dish_aliases: [{
      alias_text: "dindigul biriyani",
      canonical_dish_id: "dish-dindigul-biryani",
      id: "alias-dindigul-biriyani",
      normalized_alias: "dindigul biriyani",
      status: "active"
    }],
    dish_candidates: [{
      evidence_count: 4,
      id: "candidate-khow",
      normalized_name: "khow suey",
      raw_name: "Khow Suey",
      status: "new"
    }, {
      evidence_count: 2,
      id: "candidate-dindigul",
      normalized_name: "dindigul biriyani",
      raw_name: "Dindigul Biriyani",
      status: "new"
    }],
    review_dish_mentions: [{
      candidate_id: "candidate-khow",
      canonical_dish_id: null,
      deleted_at: null,
      id: "mention-khow",
      item_position: 0,
      normalized_name: "khow suey",
      raw_name: "Khow Suey",
      review_id: "review-khow"
    }, {
      candidate_id: "candidate-dindigul",
      canonical_dish_id: null,
      deleted_at: null,
      id: "mention-dindigul",
      item_position: 0,
      normalized_name: "dindigul biriyani",
      raw_name: "Dindigul Biriyani",
      review_id: "review-dindigul"
    }]
  });

  const summary = await reresolveCandidateDishMentions(db, { dryRun: true, limit: 100 });

  assert.equal(summary.wouldUpdateMentions, 2);
  assert.equal(summary.updatedMentions, 0);
  assert.equal(summary.matches.some((match) => match.matchStatus === "exact" && match.canonicalDishId === "dish-khow-suey"), true);
  assert.equal(summary.matches.some((match) => match.matchStatus === "alias" && match.canonicalDishId === "dish-dindigul-biryani"), true);
  assert.equal(db.mutationCount, 0);
});

test("re-resolve dry-run does not map vague or junk candidates", async () => {
  const db = createReadOnlyDb({
    canonical_dishes: [{
      display_name: "Mutton",
      family_id: "family-mutton",
      id: "dish-mutton",
      merged_into_dish_id: null,
      normalized_name: "mutton",
      status: "verified"
    }],
    dish_candidates: [{
      evidence_count: 1,
      id: "candidate-cghj",
      normalized_name: "cghj",
      raw_name: "Cghj",
      status: "new"
    }, {
      evidence_count: 1,
      id: "candidate-mutton",
      normalized_name: "mutton",
      raw_name: "Mutton",
      status: "new"
    }],
    review_dish_mentions: [{
      candidate_id: "candidate-cghj",
      canonical_dish_id: null,
      deleted_at: null,
      id: "mention-cghj",
      item_position: 0,
      normalized_name: "cghj",
      raw_name: "Cghj",
      review_id: "review-cghj"
    }, {
      candidate_id: "candidate-mutton",
      canonical_dish_id: null,
      deleted_at: null,
      id: "mention-mutton",
      item_position: 0,
      normalized_name: "mutton",
      raw_name: "Mutton",
      review_id: "review-mutton"
    }]
  });

  const summary = await reresolveCandidateDishMentions(db, { dryRun: true, limit: 100 });

  assert.equal(summary.wouldUpdateMentions, 0);
  assert.equal(summary.skippedVagueOrJunk.length, 2);
  assert.equal(db.mutationCount, 0);
});

test("re-resolve dry-run does not fuzzy-map Sumchi to Sushi", async () => {
  const db = createReadOnlyDb({
    canonical_dishes: [{
      display_name: "Sushi",
      family_id: "family-sushi",
      id: "dish-sushi",
      merged_into_dish_id: null,
      normalized_name: "sushi",
      status: "verified"
    }],
    dish_candidates: [{
      evidence_count: 1,
      id: "candidate-sumchi",
      normalized_name: "sumchi",
      raw_name: "Sumchi",
      status: "new"
    }],
    review_dish_mentions: [{
      candidate_id: "candidate-sumchi",
      canonical_dish_id: null,
      deleted_at: null,
      id: "mention-sumchi",
      item_position: 0,
      normalized_name: "sumchi",
      raw_name: "Sumchi",
      review_id: "review-sumchi"
    }]
  });

  const summary = await reresolveCandidateDishMentions(db, { dryRun: true, limit: 100 });

  assert.equal(summary.wouldUpdateMentions, 0);
  assert.equal(summary.skippedNoExactOrAliasMatch, 1);
  assert.equal(db.mutationCount, 0);
});
