#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { loadServerModule } from "./load-server-module.mjs";

function valueArg(argv, name, fallback = null) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

function readOptions(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log([
      "Usage: npm run dish:repair-orphans -- [options]",
      "",
      "Options:",
      "  --dry-run                 Inspect and resolve in memory without writes; default",
      "  --apply                   Persist repairs",
      "  --target=load|all         Limit to load9 users (default) or all orphan mentions",
      "  --batch-size=<n>          Rows per bounded batch; default 200, max 1000",
      "  --max-batches=<n>         Stop after this many batches; default 100",
      "  --after-id=<uuid>         Resume after the last reported cursor",
      "  --no-rebuild              Skip the Explore projection rebuild after apply",
      "  --environment=<name>      Required for hosted apply: staging or production",
      "  --confirm=REPAIR_EXPLORE_V3_ORPHANS",
      "  --confirm-production=REPAIR_EXPLORE_V3_PRODUCTION (production only)"
    ].join("\n"));
    process.exit(0);
  }
  const target = valueArg(argv, "--target", "load");
  if (!["load", "all"].includes(target)) throw new Error("--target must be load or all");
  return {
    afterId: valueArg(argv, "--after-id"),
    apply: argv.includes("--apply"),
    batchSize: Number(valueArg(argv, "--batch-size", 200)),
    environment: valueArg(argv, "--environment"),
    maxBatches: Number(valueArg(argv, "--max-batches", 100)),
    rebuild: !argv.includes("--no-rebuild"),
    target
  };
}

const options = readOptions(process.argv.slice(2));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const isLocal = /localhost|127\.0\.0\.1/.test(supabaseUrl);
if (options.apply) {
  if (!isLocal && !["staging", "production"].includes(options.environment)) {
    throw new Error("Hosted apply requires --environment=staging or --environment=production");
  }
  if (valueArg(process.argv, "--confirm") !== "REPAIR_EXPLORE_V3_ORPHANS") {
    throw new Error("Apply requires --confirm=REPAIR_EXPLORE_V3_ORPHANS");
  }
  if (
    options.environment === "production" &&
    valueArg(process.argv, "--confirm-production") !== "REPAIR_EXPLORE_V3_PRODUCTION"
  ) {
    throw new Error("Production apply requires --confirm-production=REPAIR_EXPLORE_V3_PRODUCTION");
  }
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const { repairOrphanDishMentions } = loadServerModule("lib/server/dish-orphan-repair.ts");
const repair = await repairOrphanDishMentions(db, {
  afterId: options.afterId,
  batchSize: options.batchSize,
  dryRun: !options.apply,
  maxBatches: options.maxBatches,
  target: options.target
});

let projectionRebuild = null;
if (options.apply && options.rebuild && repair.failed === 0) {
  const { data, error } = await db.rpc("rebuild_explore_v3_projections");
  if (error) throw new Error(error.message ?? "Explore projection rebuild failed");
  projectionRebuild = data;
}

console.log(JSON.stringify({
  environment: isLocal ? "local" : options.environment ?? "hosted-unclassified",
  projectionRebuild,
  repair
}, null, 2));
if (repair.failed > 0) process.exitCode = 1;
