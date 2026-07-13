import { randomUUID } from "node:crypto";

const baseUrl = (process.env.MEDIA_WORKER_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const secret = process.env.MEDIA_WORKER_SECRET?.trim() ?? "";
const once = process.env.MEDIA_WORKER_ONCE === "1" || process.argv.includes("--once");
const intervalMs = integerEnv("MEDIA_WORKER_INTERVAL_MS", 5000, 1000, 300_000);
const limit = integerEnv("MEDIA_WORKER_BATCH_LIMIT", 5, 1, 25);
const requestTimeoutMs = integerEnv("MEDIA_WORKER_REQUEST_TIMEOUT_MS", 360_000, 10_000, 900_000);
const cleanupEvery = integerEnv("MEDIA_WORKER_CLEANUP_EVERY", 12, 1, 10_000);
const workerId = process.env.MEDIA_WORKER_ID?.trim() || `media-worker-${process.pid}-${randomUUID().slice(0, 8)}`;

if (!secret || (process.env.NODE_ENV === "production" && secret.length < 32)) {
  console.error(JSON.stringify({ component: "media-worker", event: "startup_failed", failureCode: "media_worker_secret_invalid" }));
  process.exit(1);
}
if (!/^[A-Za-z0-9._:-]{1,120}$/.test(workerId)) {
  console.error(JSON.stringify({ component: "media-worker", event: "startup_failed", failureCode: "media_worker_id_invalid" }));
  process.exit(1);
}

let stopping = false;
let iteration = 0;
const shutdownController = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    shutdownController.abort();
    console.log(JSON.stringify({ component: "media-worker", event: "shutdown_requested", signal, workerId }));
  });
}

function integerEnv(name, fallback, minimum, maximum) {
  const parsed = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    console.error(JSON.stringify({ component: "media-worker", event: "startup_failed", failureCode: `${name.toLowerCase()}_invalid` }));
    process.exit(1);
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    shutdownController.signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

async function internalRequest(path, body, method = "POST") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const onShutdown = () => controller.abort();
  shutdownController.signal.addEventListener("abort", onShutdown, { once: true });
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      },
      method,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error("media_worker_request_failed");
    return payload;
  } finally {
    clearTimeout(timeout);
    shutdownController.signal.removeEventListener("abort", onShutdown);
  }
}

async function verifyReadiness() {
  const result = await internalRequest("/api/internal/media/health", undefined, "GET");
  if (!result.ready) throw new Error("media_worker_not_ready");
}

async function runLoop() {
  await verifyReadiness();
  console.log(JSON.stringify({ component: "media-worker", event: "started", baseUrl, batchLimit: limit, once, workerId }));

  while (!stopping) {
    iteration += 1;
    try {
      const result = await internalRequest("/api/internal/media/process", { limit, workerId });
      console.log(JSON.stringify({
        component: "media-worker",
        event: "batch_completed",
        deadLettered: result.deadLettered ?? 0,
        failed: result.failed ?? 0,
        leaseLost: result.leaseLost ?? 0,
        processed: result.processed ?? 0,
        rejected: result.rejected ?? 0,
        retried: result.retried ?? 0,
        succeeded: result.succeeded ?? 0,
        workerId
      }));
      if (iteration % cleanupEvery === 0) {
        const cleanup = await internalRequest("/api/internal/media/cleanup", { limit: Math.min(100, limit * 5), workerId });
        console.log(JSON.stringify({
          claimed: cleanup.claimed ?? 0,
          cleaned: cleanup.cleaned ?? 0,
          component: "media-worker",
          event: "cleanup_completed",
          failed: cleanup.failed ?? 0,
          workerId
        }));
      }
    } catch {
      if (!stopping) {
        console.error(JSON.stringify({ component: "media-worker", event: "batch_failed", failureCode: "media_worker_request_failed", workerId }));
        if (once) process.exitCode = 1;
      }
    }
    if (once) break;
    await sleep(intervalMs);
  }
}

try {
  await runLoop();
} catch {
  console.error(JSON.stringify({ component: "media-worker", event: "startup_failed", failureCode: "media_worker_not_ready", workerId }));
  process.exitCode = 1;
}
console.log(JSON.stringify({ component: "media-worker", event: "stopped", workerId }));
