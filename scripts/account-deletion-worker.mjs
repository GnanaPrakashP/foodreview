#!/usr/bin/env node

const baseUrl = (
  process.env.ACCOUNT_DELETION_WORKER_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
  "http://localhost:3000"
).replace(/\/$/, "");
const secret = process.env.ACCOUNT_DELETION_WORKER_SECRET ?? "";
const once = process.env.ACCOUNT_DELETION_WORKER_ONCE === "1" || process.argv.includes("--once");
const intervalMs = Math.max(5_000, Number(process.env.ACCOUNT_DELETION_WORKER_INTERVAL_MS ?? 30_000));
const limit = Math.max(1, Math.min(50, Number(process.env.ACCOUNT_DELETION_WORKER_BATCH_LIMIT ?? 10)));

if (!secret) {
  console.error("[account-deletion-worker] ACCOUNT_DELETION_WORKER_SECRET is required");
  process.exit(1);
}

async function processBatch() {
  const response = await fetch(`${baseUrl}/api/internal/account-deletion`, {
    body: JSON.stringify({ limit }),
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    method: "POST"
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(`Account deletion worker returned HTTP ${response.status}`);
  return body;
}

for (;;) {
  try {
    const result = await processBatch();
    console.log(`[account-deletion-worker] claimed=${result.claimed}`);
  } catch {
    console.error("[account-deletion-worker] bounded batch failed");
    if (once) process.exitCode = 1;
  }
  if (once) break;
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
