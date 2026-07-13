#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice(10);
const limitValue = process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8);
const limit = limitValue === undefined ? 500 : Number(limitValue);
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new Error("limit must be between 1 and 5000");
if (apply && confirmation !== "PHASE5_PROJECTION_REPAIR") {
  throw new Error("apply requires --confirm=PHASE5_PROJECTION_REPAIR");
}

function localStatus() {
  const result = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], {
    cwd: process.cwd(), encoding: "utf8"
  });
  if (result.status !== 0) throw new Error("local Supabase is unavailable and explicit environment was not supplied");
  const status = JSON.parse(result.stdout);
  return { serviceKey: status.SERVICE_ROLE_KEY, url: status.API_URL };
}

const local = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? null : localStatus();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? local?.url;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? local?.serviceKey;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const { data, error } = await admin.rpc("reconcile_phase5_projections", { p_apply: apply, p_limit: limit });
if (error) throw new Error("Phase 5 reconciliation contract failed");
console.log(JSON.stringify({ ...data, dryRun: !apply }, null, 2));
