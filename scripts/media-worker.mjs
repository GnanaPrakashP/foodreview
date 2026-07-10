const baseUrl = (
  process.env.MEDIA_WORKER_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}` ||
  "http://localhost:3000"
).replace(/\/$/, "");

const secret =
  process.env.MEDIA_WORKER_SECRET ||
  process.env.ACCOUNT_MEDIA_CLEANUP_SECRET ||
  process.env.MEMORY_UPLOAD_CLEANUP_SECRET ||
  "";

const once = process.env.MEDIA_WORKER_ONCE === "1" || process.argv.includes("--once");
const intervalMs = Math.max(1000, Number(process.env.MEDIA_WORKER_INTERVAL_MS ?? 5000));
const limit = Math.max(1, Math.min(25, Number(process.env.MEDIA_WORKER_BATCH_LIMIT ?? 5)));

if (!secret) {
  console.error("[media-worker] MEDIA_WORKER_SECRET is required");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processBatch() {
  const response = await fetch(`${baseUrl}/api/internal/media/process`, {
    body: JSON.stringify({ limit }),
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? `Media processor failed (${response.status})`);
  }
  return payload;
}

console.log(`[media-worker] processing ${baseUrl} batch=${limit} once=${once ? "yes" : "no"}`);

for (;;) {
  try {
    const result = await processBatch();
    console.log(
      `[media-worker] processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed}`
    );
  } catch (error) {
    console.error("[media-worker] batch failed", error);
    if (once) process.exitCode = 1;
  }
  if (once) break;
  await sleep(intervalMs);
}
