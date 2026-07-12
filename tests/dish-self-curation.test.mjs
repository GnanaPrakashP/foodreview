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
      Number,
      module: mod,
      exports: mod.exports,
      require(id) {
        if (id === "@/lib/server/dish-identity") return load("lib/server/dish-identity.ts");
        if (id === "@/lib/server/dish-trigram") return load("lib/server/dish-trigram.ts");
        if (id === "@/lib/types") return {};
        throw new Error(`Unexpected require in self-curation tests: ${id}`);
      }
    });
    cache.set(relativePath, mod.exports);
    return mod.exports;
  }
  return {
    selfCuration: load("lib/server/dish-self-curation.ts"),
    trigram: load("lib/server/dish-trigram.ts")
  };
}

const modules = loadModules();
const { convertOpenDishCandidates, runMajorityRenameSweep } = modules.selfCuration;
const { dishNameMergeSimilarity } = modules.trigram;

function createFakeDb(seed = {}) {
  const state = {
    canonical_dishes: (seed.canonical_dishes ?? []).map((row) => ({ ...row })),
    dish_aliases: (seed.dish_aliases ?? []).map((row) => ({ ...row })),
    dish_candidates: (seed.dish_candidates ?? []).map((row) => ({ ...row })),
    dish_families: (seed.dish_families ?? []).map((row) => ({ ...row })),
    review_dish_mentions: (seed.review_dish_mentions ?? []).map((row) => ({ ...row }))
  };
  let dishSeq = 1;
  let mutations = 0;

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
    let insertPayload;
    let updatePayload;
    let limitCount = null;
    let rangeBounds = null;
    let singleMode = false;
    let maybeSingleMode = false;

    const chain = {
      select() { return chain; },
      eq(column, value) { filters.push({ column, type: "eq", value }); return chain; },
      in(column, values) { filters.push({ column, type: "in", values }); return chain; },
      is(column, value) { filters.push({ column, type: "is", value }); return chain; },
      limit(value) { limitCount = value; return chain; },
      range(from, to) { rangeBounds = [from, to]; return chain; },
      maybeSingle() { maybeSingleMode = true; return chain; },
      single() { singleMode = true; return chain; },
      insert(value) { insertPayload = value; return chain; },
      update(value) { updatePayload = value; return chain; },
      then(resolve, reject) { return execute().then(resolve, reject); }
    };

    async function execute() {
      const rows = state[table];
      if (!rows) throw new Error(`Unexpected table ${table}`);
      if (updatePayload) {
        mutations += 1;
        for (const row of rows) {
          if (matches(row, filters)) Object.assign(row, updatePayload);
        }
        return { data: null, error: null };
      }
      if (insertPayload) {
        mutations += 1;
        const values = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
        const inserted = values.map((value) => {
          const row = { ...value };
          if (table === "canonical_dishes") {
            const conflict = state.canonical_dishes.some(
              (existing) =>
                existing.normalized_name === row.normalized_name &&
                ["verified", "generated"].includes(existing.status) &&
                existing.merged_into_dish_id == null
            );
            if (conflict) return null;
            row.id ??= `dish-gen-${dishSeq++}`;
            row.merged_into_dish_id ??= null;
          }
          rows.push(row);
          return row;
        });
        if (inserted.includes(null)) return { data: null, error: { code: "23505", message: "duplicate" } };
        return { data: singleMode ? inserted[0] : inserted, error: null };
      }
      let result = rows.filter((row) => matches(row, filters)).map((row) => ({ ...row }));
      if (rangeBounds !== null) result = result.slice(rangeBounds[0], rangeBounds[1] + 1);
      if (limitCount !== null) result = result.slice(0, limitCount);
      if (singleMode || maybeSingleMode) return { data: result[0] ?? null, error: null };
      return { data: result, error: null };
    }

    return chain;
  }

  return {
    from: (table) => chainFor(table),
    get mutations() { return mutations; },
    state
  };
}

function candidateMention(id, candidateId, rawName, reviewId, userId) {
  return {
    candidate_id: candidateId,
    canonical_dish_id: null,
    deleted_at: null,
    id,
    raw_name: rawName,
    review_id: reviewId,
    user_id: userId
  };
}

function pastamSeed() {
  return {
    canonical_dishes: [],
    dish_candidates: [
      { id: "cand-1", normalized_name: "pastam", raw_name: "Pastam", status: "new" },
      { id: "cand-2", normalized_name: "pasta", raw_name: "Pasta", status: "new" },
      { id: "cand-3", normalized_name: "asdf", raw_name: "asdf", status: "new" }
    ],
    dish_families: [],
    review_dish_mentions: [
      candidateMention("m-1", "cand-1", "Pastam", "r-1", "u-1"),
      candidateMention("m-2", "cand-2", "Pasta", "r-2", "u-2"),
      candidateMention("m-3", "cand-2", "Pasta", "r-3", "u-3"),
      candidateMention("m-4", "cand-2", "Pasta", "r-4", "u-4"),
      candidateMention("m-5", "cand-3", "asdf", "r-5", "u-5")
    ]
  };
}

