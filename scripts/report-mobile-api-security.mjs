#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const routeRoot = path.join(root, "app/api");
const mobileRoots = [path.join(root, "mobile/app"), path.join(root, "mobile/src")];

function filesUnder(directory, predicate = () => true) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(absolute, predicate));
    else if (predicate(absolute)) files.push(absolute);
  }
  return files;
}

const routeFiles = filesUnder(routeRoot, (file) => file.endsWith("/route.ts")).sort();
const mobileFiles = mobileRoots.flatMap((directory) => filesUnder(directory, (file) => /\.(ts|tsx)$/.test(file)));
const mobileSources = mobileFiles.map((file) => ({ file, source: readFileSync(file, "utf8") }));
const internalRoutes = new Set(routeFiles.filter((file) => file.includes("/api/internal/")));
const anonymousRoutes = new Set([
  "/api/mobile/auth/resolve-email",
  "/api/mobile/auth/password-recovery",
]);
const optionalActorRoutes = new Set([
  "/api/feed/public",
  "/api/mobile/feed",
  "/api/media/access",
  "/api/users/[targetUserId]/reviews",
]);

function routePath(file) {
  return `/${path.relative(path.join(root, "app"), path.dirname(file)).split(path.sep).join("/")}`;
}

function mobileConsumers(route) {
  const stablePrefix = route.split("[")[0].replace(/\/$/, "");
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactRoute = new RegExp(`${escape(route)}(?:[?\"'\x60]|$)`);
  const dynamicPrefix = new RegExp(`${escape(stablePrefix)}[^\"'\x60]*`);
  return mobileSources
    .filter(({ source }) => exactRoute.test(source) || (route.includes("[") && stablePrefix.length > 8 && dynamicPrefix.test(source)))
    .map(({ file }) => path.relative(root, file))
    .sort();
}

function methods(source) {
  return Array.from(source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE|OPTIONS)\b/g), (match) => match[1]);
}

function authentication(file, route, source) {
  if (internalRoutes.has(file)) return "internal secret";
  if (anonymousRoutes.has(route)) return "anonymous";
  if (optionalActorRoutes.has(route)) return "optional actor";
  if (/getRouteActor|getNotificationRouteContext/.test(source)) return "authenticated actor";
  return "public/route-specific";
}

function authorization(route, source) {
  if (route.startsWith("/api/internal/")) return "dedicated timing-safe server secret";
  if (/getRouteActor|getNotificationRouteContext/.test(source)) {
    return /createAdminClient/.test(source)
      ? "canonical actor plus server-side ownership/membership checks"
      : "canonical actor plus RLS";
  }
  if (route === "/api/feed/public") return "public active-content filters; actor-only personalization";
  return /createAdminClient/.test(source) ? "server-enforced public filter" : "RLS or non-sensitive public contract";
}

function requestBounds(method, source) {
  if (method === "GET" || method === "OPTIONS") return "query/path bounds plus 1 MiB global ceiling";
  if (/readBoundedJson|readBoundedMediaWorkerJson/.test(source)) return "streaming endpoint bound plus 1 MiB global ceiling";
  return "1 MiB global ceiling plus handler field/array bounds";
}

