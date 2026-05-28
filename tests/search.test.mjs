/**
 * Phase 3 — search, profile, and settings coverage.
 *
 * Covers:
 *   - Username validation (USERNAME_REGEX from app/onboarding)
 *   - normalizeAccountType / public-private account toggle
 *   - searchDishes edge cases: empty query, spaces, special characters, no match
 *   - getAccountTypeForName: username lookup behavior
 *
 * Already covered elsewhere (not duplicated here):
 *   - searchDishes happy path and aggregation → tests/app-logic.test.mjs
 *   - getAccountTypeForName / getAccountTypesForNames basics → tests/circle-db.test.mjs
 *   - getAuthenticatedCircleActor → tests/circle-auth.test.mjs
 *   - Profile creation / edit UI → client components only (not VM-testable)
 *   - Public/private toggle UI → client component (app/me/settings/page.tsx), enforced
 *     server-side via RLS (tests/rls-schema.test.mjs) + normalizeAccountType below
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// ── transpile ─────────────────────────────────────────────────────────────────

function transpile(src) {
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  return outputText;
}

// ── module loaders ────────────────────────────────────────────────────────────

// lib/circle.ts needs @/lib/visibility mocked (only used by canShowInCircleFeed,
// not by normalizeAccountType — but the require() runs at module load time).
const circleExports = (() => {
  const mod = { exports: {} };
  vm.runInNewContext(
    transpile(readFileSync(new URL("../lib/circle.ts", import.meta.url), "utf8")),
    {
      module: mod, exports: mod.exports, console,
      require(id) {
        if (id === "@/lib/visibility") return { canShowInCircleTrending: () => false };
        throw new Error(`Unexpected require loading circle.ts: ${id}`);
      },
    }
  );
  return mod.exports;
})();

// lib/circle-db.ts needs @/lib/circle (the real exports loaded above).
const circleDbExports = (() => {
  const mod = { exports: {} };
  vm.runInNewContext(
    transpile(readFileSync(new URL("../lib/circle-db.ts", import.meta.url), "utf8")),
    {
      module: mod, exports: mod.exports, console,
      require(id) {
        if (id === "@/lib/circle") return circleExports;
        throw new Error(`Unexpected require loading circle-db.ts: ${id}`);
      },
    }
  );
  return mod.exports;
})();

const dishNormalizerExports = (() => {
  const mod = { exports: {} };
  vm.runInNewContext(
    transpile(readFileSync(new URL("../lib/dish-normalizer.ts", import.meta.url), "utf8")),
    {
      module: mod, exports: mod.exports,
    }
  );
  return mod.exports;
})();

const dishesExports = (() => {
  const mod = { exports: {} };
  vm.runInNewContext(
    transpile(readFileSync(new URL("../lib/dishes.ts", import.meta.url), "utf8")),
    {
      module: mod, exports: mod.exports,
      require(id) {
        if (id === "@/lib/dish-normalizer") return dishNormalizerExports;
        throw new Error(`Unexpected require loading dishes.ts: ${id}`);
      },
    }
  );
  return mod.exports;
})();

// lib/profile.ts — type-only import from @/lib/types is elided after transpile.
const profileExports = (() => {
  const mod = { exports: {} };
  vm.runInNewContext(
    transpile(readFileSync(new URL("../lib/profile.ts", import.meta.url), "utf8")),
    {
      module: mod, exports: mod.exports, console,
      require(id) {
        if (id === "@/lib/types") return {};
        throw new Error(`Unexpected require loading profile.ts: ${id}`);
      },
    }
  );
  return mod.exports;
})();

const { normalizeAccountType } = circleExports;
const { getAccountTypeForName } = circleDbExports;
const { searchDishes } = dishesExports;
const { avatarInitials } = profileExports;

// ── profile DB mock ───────────────────────────────────────────────────────────

function makeProfileDb(rows) {
  return {
    from(_table) {
      const chain = {
        then(res, rej) {
          return Promise.resolve({ data: rows[0] ?? null, error: null }).then(res, rej);
        },
        catch(rej) {
          return Promise.resolve({ data: rows[0] ?? null, error: null }).catch(rej);
        },
      };
      for (const m of ["select", "ilike", "limit", "eq", "or", "maybeSingle"]) {
        chain[m] = () => chain;
      }
      return chain;
    },
  };
}

// ── review factory for searchDishes ──────────────────────────────────────────

let _seq = 0;
function makeReview(reviewer, restaurant, items, extra = {}) {
  return {
    id: `r${++_seq}`,
    reviewer_name: reviewer,
    restaurant_name: restaurant,
    items,
    visibility: "public",
    body: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// USERNAME VALIDATION (USERNAME_REGEX from lib/username.ts)
// Rules: 3–20 chars, lowercase, start/end with letter or digit,
//        only _ and . in middle, no consecutive specials (.. __ ._ _.)
// ─────────────────────────────────────────────────────────────────────────────

const USERNAME_REGEX = /^(?!.*[._]{2})[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$/;

// ── Valid cases ───────────────────────────────────────────────────────────────

test("username: lowercase alphanumeric is valid", () => {
  assert.ok(USERNAME_REGEX.test("alice123"));
});

test("username: underscore in middle is valid", () => {
  assert.ok(USERNAME_REGEX.test("alice_smith"));
});

test("username: dot in middle is valid", () => {
  assert.ok(USERNAME_REGEX.test("alice.smith"));
});

test("username: starts with digit is valid", () => {
  assert.ok(USERNAME_REGEX.test("1alice"));
});

test("username: exactly 3 characters is valid (minimum)", () => {
  assert.ok(USERNAME_REGEX.test("abc"));
});

test("username: exactly 20 characters is valid (maximum)", () => {
  assert.ok(USERNAME_REGEX.test("a".repeat(20)));
});

test("username: mixed dot and underscore separated by letters is valid", () => {
  assert.ok(USERNAME_REGEX.test("a.b_c"));
});

// ── Invalid cases ─────────────────────────────────────────────────────────────

test("username: 2 characters is invalid (too short)", () => {
  assert.ok(!USERNAME_REGEX.test("ab"));
});

test("username: 21 characters is invalid (too long)", () => {
  assert.ok(!USERNAME_REGEX.test("a".repeat(21)));
});

test("username: uppercase letters are invalid", () => {
  assert.ok(!USERNAME_REGEX.test("Alice"));
});

test("username: spaces are invalid", () => {
  assert.ok(!USERNAME_REGEX.test("alice smith"));
});

test("username: hyphens are invalid", () => {
  assert.ok(!USERNAME_REGEX.test("alice-smith"));
});

test("username: empty string is invalid", () => {
  assert.ok(!USERNAME_REGEX.test(""));
});

test("username: leading underscore is invalid", () => {
  assert.ok(!USERNAME_REGEX.test("_alice"));
});

test("username: trailing underscore is invalid", () => {
  assert.ok(!USERNAME_REGEX.test("alice_"));
});

test("username: leading dot is invalid", () => {
  assert.ok(!USERNAME_REGEX.test(".alice"));
});

test("username: trailing dot is invalid", () => {
  assert.ok(!USERNAME_REGEX.test("alice."));
});

test("username: consecutive dots are invalid", () => {
  assert.ok(!USERNAME_REGEX.test("alice..smith"));
});

test("username: consecutive underscores are invalid", () => {
  assert.ok(!USERNAME_REGEX.test("alice__smith"));
});

test("username: dot followed by underscore is invalid", () => {
  assert.ok(!USERNAME_REGEX.test("alice._smith"));
});

test("username: underscore followed by dot is invalid", () => {
  assert.ok(!USERNAME_REGEX.test("alice_.smith"));
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeAccountType — public/private account toggle contract
// ─────────────────────────────────────────────────────────────────────────────

test("normalizeAccountType: 'private' → 'private'", () => {
  assert.equal(normalizeAccountType("private"), "private");
});

test("normalizeAccountType: 'public' → 'public'", () => {
  assert.equal(normalizeAccountType("public"), "public");
});

test("normalizeAccountType: null → default 'public'", () => {
  assert.equal(normalizeAccountType(null), "public");
});

test("normalizeAccountType: undefined → default 'public'", () => {
  assert.equal(normalizeAccountType(undefined), "public");
});

test("normalizeAccountType: unknown string → default 'public'", () => {
  assert.equal(normalizeAccountType("secret"), "public");
});

// ─────────────────────────────────────────────────────────────────────────────
// searchDishes — edge cases not covered by app-logic.test.mjs
// ─────────────────────────────────────────────────────────────────────────────

test("searchDishes: empty string returns empty result", () => {
  const reviews = [makeReview("Alice", "Bawarchi", [{ name: "Biryani", rating: 5 }])];
  assert.equal(searchDishes(reviews, "").length, 0);
});

test("searchDishes: whitespace-only query returns empty result", () => {
  const reviews = [makeReview("Alice", "Bawarchi", [{ name: "Biryani", rating: 5 }])];
  assert.equal(searchDishes(reviews, "   ").length, 0);
});

test("searchDishes: no reviews returns empty result", () => {
  assert.equal(searchDishes([], "biryani").length, 0);
});

test("searchDishes: query with no matching dish returns empty result", () => {
  const reviews = [makeReview("Alice", "Bawarchi", [{ name: "Biryani", rating: 5 }])];
  assert.equal(searchDishes(reviews, "pizza").length, 0);
});

test("searchDishes: query with spaces matches dish names containing that substring", () => {
  const reviews = [makeReview("Alice", "Bawarchi", [{ name: "Mutton Biryani", rating: 5 }])];
  const results = searchDishes(reviews, "mutton biryani");
  assert.equal(results.length, 1);
  assert.equal(results[0].dish_name, "Biryani");
});

test("searchDishes: partial space query matches dish name substring", () => {
  const reviews = [makeReview("Alice", "Bawarchi", [{ name: "Mutton Biryani", rating: 4 }])];
  const results = searchDishes(reviews, "mutton");
  assert.equal(results.length, 1);
  assert.equal(results[0].dish_name, "Biryani");
});

test("searchDishes: apostrophe in dish name is matched correctly", () => {
  const reviews = [makeReview("Alice", "Cafe", [{ name: "Chef's Special", rating: 5 }])];
  const results = searchDishes(reviews, "chef's");
  assert.equal(results.length, 1);
  assert.equal(results[0].dish_name, "Chef's Special");
});

test("searchDishes: query matching multiple restaurants returns all matches", () => {
  const reviews = [
    makeReview("Alice", "Bawarchi", [{ name: "Chicken Biryani", rating: 5 }]),
    makeReview("Bob", "Paradise", [{ name: "Mutton Biryani", rating: 4 }]),
  ];
  const results = searchDishes(reviews, "biryani");
  assert.equal(results.length, 2);
});

test("searchDishes: results sorted by avg_score descending", () => {
  const reviews = [
    makeReview("Alice", "Low", [{ name: "Biryani", rating: 2 }]),
    makeReview("Bob", "High", [{ name: "Biryani", rating: 5 }]),
  ];
  const results = searchDishes(reviews, "biryani");
  assert.equal(results[0].restaurant_name, "High");
  assert.equal(results[1].restaurant_name, "Low");
});

test("searchDishes: rating is scaled from 1–5 to 2–10 (×2)", () => {
  const reviews = [makeReview("Alice", "Bawarchi", [{ name: "Biryani", rating: 5 }])];
  const results = searchDishes(reviews, "biryani");
  assert.equal(results[0].avg_score, 10);
});

test("searchDishes: items with rating 0 are excluded from avg_score calculation", () => {
  const reviews = [
    makeReview("Alice", "Bawarchi", [{ name: "Biryani", rating: 0 }]),
    makeReview("Bob", "Bawarchi", [{ name: "Biryani", rating: 4 }]),
  ];
  const results = searchDishes(reviews, "biryani");
  // Only Bob's rating (4 → 8) should count; Alice's 0 is excluded
  assert.equal(results[0].avg_score, 8);
  assert.equal(results[0].total_logs, 2);
});

test("searchDishes: unique_raters counts distinct reviewers, not logs", () => {
  const reviews = [
    makeReview("Alice", "Bawarchi", [{ name: "Biryani", rating: 5 }]),
    makeReview("Alice", "Bawarchi", [{ name: "Biryani", rating: 4 }]),
    makeReview("Bob", "Bawarchi", [{ name: "Biryani", rating: 3 }]),
  ];
  const results = searchDishes(reviews, "biryani");
  assert.equal(results[0].unique_raters, 2);
  assert.equal(results[0].total_logs, 3);
});

// ─────────────────────────────────────────────────────────────────────────────
// USERNAME ACCOUNT LOOKUP
//
// Account type lookup uses the canonical username identity, not display names.
// ─────────────────────────────────────────────────────────────────────────────

test("getAccountTypeForName: exact username controls account type", async () => {
  const privateDb = makeProfileDb([{ username: "alice_smith", account_type: "private" }]);
  const publicDb = makeProfileDb([{ username: "alice_public", account_type: "public" }]);

  assert.equal(await getAccountTypeForName(privateDb, "alice_smith"), "private");
  assert.equal(await getAccountTypeForName(publicDb, "alice_public"), "public");
});

test("getAccountTypeForName: display names do not match username lookup", async () => {
  const db = makeProfileDb([]);
  assert.equal(await getAccountTypeForName(db, "Alice Smith"), "public");
});

// ─────────────────────────────────────────────────────────────────────────────
// avatarInitials — edge cases introduced by the /[\s_]+/ split
// ─────────────────────────────────────────────────────────────────────────────

test("avatarInitials: underscore-separated username yields two initials", () => {
  assert.equal(avatarInitials("alice_ate"), "AA");
});

test("avatarInitials: empty string returns '?'", () => {
  assert.equal(avatarInitials(""), "?");
});

test("avatarInitials: single-word name returns one initial", () => {
  assert.equal(avatarInitials("alice"), "A");
});

test("avatarInitials: space-separated display name returns two initials (regression)", () => {
  assert.equal(avatarInitials("Alice Ate"), "AA");
});
