import { randomUUID } from "node:crypto";
import { workerLogger, flushWorkerTelemetry } from "./worker-observability.mjs";

const log = workerLogger("foodreview-media-worker-loop");

const baseUrl = (process.env.MEDIA_WORKER_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const secret = process.env.MEDIA_WORKER_SECRET?.trim() ?? "";
const once = process.env.MEDIA_WORKER_ONCE === "1" || process.argv.includes("--once");
const intervalMs = integerEnv("MEDIA_WORKER_INTERVAL_MS", 5000, 1000, 300_000);
const limit = integerEnv("MEDIA_WORKER_BATCH_LIMIT", 5, 1, 25);
const requestTimeoutMs = integerEnv("MEDIA_WORKER_REQUEST_TIMEOUT_MS", 360_000, 10_000, 900_000);
const cleanupEvery = integerEnv("MEDIA_WORKER_CLEANUP_EVERY", 12, 1, 10_000);
const workerId = process.env.MEDIA_WORKER_ID?.trim() || `media-worker-${process.pid}-${randomUUID().slice(0, 8)}`;

if (!secret || (process.env.NODE_ENV === "production" && secret.length < 32)) {
  log.error("startup_failed", new Error("media_worker_secret_invalid"), { failure_code: "media_worker_secret_invalid" });
  process.exit(1);
}
if (!/^[A-Za-z0-9._:-]{1,120}$/.test(workerId)) {
  log.error("startup_failed", new Error("media_worker_id_invalid"), { failure_code: "media_worker_id_invalid" });
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
    log.info("shutdown_requested", { signal, worker_id: workerId });
  });
}

function integerEnv(name, fallback, minimum, maximum) {
  const parsed = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    log.error("startup_failed", new Error("worker_configuration_invalid"), { failure_code: `${name.toLowerCase()}_invalid` });
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
  // `startup=1` is required, not optional. Without it the health endpoint also
  // reports fleet-health degradation, and the first such reason is a missing or
  // stale `media-processing` heartbeat — a row written ONLY by
  // /api/internal/media/process, which only this loop ever calls. Gating
  // startup on it means the worker refuses to start until a worker has already
  // run, and the exit propagates through the entrypoint to kill the container,
  // so Render crash-loops and the heartbeat can never appear. The startup
  // branch still verifies everything that is genuinely a precondition here:
  // moderation provider, worker config, database reachability and the
  // ffmpeg/ffprobe binaries. The entrypoint's own probe already uses it.
  const result = await internalRequest("/api/internal/media/health?startup=1", undefined, "GET");
  if (!result.ready) throw new Error("media_worker_not_ready");
}

async function runLoop() {
  await verifyReadiness();
  log.info("started", { batch_limit: limit, once, worker_id: workerId });

  while (!stopping) {
    iteration += 1;
    try {
      const result = await internalRequest("/api/internal/media/process", { limit, workerId });
      log.info("batch_completed", {
        dead_lettered: result.deadLettered ?? 0,
        failed: result.failed ?? 0,
        lease_lost: result.leaseLost ?? 0,
        processed: result.processed ?? 0,
        rejected: result.rejected ?? 0,
        retried: result.retried ?? 0,
        succeeded: result.succeeded ?? 0,
        worker_id: workerId
      });
      if (iteration % cleanupEvery === 0) {
        const cleanup = await internalRequest("/api/internal/media/cleanup", { limit: Math.min(100, limit * 5), workerId });
        log.info("cleanup_completed", {
          claimed: cleanup.claimed ?? 0,
          cleaned: cleanup.cleaned ?? 0,
          failed: cleanup.failed ?? 0,
          worker_id: workerId
        });
      }
    } catch {
      if (!stopping) {
        log.error("batch_failed", new Error("media_worker_request_failed"), { failure_code: "media_worker_request_failed", worker_id: workerId });
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
  log.error("startup_failed", new Error("media_worker_not_ready"), { failure_code: "media_worker_not_ready", worker_id: workerId });
  process.exitCode = 1;
}
log.info("stopped", { worker_id: workerId });
await flushWorkerTelemetry();