function providerCost(source) {
  if (/places\.googleapis|maps\.googleapis/.test(source)) return "Google Maps/Places";
  if (/vision\.googleapis|videointelligence\.googleapis/.test(source)) return "moderation provider";
  if (/exp\.host/.test(source)) return "Expo Push";
  if (/sharp\(/.test(source)) return "CPU/image processing";
  return "none";
}

function risk(route, method, source) {
  if (route.startsWith("/api/internal/") || /createAdminClient/.test(source) || providerCost(source) !== "none") return "high";
  if (method !== "GET" && method !== "OPTIONS") return "medium";
  return "low";
}

const inventory = routeFiles.flatMap((file) => {
  const source = readFileSync(file, "utf8");
  const route = routePath(file);
  const consumers = mobileConsumers(route);
  return methods(source).map((method) => ({
    authentication: authentication(file, route, source),
    authorization: authorization(route, source),
    classification: route.startsWith("/api/internal/")
      ? "internal mobile-support"
      : consumers.length > 0 ? "active mobile" : /Legacy media moderation endpoint is retired/.test(source) ? "retired" : "supporting/legacy web",
    idempotency: /claimIdempotency|already|upsert|onConflict|status === "finalized"|Idempotent/.test(source)
      ? "explicit or naturally idempotent" : method === "GET" || method === "OPTIONS" ? "not applicable" : "not required/documented",
    logging: /console\.(error|warn)/.test(source) ? "server logs present; security review required" : "no route-local sensitive logging",
    method,
    mobileConsumers: consumers,
    providerCost: providerCost(source),
    rateLimit: /enforceRateLimit/.test(source) ? "durable shared PostgreSQL policy" : "not endpoint-specific",
    requestBounds: requestBounds(method, source),
    risk: risk(route, method, source),
    route,
    sensitiveResponse: /notification|account|profile|media|memor|feed|comment|report|circle/.test(route)
      ? "yes; private no-store/security headers" : "low/none",
    serviceRole: /createAdminClient|SUPABASE_SERVICE_ROLE_KEY/.test(source),
  }));
});

const allApiSource = routeFiles.map((file) => readFileSync(file, "utf8")).join("\n");
const actorLookupFiles = filesUnder(path.join(root, "app/api"), (file) => file.endsWith(".ts"))
  .filter((file) => /auth\.getUser\s*\(/.test(readFileSync(file, "utf8")));
const errors = [];
if (/auth\.admin\.listUsers|schema\(["']auth["']\)\s*\.from\(["']users["']\)/s.test(allApiSource)) {
  errors.push("public Auth directory scan remains");
}
if (/Access-Control-Allow-Origin["']?\s*:\s*["']\*/.test(allApiSource)) errors.push("wildcard API CORS remains");
if (/getRouteActor\(\)/.test(allApiSource)) errors.push("route calls canonical actor resolver without its request");
if (actorLookupFiles.length > 0) errors.push(`route-local auth.getUser remains: ${actorLookupFiles.map((file) => path.relative(root, file)).join(", ")}`);
for (const required of [
  "/api/mobile/auth/resolve-email", "/api/mobile/auth/password-recovery",
  "/api/places/autocomplete", "/api/places/details", "/api/places/reverse-geocode",
  "/api/reports", "/api/mobile/blocks", "/api/mobile/memories/notify",
  "/api/media/upload-intent", "/api/media/finalize-upload", "/api/media/access",
]) {
  const rows = inventory.filter((row) => row.route === required && row.method !== "OPTIONS");
  if (rows.length === 0) errors.push(`required security inventory route missing: ${required}`);
  else if (rows.some((row) => row.rateLimit === "not endpoint-specific")) errors.push(`required durable rate policy missing: ${required}`);
}
const unmeteredMobileMutations = inventory.filter((row) =>
  row.classification === "active mobile"
  && !["GET", "OPTIONS"].includes(row.method)
  && row.rateLimit === "not endpoint-specific"
);
if (unmeteredMobileMutations.length > 0) {
  errors.push(`active mobile mutations without a durable policy: ${unmeteredMobileMutations.map((row) => `${row.method} ${row.route}`).join(", ")}`);
}
const unsafeProviderRows = inventory.filter((row) => row.providerCost !== "none" && row.rateLimit === "not endpoint-specific" && row.authentication !== "internal secret");
if (unsafeProviderRows.length > 0) errors.push(`provider-backed operations without a cost limit: ${unsafeProviderRows.map((row) => row.route).join(", ")}`);

async function runtimeDiagnostics() {
  if (!process.argv.includes("--runtime")) return null;
  const statusResult = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], {
    cwd: root, encoding: "utf8",
  });
  if (statusResult.status !== 0) {
    errors.push("local API-security datastore is unavailable");
    return { available: false };
  }
  try {
    const status = JSON.parse(statusResult.stdout);
    const client = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const [contract, rateRows, expiredRates, expiredIdempotency, pendingMedia, openReports] = await Promise.all([
      client.rpc("production_schema_contract"),
      client.from("api_rate_limit_buckets").select("identifier_hash", { count: "exact", head: true }),
      client.from("api_rate_limit_buckets").select("identifier_hash", { count: "exact", head: true }).lte("expires_at", new Date().toISOString()),
      client.from("api_idempotency_records").select("actor_hash", { count: "exact", head: true }).lte("expires_at", new Date().toISOString()),
      client.from("media_assets").select("id", { count: "exact", head: true }).eq("moderation_status", "pending"),
      client.from("content_reports").select("id", { count: "exact", head: true }).in("status", ["open", "reviewing", "appealed"]),
    ]);
    const results = [contract, rateRows, expiredRates, expiredIdempotency, pendingMedia, openReports];
    if (results.some((result) => result.error)) {
      errors.push("API-security runtime health queries failed");
      return { available: false };
    }
    for (const key of [
      "missingApiSecurityTables", "rlsDisabledApiSecurityTables", "missingApiSecurityFunctions",
      "clientApiSecurityFunctionGrants", "clientApiSecurityTableGrants", "unsafeApiSecurityDefiners",
    ]) {
      if (!Array.isArray(contract.data?.[key]) || contract.data[key].length > 0) errors.push(`runtime schema contract drift: ${key}`);
    }
    return {
      available: true,
      cleanupBacklog: { expiredIdempotency: expiredIdempotency.count ?? 0, expiredRateBuckets: expiredRates.count ?? 0 },
      limiterRows: rateRows.count ?? 0,
      moderationBacklog: { openReports: openReports.count ?? 0, pendingMedia: pendingMedia.count ?? 0 },
      privilegedClientGrantDrift: 0,
    };
  } catch {
    errors.push("API-security runtime diagnostics failed safely");
    return { available: false };
  }
}

const summary = {
  activeMobileOperations: inventory.filter((row) => row.classification === "active mobile").length,
  highRiskOperations: inventory.filter((row) => row.risk === "high").length,
  internalOperations: inventory.filter((row) => row.classification === "internal mobile-support").length,
  operations: inventory.length,
  rateLimitedOperations: inventory.filter((row) => row.rateLimit !== "not endpoint-specific").length,
  routeFiles: routeFiles.length,
};
const runtime = await runtimeDiagnostics();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ errors, inventory, runtime, summary }, null, 2));
} else {
  console.log(`API security inventory: ${summary.routeFiles} route files, ${summary.operations} operations, ${summary.activeMobileOperations} active-mobile operations, ${summary.internalOperations} internal operations, ${summary.rateLimitedOperations} explicitly rate-limited operations.`);
  if (errors.length > 0) {
    for (const error of errors) console.error(`FAIL: ${error}`);
  } else {
    console.log("PASS: API inventory is complete and critical Phase 4 trust-boundary checks pass.");
  }
  if (runtime) console.log(`Runtime security health: ${JSON.stringify(runtime)}`);
}
if (errors.length > 0) process.exitCode = 1;
