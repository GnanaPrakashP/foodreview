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
    if (id === "@/lib/server/dish-candidate-review") return loadTsModule("lib/server/dish-candidate-review.ts");
    if (id === "@/lib/server/dish-candidate-reresolve") return loadTsModule("lib/server/dish-candidate-reresolve.ts");
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
  const options = { dryRun: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--apply") {
      options.dryRun = false;
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
    if (arg === "--page-size") {
      options.pageSize = Number(argv[++index]);
      continue;
    }
    if (arg.startsWith("--page-size=")) {
      options.pageSize = Number(arg.slice("--page-size=".length));
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage: npm run dish:reresolve-candidates -- [options]",
        "",
        "Options:",
        "  --dry-run          Report exact/alias candidate repairs without writing; default",
        "  --apply            Apply exact/alias repairs. Use only after reviewing dry-run output",
        "  --limit <n>        Candidate mentions to inspect, default 100",
        "  --page-size <n>    Read page size, default 1000"
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

const { reresolveCandidateDishMentions } = loadTsModule("lib/server/dish-candidate-reresolve.ts");
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const summary = await reresolveCandidateDishMentions(db, options);
console.log(JSON.stringify(summary, null, 2));
if (summary.errors.length > 0) process.exitCode = 1;
