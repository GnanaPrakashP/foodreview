#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTsModule(relativePath) {
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
  vm.runInNewContext(outputText, {
    console,
    Date,
    exports: mod.exports,
    module: mod,
    process,
    require(id) {
      throw new Error(`Unexpected require while loading ${relativePath}: ${id}`);
    },
    setTimeout,
    clearTimeout
  }, { filename: absolutePath });
  return mod.exports;
}

function readNumberArg(argv, index, name) {
  const value = argv[index + 1];
  if (value == null) throw new Error(`${name} requires a value`);
  return Number(value);
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
    if (arg === "--include-raw") {
      options.includeRaw = true;
      continue;
    }
    if (arg === "--lat") {
      options.lat = readNumberArg(argv, index, "--lat");
      index += 1;
      continue;
    }
    if (arg.startsWith("--lat=")) {
      options.lat = Number(arg.slice("--lat=".length));
      continue;
    }
    if (arg === "--lng") {
      options.lng = readNumberArg(argv, index, "--lng");
      index += 1;
      continue;
    }
    if (arg.startsWith("--lng=")) {
      options.lng = Number(arg.slice("--lng=".length));
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
    if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage: npm run explore:compare-canonical -- [options]",
        "",
        "Options:",
        "  --lat <number>       Latitude for the same Explore input sent to both RPCs",
        "  --lng <number>       Longitude for the same Explore input sent to both RPCs",
        "  --limit <n>          Explore row limit, default 30, max 60",
        "  --json               Print machine-readable JSON",
        "  --include-raw        Include parsed old/canonical RPC payloads in JSON output"
      ].join("\n"));
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { json, options };
}

const { json, options } = readArgs(process.argv.slice(2));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const {
  buildExploreCanonicalComparisonReport,
  formatExploreCanonicalComparisonReport
} = loadTsModule("lib/server/explore-canonical-comparison.ts");
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const report = await buildExploreCanonicalComparisonReport(db, options);
console.log(json ? JSON.stringify(report, null, 2) : formatExploreCanonicalComparisonReport(report));
