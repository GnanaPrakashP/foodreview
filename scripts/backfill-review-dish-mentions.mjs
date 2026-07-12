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
    if (id === "@/lib/server/dish-identity") return loadTsModule("lib/server/dish-identity.ts");
    if (id === "@/lib/server/dish-identity-backfill") return loadTsModule("lib/server/dish-identity-backfill.ts");
    if (id === "@/lib/server/dish-trigram") return loadTsModule("lib/server/dish-trigram.ts");
    if (id === "@/lib/types") return {};
    throw new Error(`Unexpected require while loading ${relativePath}: ${id}`);
  }

  vm.runInNewContext(outputText, {
    console,
    Date,
    exports: mod.exports,
    module: mod,
    process,
    require: localRequire,
    setTimeout,
    clearTimeout
  }, { filename: absolutePath });

  moduleCache.set(absolutePath, mod.exports);
  return mod.exports;
}

function readArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--include-suppressed") {
      options.includeSuppressed = true;
      continue;
    }
    if (arg === "--batch-size") {
      options.batchSize = Number(argv[++index]);
      continue;
    }
    if (arg.startsWith("--batch-size=")) {
      options.batchSize = Number(arg.slice("--batch-size=".length));
      continue;
    }
    if (arg === "--max-batches") {
      options.maxBatches = Number(argv[++index]);
      continue;
    }
    if (arg.startsWith("--max-batches=")) {
      options.maxBatches = Number(arg.slice("--max-batches=".length));
      continue;
    }
    if (arg === "--start-offset") {
      options.startOffset = Number(argv[++index]);
      continue;
    }
    if (arg.startsWith("--start-offset=")) {
      options.startOffset = Number(arg.slice("--start-offset=".length));
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage: node scripts/backfill-review-dish-mentions.mjs [options]",
        "",
        "Options:",
        "  --batch-size <n>       Reviews per batch, default 100, max 1000",
        "  --max-batches <n>      Stop after this many batches",
        "  --start-offset <n>     Start from this review offset",
        "  --dry-run              Count rows without writing canonical dishes or mentions",
        "  --include-suppressed   Include deleted/hidden/reported/removed reviews"
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

const { backfillReviewDishMentions } = loadTsModule("lib/server/dish-identity-backfill.ts");
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const summary = await backfillReviewDishMentions(db, options);
console.log(JSON.stringify(summary, null, 2));
if (summary.errors.length > 0) process.exitCode = 1;
