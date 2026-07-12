#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

function loadTsModule(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath);

  const source = readFileSync(absolutePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });
  const mod = { exports: {} };
  moduleCache.set(absolutePath, mod.exports);

  function localRequire(id) {
    if (id === "@/lib/server/dish-place-id-repair") {
      return loadTsModule("lib/server/dish-place-id-repair.ts");
    }
    if (id === "@/lib/server/dish-place-id-repair-report") {
      return loadTsModule("lib/server/dish-place-id-repair-report.ts");
    }
    throw new Error(`Unexpected require while loading ${relativePath}: ${id}`);
  }

  vm.runInNewContext(outputText, {
    clearTimeout,
    console,
    Date,
    exports: mod.exports,
    module: mod,
    process,
    require: localRequire,
    setTimeout
  }, { filename: absolutePath });

  moduleCache.set(absolutePath, mod.exports);
  return mod.exports;
}

function readArgs(argv) {
  const options = {};
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--limit") {
      options.limit = Number(argv[++index]);
      continue;
    }
    if (arg.startsWith("--limit=")) {
      options.limit = Number(arg.slice("--limit=".length));
      continue;
    }
    if (arg === "--restaurant-name") {
      options.restaurantName = argv[++index];
      continue;
    }
    if (arg.startsWith("--restaurant-name=")) {
      options.restaurantName = arg.slice("--restaurant-name=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage: npm run dish:repair-place-ids -- [options]",
        "",
        "Options:",
        "  --dry-run                Preview only; this is the default",
        "  --apply                  Update eligible review_dish_mentions.place_id rows",
        "  --limit <n>              Number of safe report groups to consider, default 100",
        "  --restaurant-name <name> Scope to one exact restaurant name",
        "  --json                   Print machine-readable JSON"
      ].join("\n"));
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && options.dryRun) throw new Error("Choose either --apply or --dry-run, not both");
  return { json, options };
}

const { json, options } = readArgs(process.argv.slice(2));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const {
  formatPlaceIdRepairSummary,
  repairReviewDishMentionPlaceIds
} = loadTsModule("lib/server/dish-place-id-repair.ts");
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const summary = await repairReviewDishMentionPlaceIds(db, options);
console.log(json ? JSON.stringify(summary, null, 2) : formatPlaceIdRepairSummary(summary));
if (summary.errors.length > 0) process.exitCode = 1;
