#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const confirmed = process.argv.includes("--confirm=PHASE7_PUSH_RECONCILE");
if (apply && !confirmed) {
  console.error("push-reconcile: --apply requires --confirm=PHASE7_PUSH_RECONCILE");
  process.exit(1);
}
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("push-reconcile: SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const { data, error } = await admin.rpc("reconcile_push_delivery_jobs", { p_apply: apply, p_limit: 500 });
if (error) {
  console.error("push-reconcile: reconciliation RPC failed");
  process.exit(1);
}
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...data }, null, 2));
