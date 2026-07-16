#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { loadCapacityConfig } from "./lib.mjs";

const config = await loadCapacityConfig();
const status = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], {
  cwd: process.cwd(),
  encoding: "utf8"
});
if (status.status !== 0) {
  console.error("load_seed_contract_supabase_unavailable");
  process.exit(1);
}
const local = JSON.parse(status.stdout);
const url = new URL(local.API_URL);
if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") {
  console.error("load_seed_contract_non_loopback_rejected");
  process.exit(1);
}
const env = {
  ...process.env,
  LOAD_ACTOR_EMAIL_DOMAIN: "load-contract.invalid",
  LOAD_LOCAL_CONFIRMATION: config.safety.localValidationConfirmation,
  LOAD_STAGING_API_URL: local.API_URL,
  LOAD_STAGING_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  LOAD_STAGING_SUPABASE_URL: local.API_URL
};

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: process.cwd(), env, encoding: "utf8" });
}

run("scripts/load/cleanup.mjs", ["--apply", "--local-contract"]);
const seeded = run("scripts/load/seed.mjs", ["--apply", "--local-contract", "--scale=0.001"]);
const cleaned = run("scripts/load/cleanup.mjs", ["--apply", "--local-contract"]);
if (seeded.status !== 0) {
  process.stderr.write(seeded.stderr || seeded.stdout || "load_seed_contract_failed\n");
  process.exit(1);
}
if (cleaned.status !== 0) {
  process.stderr.write(cleaned.stderr || cleaned.stdout || "load_seed_contract_cleanup_failed\n");
  process.exit(1);
}
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const [profiles, reviews, rooms, remainingUsers] = await Promise.all([
  admin.from("profiles").select("id", { count: "exact", head: true }).like("username", "load9_%"),
  admin.from("reviews").select("id", { count: "exact", head: true }).like("reviewer_name", "load9_%"),
  admin.from("shared_memory_rooms").select("id", { count: "exact", head: true }).like("created_by", "load9_%"),
  admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
]);
if (profiles.error || reviews.error || rooms.error || remainingUsers.error || profiles.count || reviews.count || rooms.count || remainingUsers.data.users.some((user) => user.email?.startsWith(config.seed.emailPrefix))) {
  console.error("load_seed_contract_cleanup_residue");
  process.exit(1);
}
console.log(JSON.stringify({ scale: 0.001, status: "passed", syntheticUsers: 10, cleanup: "passed" }, null, 2));
