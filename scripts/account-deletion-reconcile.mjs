#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

function options(argv) {
  const parsed = { after: null, apply: false, jobId: null, limit: 25, userId: null };
  for (const arg of argv) {
    if (arg === "--apply") parsed.apply = true;
    else if (arg.startsWith("--job=")) parsed.jobId = arg.slice(6).trim();
    else if (arg.startsWith("--user=")) parsed.userId = arg.slice(7).trim();
    else if (arg.startsWith("--after=")) parsed.after = arg.slice(8).trim();
    else if (arg.startsWith("--limit=")) parsed.limit = Math.max(1, Math.min(Number(arg.slice(8)) || 25, 100));
    else if (arg === "--help") {
      console.log("Usage: npm run account:deletion-report -- [--job=<uuid> | --user=<uuid>] [--after=<uuid>] [--limit=25] [--apply]");
      process.exit(0);
    }
  }
  return parsed;
}

function required(name, fallbackName) {
  const value = process.env[name] ?? (fallbackName ? process.env[fallbackName] : undefined);
  if (!value) throw new Error(`Missing ${name}${fallbackName ? ` or ${fallbackName}` : ""}`);
  return value;
}

async function count(query) {
  const { count: result, error } = await query;
  if (error) throw error;
  return result ?? 0;
}

async function processJob(jobId) {
  const url = required("ACCOUNT_DELETION_WORKER_URL");
  const secret = required("ACCOUNT_DELETION_WORKER_SECRET");
  const response = await fetch(url, {
    body: JSON.stringify({ jobId, limit: 1 }),
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    method: "POST"
  });
  if (!response.ok) throw new Error(`Worker returned HTTP ${response.status}`);
}

const input = options(process.argv.slice(2));
const url = required("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

let jobsQuery = admin.from("account_deletion_jobs")
  .select("id,user_id,status,attempts,last_error_code,inventory_completed_at,storage_completed_at,database_completed_at,auth_deleted_at,completed_at,created_at,retain_until")
  .order("id", { ascending: true })
  .limit(input.limit);
if (input.jobId) jobsQuery = jobsQuery.eq("id", input.jobId);
if (input.userId) jobsQuery = jobsQuery.eq("user_id", input.userId);
if (input.after) jobsQuery = jobsQuery.gt("id", input.after);

const { data: jobs, error: jobsError } = await jobsQuery;
if (jobsError) throw jobsError;

const reports = [];
for (const job of jobs ?? []) {
  if (input.apply) await processJob(job.id);
  const [remainingStorage, failedStorage, ambiguousStorage, remainingRows] = await Promise.all([
    count(admin.from("account_deletion_storage_items").select("id", { count: "exact", head: true }).eq("job_id", job.id).not("status", "in", "(deleted,already_missing)")),
    count(admin.from("account_deletion_storage_items").select("id", { count: "exact", head: true }).eq("job_id", job.id).eq("status", "failed")),
    count(admin.from("account_deletion_ambiguous_items").select("id", { count: "exact", head: true }).eq("job_id", job.id).is("resolved_at", null)),
    admin.rpc("account_deletion_remaining_counts", { p_job_id: job.id })
  ]);
  const auth = await admin.auth.admin.getUserById(job.user_id);
  const authPresent = Boolean(auth.data?.user);
  if (remainingRows.error) throw new Error("Database reconciliation failed");
  reports.push({
    ambiguousObjects: ambiguousStorage,
    authUserPresent: authPresent,
    failedObjects: failedStorage,
    jobId: job.id,
    jobState: job.status,
    remainingDatabaseRows: Number(remainingRows.data?.total ?? 0),
    remainingRowsByTable: remainingRows.data?.byTable ?? {},
    remainingStorageObjects: remainingStorage,
    retentionEndsAt: job.retain_until
  });
}

console.log(JSON.stringify({
  appliedOneBoundedWorkerStep: input.apply,
  count: reports.length,
  dryRun: !input.apply,
  nextCursor: jobs?.at(-1)?.id ?? null,
  reports
}, null, 2));
