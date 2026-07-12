import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

function loadDishIdentityModule() {
  const { outputText } = ts.transpileModule(source("lib/server/dish-identity.ts"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    console,
    module: mod,
    exports: mod.exports,
    require(id) {
      if (id === "@/lib/server/dish-trigram") {
        const trigramSource = source("lib/server/dish-trigram.ts");
        const { outputText: trigramOutput } = ts.transpileModule(trigramSource, {
          compilerOptions: {
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022
          }
        });
        const trigramMod = { exports: {} };
        vm.runInNewContext(trigramOutput, { module: trigramMod, exports: trigramMod.exports });
        return trigramMod.exports;
      }
      throw new Error(`Unexpected require in dish identity seed catalog tests: ${id}`);
    }
  });
  return mod.exports;
}

function createMemoryDb(seed = {}) {
  const state = {
    canonical_dishes: [...(seed.canonical_dishes ?? [])],
    dish_aliases: [...(seed.dish_aliases ?? [])],
    dish_candidates: [...(seed.dish_candidates ?? [])],
    dish_families: [...(seed.dish_families ?? [])]
  };
  let candidateSeq = state.dish_candidates.length + 1;
  let dishSeq = state.canonical_dishes.length + 1;

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
          if (table === "dish_candidates") row.id ??= `candidate-${candidateSeq++}`;
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

const mobileMigrationPath = "mobile/supabase/migrations/202607110002_dish_identity_seed_catalog.sql";
const rootMigrationPath = "supabase/migrations/202607110002_dish_identity_seed_catalog.sql";
const migration = source(rootMigrationPath);
const mobileMigration = source(mobileMigrationPath);
const aliasBlock = migration.match(/with seed_aliases[\s\S]+?normalized_seed_aliases as/i)?.[0] ?? "";
const { normalizeDishIdentityName, resolveDishIdentity } = loadDishIdentityModule();

const CHICKEN_BIRYANI_ID = "20000000-0000-4000-8000-000000000001";
const CHICKEN_MANCHURIAN_ID = "20000000-0000-4000-8000-000000000006";
const REVIEW_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function seededResolverDb() {
  return createMemoryDb({
    canonical_dishes: [{
      family_id: "10000000-0000-4000-8000-000000000001",
      id: CHICKEN_BIRYANI_ID,
      merged_into_dish_id: null,
      normalized_name: "chicken biryani",
      status: "verified"
    }, {
      family_id: "10000000-0000-4000-8000-000000000002",
      id: CHICKEN_MANCHURIAN_ID,
      merged_into_dish_id: null,
      normalized_name: "chicken manchurian",
      status: "verified"
    }],
    dish_aliases: [{
      alias_type: "seed",
      canonical_dish_id: CHICKEN_BIRYANI_ID,
      normalized_alias: "chiken biryani",
      status: "active"
    }, {
      alias_type: "seed",
      canonical_dish_id: CHICKEN_MANCHURIAN_ID,
      normalized_alias: "chicken manchuria",
      status: "active"
    }]
  });
}

test("dish identity seed catalog migration is mirrored across Supabase project trees", () => {
  assert.equal(mobileMigration, migration);
});

test("seed catalog uses stable UUIDs and idempotent inserts without destructive writes", () => {
  assert.match(migration, /insert into public\.dish_families/i);
  assert.match(migration, /insert into public\.canonical_dishes/i);
  assert.match(migration, /insert into public\.dish_aliases/i);
  assert.match(migration, /where not exists/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
  assert.doesNotMatch(migration, /\bdo update\b/i);

  const ids = Array.from(migration.matchAll(/\(\s*'([123]0000000-0000-4000-8000-[0-9a-f]{12})'::uuid,/g), (match) => match[1]);
  assert.ok(ids.length >= 80, "expected stable UUIDs for seeded families, dishes, and aliases");
  assert.equal(new Set(ids).size, ids.length, "seed UUIDs should be unique");
});

test("seeded canonical dishes are verified and seeded aliases are active", () => {
  assert.match(migration, /insert into public\.canonical_dishes \(id, family_id, display_name, normalized_name, slug, status\)[\s\S]+?'verified'/i);
  assert.match(migration, /insert into public\.dish_aliases \([\s\S]+?alias_type[\s\S]+?status[\s\S]+?\)[\s\S]+?'seed'[\s\S]+?1\.0[\s\S]+?0[\s\S]+?'active'/i);
  assert.match(migration, /and dish\.status = 'verified'/i);
  assert.match(migration, /and dish\.merged_into_dish_id is null/i);
});

test("seed catalog includes the intended compact family and canonical starter set", () => {
  for (const family of ["Biryani", "Manchurian", "Paneer", "Rice", "Noodles", "Dosa", "Shawarma", "Dessert", "Beverage"]) {
    assert.match(migration, new RegExp(`'${family}'`, "i"));
  }
  for (const dish of ["Chicken Biryani", "Mutton Biryani", "Chicken Manchurian", "Paneer Butter Masala", "Chicken 65", "Chicken Fried Rice", "Masala Dosa", "Cold Coffee"]) {
    assert.match(migration, new RegExp(`'${dish}'`, "i"));
  }
});

test("seed aliases are specific and avoid vague ambiguous short forms", () => {
  for (const alias of ["chiken biryani", "chicken manchuria", "panneer butter masala", "chicken sixty five", "fried rice chicken", "cold coffe"]) {
    assert.match(aliasBlock, new RegExp(`'${alias}'`, "i"));
  }
  for (const vagueAlias of ["manchuria", "biryani", "chicken", "curry", "rice", "paneer"]) {
    assert.doesNotMatch(aliasBlock, new RegExp(`,\\s*'${vagueAlias}'\\s*\\)`, "i"));
  }
});

test("Chiken Biryani resolves by seeded alias to Chicken Biryani", async () => {
  const result = await resolveDishIdentity(seededResolverDb(), {
    normalizedName: normalizeDishIdentityName("Chiken Biryani"),
    rawName: "Chiken Biryani",
    reviewId: REVIEW_ID,
    userId: USER_ID
  });

  assert.equal(result.error, null);
  assert.equal(result.data.canonicalDishId, CHICKEN_BIRYANI_ID);
  assert.equal(result.data.matchStatus, "alias");
});

test("Chicken Manchuria resolves by seeded alias to Chicken Manchurian", async () => {
  const result = await resolveDishIdentity(seededResolverDb(), {
    normalizedName: normalizeDishIdentityName("Chicken Manchuria"),
    rawName: "Chicken Manchuria",
    reviewId: REVIEW_ID,
    userId: USER_ID
  });

  assert.equal(result.error, null);
  assert.equal(result.data.canonicalDishId, CHICKEN_MANCHURIAN_ID);
  assert.equal(result.data.matchStatus, "alias");
});

test("Sumchi becomes a generated canonical and does not match Sushi", async () => {
  const db = seededResolverDb();
  const result = await resolveDishIdentity(db, {
    normalizedName: normalizeDishIdentityName("Sumchi"),
    placeId: "place-1",
    rawName: "Sumchi",
    reviewId: REVIEW_ID,
    userId: USER_ID
  });

  assert.equal(result.error, null);
  assert.notEqual(result.data.canonicalDishId, CHICKEN_BIRYANI_ID);
  assert.notEqual(result.data.canonicalDishId, CHICKEN_MANCHURIAN_ID);
  assert.equal(result.data.matchStatus, "exact");
  assert.equal(result.data.createdCanonical, true);
  assert.equal(db.state.dish_candidates.length, 0);
  assert.equal(db.state.canonical_dishes.some((row) => row.normalized_name === "sumchi"), true);
});
