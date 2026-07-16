import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

export const repositoryRoot = new URL("../../", import.meta.url);
export const resultDirectory = new URL("../../load-results/", import.meta.url);

export function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

export function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

export async function readJson(pathOrUrl) {
  return JSON.parse(await readFile(pathOrUrl, "utf8"));
}

export async function loadCapacityConfig() {
  return readJson(new URL("../../config/load-capacity.json", import.meta.url));
}

export function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

export function deterministicUuid(namespace, value) {
  const bytes = Buffer.from(createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deterministicRandom(seed) {
  let state = Number.parseInt(createHash("sha256").update(String(seed)).digest("hex").slice(0, 8), 16) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function weightedChoice(weights, random = Math.random) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
  invariant(total > 0, "load_scenario_weights_empty");
  let cursor = random() * total;
  for (const [name, weight] of entries) {
    cursor -= Number(weight);
    if (cursor < 0) return name;
  }
  return entries.at(-1)[0];
}

export function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

export class MetricRegistry {
  constructor({ sampleCapPerGroup = 50000 } = {}) {
    invariant(Number.isInteger(sampleCapPerGroup) && sampleCapPerGroup > 0, "load_metric_sample_cap_invalid");
    this.sampleCapPerGroup = sampleCapPerGroup;
    this.samples = new Map();
    this.totals = new Map();
    this.totalRequests = 0;
    this.unexpectedErrors = 0;
    this.correctness = [];
  }

  record(group, sample) {
    const normalized = {
      bytes: Number(sample.bytes ?? 0),
      durationMs: Number(sample.durationMs ?? 0),
      expected: Boolean(sample.expected),
      status: Number(sample.status ?? 0)
    };
    const totals = this.totals.get(group) ?? { maximumBytes: 0, requests: 0, unexpectedErrors: 0 };
    totals.requests += 1;
    totals.maximumBytes = Math.max(totals.maximumBytes, normalized.bytes);
    if (!normalized.expected) totals.unexpectedErrors += 1;
    this.totals.set(group, totals);
    this.totalRequests += 1;
    if (!normalized.expected) this.unexpectedErrors += 1;

    const bucket = this.samples.get(group) ?? [];
    if (bucket.length < this.sampleCapPerGroup) bucket.push(normalized);
    else bucket[(totals.requests - 1) % this.sampleCapPerGroup] = normalized;
    this.samples.set(group, bucket);
  }

  unexpectedErrorRate() {
    return this.totalRequests ? this.unexpectedErrors / this.totalRequests : 0;
  }

  violation(code) {
    this.correctness.push(String(code).slice(0, 120));
  }

  summary() {
    const groups = {};
    const all = [];
    let maximumBytes = 0;
    for (const [name, totals] of this.totals) {
      const samples = this.samples.get(name) ?? [];
      all.push(...samples);
      const durations = samples.map((sample) => sample.durationMs);
      maximumBytes = Math.max(maximumBytes, totals.maximumBytes);
      groups[name] = {
        requests: totals.requests,
        sampledRequests: samples.length,
        sampling: totals.requests > samples.length ? "bounded-ring" : "complete",
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        p99Ms: percentile(durations, 0.99),
        maximumBytes: totals.maximumBytes,
        unexpectedErrors: totals.unexpectedErrors,
        unexpectedErrorRate: totals.requests ? totals.unexpectedErrors / totals.requests : 0
      };
    }
    const durations = all.map((sample) => sample.durationMs);
    return {
      aggregate: {
        requests: this.totalRequests,
        sampledRequests: all.length,
        sampling: this.totalRequests > all.length ? "bounded-ring" : "complete",
        sampleCapPerGroup: this.sampleCapPerGroup,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        p99Ms: percentile(durations, 0.99),
        maximumBytes,
        unexpectedErrors: this.unexpectedErrors,
        unexpectedErrorRate: this.unexpectedErrorRate()
      },
      groups
    };
  }
}

export function evaluateThresholds(metrics, thresholds, correctnessViolations = 0) {
  const failures = [];
  const aggregate = metrics.aggregate;
  if (aggregate.p50Ms > thresholds.httpP50Ms) failures.push(`http_p50:${aggregate.p50Ms}>${thresholds.httpP50Ms}`);
  if (aggregate.p95Ms > thresholds.httpP95Ms) failures.push(`http_p95:${aggregate.p95Ms}>${thresholds.httpP95Ms}`);
  if (aggregate.p99Ms > thresholds.httpP99Ms) failures.push(`http_p99:${aggregate.p99Ms}>${thresholds.httpP99Ms}`);
  if (aggregate.unexpectedErrorRate > thresholds.unexpectedErrorRate) failures.push(`unexpected_error_rate:${aggregate.unexpectedErrorRate}>${thresholds.unexpectedErrorRate}`);
  for (const [group, values] of Object.entries(metrics.groups)) {
    if (values.maximumBytes > thresholds.maximumPayloadBytes && group !== "storage-upload") {
      failures.push(`${group}_payload:${values.maximumBytes}>${thresholds.maximumPayloadBytes}`);
    }
  }
  if (correctnessViolations > thresholds.correctnessViolations) {
    failures.push(`correctness:${correctnessViolations}>${thresholds.correctnessViolations}`);
  }
  return failures;
}

function isProductionHostname(hostname, suffixes) {
  const normalized = hostname.toLowerCase();
  return suffixes.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`));
}

export class ExternalSafetyMonitor {
  constructor(config, { env = process.env, runId, scenario }) {
    this.config = config;
    this.runId = runId;
    this.scenario = scenario;
    this.polls = 0;
    this.lastPollAt = 0;
    this.inFlight = null;
    this.abortReason = null;
    this.maximums = { databaseCpuPercent: 0, databasePoolWaitP95Ms: 0, mediaOldestQueueAgeSeconds: 0 };
    this.required = config.safety.telemetryRequiredScenarios.includes(scenario);
    if (!this.required) return;

    invariant(Boolean(env.LOAD_SAFETY_TELEMETRY_URL && env.LOAD_SAFETY_TELEMETRY_TOKEN), "load_safety_telemetry_configuration_required");
    this.url = new URL(env.LOAD_SAFETY_TELEMETRY_URL);
    invariant(this.url.protocol === "https:", "load_safety_telemetry_https_required");
    invariant(!this.url.username && !this.url.password, "load_safety_telemetry_url_credentials_forbidden");
    invariant(!isProductionHostname(this.url.hostname, config.safety.productionHostSuffixes), "production_safety_telemetry_target_rejected");
    const allowed = new Set((env.LOAD_ALLOWED_SAFETY_HOSTS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
    invariant(allowed.has(this.url.hostname.toLowerCase()), "safety_telemetry_host_allowlist_required");
    this.token = env.LOAD_SAFETY_TELEMETRY_TOKEN;
  }

  async poll(force = false) {
    if (!this.required || this.abortReason) return this.abortReason;
    if (this.inFlight) return this.inFlight;
    const intervalMs = this.config.safety.telemetryPollSeconds * 1000;
    if (!force && Date.now() - this.lastPollAt < intervalMs) return null;
    this.lastPollAt = Date.now();
    this.inFlight = this.request().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async request() {
    try {
      const response = await fetch(this.url, {
        headers: { Authorization: `Bearer ${this.token}`, "X-CircleBites-Load-Run": this.runId },
        signal: AbortSignal.timeout(10000)
      });
      invariant(response.ok, "load_safety_telemetry_response_failed");
      const sample = await response.json();
      for (const key of ["databaseCpuPercent", "databasePoolWaitP95Ms", "mediaOldestQueueAgeSeconds"]) {
        invariant(Number.isFinite(sample[key]) && sample[key] >= 0, `load_safety_telemetry_metric_invalid:${key}`);
        this.maximums[key] = Math.max(this.maximums[key], sample[key]);
      }
      invariant(typeof sample.corruptionDetected === "boolean" && Number.isInteger(sample.authorizationViolations) && sample.authorizationViolations >= 0, "load_safety_telemetry_integrity_invalid");
      this.polls += 1;
      if (sample.corruptionDetected) this.abortReason = "data_corruption";
      else if (sample.authorizationViolations > 0) this.abortReason = "authorization_violation";
      else if (sample.databaseCpuPercent > this.config.safety.abort.databaseCpuPercent) this.abortReason = "database_cpu";
      else if (sample.databasePoolWaitP95Ms > this.config.safety.abort.databasePoolWaitP95Ms) this.abortReason = "database_pool_wait";
      else if (sample.mediaOldestQueueAgeSeconds > this.config.safety.abort.mediaOldestQueueAgeSeconds) this.abortReason = "media_queue_age";
    } catch {
      this.abortReason = "safety_telemetry_unavailable";
    }
    return this.abortReason;
  }

  summary() {
    return { required: this.required, polls: this.polls, abortReason: this.abortReason, maximums: this.maximums };
  }
}

export function safeTargetMetadata(config, env = process.env, options = {}) {
  const apiUrl = new URL(env.LOAD_STAGING_API_URL ?? "https://missing.invalid");
  const supabaseUrl = new URL(env.LOAD_STAGING_SUPABASE_URL ?? "https://missing.invalid");
  const allowLocal = Boolean(options.allowLocal);
  const allowDevelopment = Boolean(options.allowDevelopment);
  if (allowLocal) {
    const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
    invariant(loopbackHosts.has(apiUrl.hostname) && loopbackHosts.has(supabaseUrl.hostname), "load_local_target_must_be_loopback");
    invariant(apiUrl.protocol === "http:" && supabaseUrl.protocol === "http:", "load_local_target_must_use_http");
    invariant(env.LOAD_LOCAL_CONFIRMATION === config.safety.localValidationConfirmation, "load_local_confirmation_required");
  } else if (allowDevelopment) {
    const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
    invariant(loopbackHosts.has(apiUrl.hostname) && apiUrl.protocol === "http:", "load_development_api_must_be_loopback");
    invariant(supabaseUrl.protocol === "https:", "load_development_supabase_must_use_https");
    invariant(!isProductionHostname(supabaseUrl.hostname, config.safety.productionHostSuffixes), "production_supabase_target_rejected");
    invariant(env.LOAD_DEVELOPMENT_CONFIRMATION === config.safety.developmentConfirmation, "load_development_confirmation_required");
    if (options.confirmation) invariant(env.LOAD_CONFIRMATION === options.confirmation, "load_confirmation_required");
    invariant(env.LOAD_ENVIRONMENT === "development-nonproduction", "load_development_environment_required");
    for (const name of ["LOAD_STAGING_ID", "LOAD_API_RELEASE", "LOAD_WORKER_RELEASE", "LOAD_GIT_COMMIT", "LOAD_MIGRATION_HEAD", "LOAD_DB_TIER", "LOAD_API_TOPOLOGY", "LOAD_WORKER_TOPOLOGY", "LOAD_REGIONS"]) {
      invariant(Boolean(env[name]?.trim()), `load_metadata_required:${name}`);
    }
    invariant(/^[0-9a-f]{7,64}$/i.test(env.LOAD_GIT_COMMIT), "load_git_commit_invalid");
  } else {
    invariant(env.LOAD_ENVIRONMENT === config.safety.requiredEnvironment, "load_environment_must_be_staging");
    invariant(env.LOAD_CONFIRMATION === (options.confirmation ?? config.safety.normalConfirmation), "load_confirmation_required");
    invariant(apiUrl.protocol === "https:" && supabaseUrl.protocol === "https:", "load_https_targets_required");
    invariant(!isProductionHostname(apiUrl.hostname, config.safety.productionHostSuffixes), "production_api_target_rejected");
    invariant(!isProductionHostname(supabaseUrl.hostname, config.safety.productionHostSuffixes), "production_supabase_target_rejected");
    const allowed = new Set((env.LOAD_ALLOWED_STAGING_HOSTS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
    invariant(allowed.has(apiUrl.hostname.toLowerCase()) && allowed.has(supabaseUrl.hostname.toLowerCase()), "staging_host_allowlist_required");
    for (const name of ["LOAD_STAGING_ID", "LOAD_API_RELEASE", "LOAD_WORKER_RELEASE", "LOAD_GIT_COMMIT", "LOAD_MIGRATION_HEAD", "LOAD_DB_TIER", "LOAD_API_TOPOLOGY", "LOAD_WORKER_TOPOLOGY", "LOAD_REGIONS"]) {
      invariant(Boolean(env[name]?.trim()), `load_metadata_required:${name}`);
    }
    invariant(/^[0-9a-f]{7,64}$/i.test(env.LOAD_GIT_COMMIT), "load_git_commit_invalid");
  }
  return {
    apiHost: apiUrl.hostname,
    apiRelease: env.LOAD_API_RELEASE ?? "ci-smoke",
    apiTopology: env.LOAD_API_TOPOLOGY ?? "local-mock",
    databaseTier: env.LOAD_DB_TIER ?? "local-mock",
    environment: allowLocal ? "local-contract" : env.LOAD_ENVIRONMENT,
    migrationHead: env.LOAD_MIGRATION_HEAD ?? "local-mock",
    regions: env.LOAD_REGIONS ?? "local",
    gitCommit: env.LOAD_GIT_COMMIT ?? "local-mock",
    stagingId: env.LOAD_STAGING_ID ?? "ci-smoke",
    supabaseHost: supabaseUrl.hostname,
    workerRelease: env.LOAD_WORKER_RELEASE ?? "ci-smoke",
    workerTopology: env.LOAD_WORKER_TOPOLOGY ?? "local-mock"
  };
}

export function assertNodeRuntime(config, options = {}) {
  const major = Number(process.versions.node.split(".")[0]);
  if (major !== config.harness.requiredNodeMajor && !options.localValidation) {
    throw new Error(`load_node_major_required:${config.harness.requiredNodeMajor}`);
  }
  return { actual: process.version, requiredMajor: config.harness.requiredNodeMajor, exact: major === config.harness.requiredNodeMajor };
}

export async function timedRequest(registry, group, url, options = {}) {
  const started = performance.now();
  const expectedStatuses = new Set(options.expectedStatuses ?? [200]);
  let status = 0;
  let bytes = 0;
  let payload = null;
  let expected = false;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        "X-Request-Id": options.requestId ?? randomUUID(),
        ...options.headers
      },
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 15000)
    });
    status = response.status;
    const text = await response.text();
    bytes = Buffer.byteLength(text);
    expected = expectedStatuses.has(status);
    if (options.parseJson !== false && text) payload = JSON.parse(text);
  } catch {
    expected = false;
  }
  const durationMs = Number((performance.now() - started).toFixed(3));
  registry.record(group, { bytes, durationMs, expected, status });
  return { bytes, durationMs, expected, payload, status };
}

export function actorHeaders(actor, extra = {}) {
  return {
    Authorization: `Bearer ${actor.accessToken}`,
    "Content-Type": "application/json",
    // Mobile clients persist one UUID per app installation. Give every virtual
    // actor the same stable shape so normal limiter traffic is not accidentally
    // collapsed into the shared "missing install" bucket.
    "X-FoodReview-Install-Id": deterministicUuid("circlebites-load-install", actor.username),
    ...extra
  };
}

export async function loadActorDefinitions(path = process.env.LOAD_ACTORS_FILE) {
  invariant(Boolean(path), "load_actors_file_required");
  const actors = await readJson(resolve(path));
  invariant(Array.isArray(actors) && actors.length > 0, "load_actors_invalid");
  return actors.map((actor, index) => {
    invariant(typeof actor.email === "string" || typeof actor.accessToken === "string", `load_actor_${index}_credential_missing`);
    invariant(typeof actor.username === "string" && actor.username.startsWith("load9_"), `load_actor_${index}_username_invalid`);
    invariant(actor.loadFixtureVersion === 1, `load_actor_${index}_fixture_version_invalid`);
    return {
      ...actor,
      blockedPostIds: Array.isArray(actor.blockedPostIds) ? actor.blockedPostIds : [],
      blockedUsernames: Array.isArray(actor.blockedUsernames) ? actor.blockedUsernames : [],
      engagementPostIds: Array.isArray(actor.engagementPostIds) ? actor.engagementPostIds : [],
      forbiddenRoomIds: Array.isArray(actor.forbiddenRoomIds) ? actor.forbiddenRoomIds : [],
      foreignCommentIds: Array.isArray(actor.foreignCommentIds) ? actor.foreignCommentIds : [],
      messageIds: Array.isArray(actor.messageIds) ? actor.messageIds : [],
      postIds: Array.isArray(actor.postIds) ? actor.postIds : [],
      roomIds: Array.isArray(actor.roomIds) ? actor.roomIds : [],
      placeIds: Array.isArray(actor.placeIds) ? actor.placeIds : []
    };
  });
}

export async function authenticateActors(definitions, count, env = process.env) {
  invariant(definitions.length >= count, `load_actor_count_insufficient:${definitions.length}<${count}`);
  const supabaseUrl = env.LOAD_STAGING_SUPABASE_URL?.replace(/\/$/, "");
  const anonKey = env.LOAD_STAGING_SUPABASE_ANON_KEY;
  const serviceKey = env.LOAD_STAGING_SERVICE_ROLE_KEY;
  invariant(Boolean(supabaseUrl && anonKey && serviceKey), "load_actor_auth_configuration_required");
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const actors = [];
  const authBatchSize = 2;
  for (let offset = 0; offset < count; offset += authBatchSize) {
    const batch = definitions.slice(offset, Math.min(count, offset + authBatchSize));
    const authenticated = await Promise.all(batch.map(async (actor) => {
      if (actor.accessToken) return actor;
      invariant(typeof actor.email === "string", "load_actor_email_required");
      let generated = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        generated = await admin.auth.admin.generateLink({ email: actor.email, type: "magiclink" });
        if (!generated.error && generated.data?.properties?.hashed_token) break;
        const status = Number(generated.error?.status ?? 0);
        if (status !== 429 && status < 500 && status !== 0) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(10000, 1000 * (2 ** attempt))));
      }
      const tokenHash = generated.data?.properties?.hashed_token;
      invariant(!generated.error && Boolean(tokenHash), `load_actor_magiclink_failed:${generated.error?.status ?? "unknown"}`);
      let response = null;
      let session = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          response = await fetch(`${supabaseUrl}/auth/v1/verify`, {
            body: JSON.stringify({ token_hash: tokenHash, type: "magiclink" }),
            headers: { apikey: anonKey, "Content-Type": "application/json" },
            method: "POST",
            signal: AbortSignal.timeout(15000)
          });
          session = await response.json().catch(() => null);
          if (response.ok && session?.access_token) break;
          if (response.status !== 429 && response.status < 500) break;
        } catch {
          response = null;
          session = null;
        }
        const retryAfterSeconds = Number(response?.headers?.get("retry-after") ?? 0);
        const backoffMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : Math.min(10000, 1000 * (2 ** attempt));
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
      const safeErrorCode = typeof session?.error_code === "string"
        ? session.error_code.replace(/[^a-z0-9_-]/gi, "-").slice(0, 60)
        : "unknown";
      invariant(response?.ok && session?.access_token, `load_actor_authentication_failed:${response?.status ?? 0}:${safeErrorCode}`);
      return { ...actor, accessToken: session.access_token, refreshToken: session.refresh_token };
    }));
    actors.push(...authenticated);
    if (offset + batch.length < count) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return actors;
}

export async function writeResult(result, label = result.scenario ?? "load") {
  await mkdir(resultDirectory, { recursive: true });
  const safeLabel = String(label).replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
  const file = new URL(`${Date.now()}-${safeLabel}.json`, resultDirectory);
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return basename(file.pathname);
}

export function capacityConclusion(hostedEvidenceComplete) {
  return hostedEvidenceComplete
    ? "PROVEN only for the exact measured profile recorded in this result"
    : "NOT PROVEN — harness complete, hosted execution blocked";
}

export function safeRunId() {
  return randomUUID();
}
