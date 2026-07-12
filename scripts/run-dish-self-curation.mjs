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
  if (moduleCache.has(relativePath)) return moduleCache.get(relativePath);
  const absolutePath = path.join(rootDir, relativePath);
  const source = readFileSync(absolutePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });
  const mod = { exports: {} };
  moduleCache.set(relativePath, mod.exports);
  vm.runInNewContext(outputText, {
    console,
    Date,
    Number,
    exports: mod.exports,
    module: mod,
    process,
    require(id) {
      if (id === "@/lib/server/dish-identity") return loadTsModule("lib/server/dish-identity.ts");
      if (id === "@/lib/server/dish-self-curation") return loadTsModule("lib/server/dish-self-curation.ts");
      if (id === "@/lib/server/dish-trigram") return loadTsModule("lib/server/dish-trigram.ts");
      if (id === "@/lib/types") return {};
      throw new Error(`Unexpected require while loading ${relativePath}: ${id}`);
    },
    setTimeout,
    clearTimeout
  }, { filename: absolutePath });
  moduleCache.set(relativePath, mod.exports);
  return mod.exports;
}

function readNumberArg(argv, index, name) {
  const value = argv[index + 1];
  if (value == null) throw new Error(`${name} requires a value`);
  return Number(value);
}

function readArgs(argv) {
  const options = {
    apply: false,
    json: false,
    limit: 500,
    rebuildStats: false,
    renameSweep: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.apply = false;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--limit") {
      options.limit = readNumberArg(argv, index, "--limit");
      index += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      options.limit = Number(arg.slice("--limit=".length));
      continue;
    }
    if (arg === "--rename-sweep") {
      options.renameSweep = true;
      continue;
    }
    if (arg === "--rebuild-stats") {
      options.rebuildStats = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage: npm run dish:self-curate -- [options]",
        "",
        "Options:",
        "  --dry-run          Report candidate conversion decisions without writing; default",
        "  --apply            Convert open candidates, and allow optional rename/stats jobs",
        "  --limit <n>        Max open candidates to inspect, default 500, max 2000",
        "  --rename-sweep     After apply, sweep all live canonical dishes for majority display-name rewrites",
        "  --rebuild-stats    After apply, rebuild dish identity stats projections",
        "  --json             Print machine-readable JSON"
      ].join("\n"));
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

const options = readArgs(process.argv.slice(2));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const { convertOpenDishCandidates, runMajorityRenameSweep } = loadTsModule("lib/server/dish-self-curation.ts");
const summary = {
  apply: options.apply,
  curation: await convertOpenDishCandidates(db, {
    dryRun: !options.apply,
    limit: options.limit
  }),
  rebuildStats: null,
  renameSweep: null,
  warnings: []
};

if (options.renameSweep) {
  if (options.apply) {
    summary.renameSweep = await runMajorityRenameSweep(db);
  } else {
    summary.warnings.push("--rename-sweep requires --apply and was skipped.");
  }
}

if (options.rebuildStats) {
  if (options.apply) {
    const { data, error } = await db.rpc("rebuild_dish_identity_stats");
    if (error) throw new Error(error.message ?? "Could not rebuild dish identity stats");
    summary.rebuildStats = data;
  } else {
    summary.warnings.push("--rebuild-stats requires --apply and was skipped.");
  }
}

if (options.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log("Dish Self-Curation");
  console.log(`Mode: ${options.apply ? "apply" : "dry-run"}`);
  console.log("");
  console.log("1. Candidate Conversion");
  console.log(`  scanned: ${summary.curation.scanned}`);
  console.log(`  created: ${summary.curation.created}`);
  console.log(`  merged: ${summary.curation.merged}`);
  console.log(`  renamed: ${summary.curation.renamed}`);
  console.log(`  errors: ${summary.curation.errors.length}`);
  if (summary.renameSweep) {
    console.log("");
    console.log("2. Rename Sweep");
    console.log(`  scanned: ${summary.renameSweep.scanned}`);
    console.log(`  renamed: ${summary.renameSweep.renamed}`);
    console.log(`  skipped: ${summary.renameSweep.skipped}`);
  }
  if (summary.rebuildStats) {
    console.log("");
    console.log("3. Stats Rebuild");
    console.log(`  ${JSON.stringify(summary.rebuildStats)}`);
  }
  if (summary.warnings.length > 0) {
    console.log("");
    console.log("Warnings");
    for (const warning of summary.warnings) console.log(`  ${warning}`);
  }
}