test("merge similarity: spelling variants merge, different dishes never do", () => {
  assert.ok(dishNameMergeSimilarity("pasta", "pastam") >= 0.5);
  assert.ok(dishNameMergeSimilarity("chicken manchuria", "chicken manchurian") >= 0.5);
  assert.equal(dishNameMergeSimilarity("paneer tikka masala", "paneer tikka"), 0, "extra word means a different dish");
  assert.equal(dishNameMergeSimilarity("veg manchurian", "chicken manchurian"), 0, "different word means a different dish");
  assert.ok(dishNameMergeSimilarity("sumchi", "sushi") < 0.5);
});

test("dry run reports decisions without touching anything", async () => {
  const db = createFakeDb(pastamSeed());
  const summary = await convertOpenDishCandidates(db, { dryRun: true });
  assert.equal(summary.dryRun, true);
  assert.equal(db.mutations, 0);
  assert.equal(summary.scanned, 3);
  const byId = new Map(summary.decisions.map((decision) => [decision.candidateId, decision]));
  assert.equal(byId.get("cand-1").action, "create");
  assert.equal(byId.get("cand-3").action, "create");
});

test("the pastam story end to end: create, merge, then majority rename", async () => {
  const db = createFakeDb(pastamSeed());
  const summary = await convertOpenDishCandidates(db, { dryRun: false });

  assert.equal(summary.errors.length, 0);
  // cand-1 (Pastam) creates the dish; cand-2 (Pasta) merges into it by
  // similarity; cand-3 (asdf) creates its own dish — everything canonicalizes.
  assert.equal(summary.created, 2);
  assert.equal(summary.merged, 1);

  const pastam = db.state.canonical_dishes.find((row) => ["pasta", "pastam"].includes(row.normalized_name));
  assert.ok(pastam, "expected the pasta dish to exist");
  // Majority rename: 3 Pasta mentions vs 1 Pastam mention flips the name.
  assert.equal(summary.renamed >= 1, true);
  assert.equal(pastam.display_name, "Pasta");
  assert.equal(pastam.normalized_name, "pasta");
  const alias = db.state.dish_aliases.find((row) => row.normalized_alias === "pastam");
  assert.ok(alias, "old spelling preserved as alias");

  const mentions = new Map(db.state.review_dish_mentions.map((row) => [row.id, row]));
  for (const id of ["m-1", "m-2", "m-3", "m-4"]) {
    assert.equal(mentions.get(id).canonical_dish_id, pastam.id, `${id} should point at the pasta dish`);
    assert.equal(mentions.get(id).candidate_id, null);
    assert.equal(JSON.stringify(mentions.get(id).family_tokens), JSON.stringify(["pasta"]));
  }

  const candidates = new Map(db.state.dish_candidates.map((row) => [row.id, row]));
  assert.equal(candidates.get("cand-1").status, "promoted");
  assert.equal(candidates.get("cand-2").status, "merged");
  assert.equal(candidates.get("cand-3").status, "promoted");

  const junk = db.state.canonical_dishes.find((row) => row.normalized_name === "asdf");
  assert.ok(junk, "everything canonicalizes — even junk, by design");
  assert.equal(JSON.stringify(junk.family_tokens), JSON.stringify(["asdf"]));
});

test("conversion is idempotent: nothing left open on the second run", async () => {
  const db = createFakeDb(pastamSeed());
  await convertOpenDishCandidates(db, { dryRun: false });
  const second = await convertOpenDishCandidates(db, { dryRun: false });
  assert.equal(second.scanned, 0);
  assert.equal(second.created, 0);
  assert.equal(second.merged, 0);
});

test("rename sweep covers all live dishes", async () => {
  const db = createFakeDb({
    canonical_dishes: [
      { display_name: "Byriani", id: "dish-1", merged_into_dish_id: null, normalized_name: "byriani", status: "generated" }
    ],
    review_dish_mentions: [
      { canonical_dish_id: "dish-1", deleted_at: null, id: "m-1", raw_name: "Biryani", review_id: "r-1" },
      { canonical_dish_id: "dish-1", deleted_at: null, id: "m-2", raw_name: "Biryani", review_id: "r-2" },
      { canonical_dish_id: "dish-1", deleted_at: null, id: "m-3", raw_name: "Biryani", review_id: "r-3" }
    ]
  });
  const summary = await runMajorityRenameSweep(db);
  assert.equal(summary.scanned, 1);
  assert.equal(summary.renamed, 1);
  assert.equal(db.state.canonical_dishes[0].display_name, "Biryani");
});
