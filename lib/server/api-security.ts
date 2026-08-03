import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MOBILE_API_POLICIES, type MobileApiPolicyName } from "@/lib/server/mobile-api-policies";
import { apiLogger } from "@/lib/observability/server";
import { safeCorrelationId } from "@/lib/observability/structured-log.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_SECRETS = new Set(["change-me", "changeme", "default", "secret", "test"]);
const SAFE_API_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "Cross-Origin-Resource-Policy": "same-site",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

export type RateLimitContext = {
  actorUserId?: string | null;
  subject?: string | null;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function apiJson(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...SAFE_API_HEADERS, ...init.headers },
  });
}

function allowedOrigins() {
  return new Set(
    (process.env.MOBILE_API_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
}

export function mobileCorsHeaders(req: NextRequest, methods: string[]) {
  const origin = req.headers.get("origin")?.trim() ?? "";
  const headers: Record<string, string> = {
    ...SAFE_API_HEADERS,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, X-FoodReview-Install-Id, X-Request-Id",
    "Access-Control-Allow-Methods": [...methods, "OPTIONS"].join(", "),
    "Vary": "Origin",
  };
  if (origin && allowedOrigins().has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

type ApiRequestContext = {
  requestId: string;
  startedAt: number;
};

const apiRequestContexts = new WeakMap<NextRequest, ApiRequestContext>();
const loggedApiRequests = new WeakSet<NextRequest>();
let apiRuntimeHasHandledRequest = false;

export function requestCorrelation(req: NextRequest): ApiRequestContext {
  const cached = apiRequestContexts.get(req);
  if (cached) return cached;
  const supplied = safeCorrelationId(req.headers.get("x-request-id"));
  const headerStart = Number(req.headers.get("x-foodreview-request-start-ms"));
  const context = {
    requestId: supplied ?? randomUUID(),
    startedAt: Number.isFinite(headerStart) && headerStart > 0 && headerStart <= Date.now()
      ? headerStart
      : Date.now()
  };
  apiRequestContexts.set(req, context);
  return context;
}

export function mobileEndpointLabel(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  return segments.map((segment, index) => {
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment) || /^\d+$/.test(segment)) return ":id";
    if (segments[index - 1] === "profiles" && segments[index + 1] === "shell") return ":username";
    if (segments[index - 1] === "memories" && !["read", "notify", "upload-intent", "finalize-upload", "uploads", "invites"].includes(segment)) return ":room";
    return /^[a-z0-9-]{1,40}$/i.test(segment) ? segment.toLowerCase() : ":value";
  }).join("/").slice(0, 120) || "api";
}

function payloadSizeCategory(body: unknown) {
  let size = 0;
  try {
    size = JSON.stringify(body).length;
  } catch {
    return "unknown";
  }
  if (size <= 1024) return "tiny";
  if (size <= 16 * 1024) return "small";
  if (size <= 128 * 1024) return "medium";
  return "large";
}

function responseCategory(status: number) {
  if (status < 400) return "success";
  if (status === 401) return "authentication_rejection";
  if (status === 403) return "authorization_rejection";
  if (status === 429) return "rate_limit_rejection";
  if (status < 500) return "expected_client_error";
  return "server_failure";
}

export function mobileApiJson(req: NextRequest, methods: string[], body: unknown, init: ResponseInit = {}) {
  const context = requestCorrelation(req);
  const status = init.status ?? 200;
  const responseBody = status >= 400 && body && typeof body === "object" && !Array.isArray(body)
    ? { ...(body as Record<string, unknown>), correlationId: context.requestId }
    : body;
  if (!loggedApiRequests.has(req)) {
    loggedApiRequests.add(req);
    const runtimeColdStart = !apiRuntimeHasHandledRequest;
    apiRuntimeHasHandledRequest = true;
    const serializationStartedAt = Date.now();
    const payloadSize = payloadSizeCategory(responseBody);
    const serializationDurationMs = Date.now() - serializationStartedAt;
    const fields = {
      correlation_id: context.requestId,
      duration_ms: Math.max(0, Date.now() - context.startedAt),
      endpoint: mobileEndpointLabel(req.nextUrl.pathname),
      method: req.method,
      payload_size: payloadSize,
      runtime_cold_start: runtimeColdStart,
      serialization_duration_ms: serializationDurationMs,
      status,
      status_category: responseCategory(status)
    };
    if (status >= 500) apiLogger.error("api_request_failed", new Error("api_server_failure"), fields);
    else if (status >= 400) apiLogger.warn("api_request_rejected", fields);
    else apiLogger.info("api_request_completed", fields);
  }
  return apiJson(responseBody, {
    ...init,
    headers: {
      ...mobileCorsHeaders(req, methods),
      "X-Correlation-Id": context.requestId,
      "X-Request-Id": context.requestId,
      ...init.headers
    },
  });
}

export type SafeApiErrorCode =
  | "authentication_required"
  | "invalid_input"
  | "operation_in_progress"
  | "permanent_denial"
  | "rate_limited"
  | "request_too_large"
  | "temporary_failure";

export function mobileApiError(
  req: NextRequest,
  methods: string[],
  code: SafeApiErrorCode,
  message: string,
  status: number,
  headers?: HeadersInit
) {
  const correlationId = requestCorrelation(req).requestId;
  return mobileApiJson(req, methods, { code, correlationId, error: message }, {
    headers: { "X-Correlation-Id": correlationId, ...headers },
    status,
  });
}

export function mobileOptions(req: NextRequest, methods: string[]) {
  const origin = req.headers.get("origin")?.trim() ?? "";
  if (origin && !allowedOrigins().has(origin)) {
    return new NextResponse(null, { headers: SAFE_API_HEADERS, status: 403 });
  }
  return new NextResponse(null, { headers: mobileCorsHeaders(req, methods), status: 204 });
}

export async function readBoundedJson<T = Record<string, unknown>>(req: NextRequest, maximumBytes: number) {
  const rawLength = req.headers.get("content-length");
  if (rawLength) {
    const length = Number(rawLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
      return { ok: false as const, reason: "too_large" as const };
    }
  }
  if (!req.body) return { ok: true as const, value: null as T | null };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false as const, reason: "too_large" as const };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true as const, value: JSON.parse(new TextDecoder().decode(bytes)) as T };
  } catch {
    return { ok: false as const, reason: "invalid_json" as const };
  }
}

export function boundedJsonError(req: NextRequest, methods: string[], reason: "too_large" | "invalid_json") {
  return mobileApiError(
    req,
    methods,
    reason === "too_large" ? "request_too_large" : "invalid_input",
    reason === "too_large" ? "Request too large" : "Invalid request",
    reason === "too_large" ? 413 : 400
  );
}

function hmacSecret() {
  const secret = process.env.API_RATE_LIMIT_HMAC_SECRET?.trim() ?? "";
  if (secret.length < 32 || FORBIDDEN_SECRETS.has(secret.toLowerCase())) return null;
  return secret;
}

/**
 * Readiness probe for services that depend on privacy-preserving audit hashes.
 * It deliberately exposes only configuration presence, never the secret.
 */
export function securityIdentifierHashingConfigured() {
  return hmacSecret() !== null;
}

export function hashSecurityIdentifier(kind: string, value: string) {
  const secret = hmacSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(`${kind}:${value}`).digest("hex");
}

export function requestInstallId(req: NextRequest) {
  const value = req.headers.get("x-foodreview-install-id")?.trim() ?? "";
  return UUID_RE.test(value) ? value.toLowerCase() : null;
}

function requestIp(req: NextRequest) {
  const hops = Number(process.env.API_TRUSTED_PROXY_HOPS ?? "0");
  if (!Number.isSafeInteger(hops) || hops < 1 || hops > 5) return "unavailable";
  const chain = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const index = chain.length - hops;
  const candidate = index >= 0 ? chain[index] : req.headers.get("x-real-ip")?.trim();
  if (!candidate || candidate.length > 64 || !/^[0-9a-f:.]+$/i.test(candidate)) return "unavailable";
  return candidate.toLowerCase();
}

export async function enforceRateLimit(
  req: NextRequest,
  policyName: MobileApiPolicyName,
  context: RateLimitContext = {}
): Promise<RateLimitResult> {
  const policy = MOBILE_API_POLICIES[policyName];
  if (policy.rateLimits.length === 0) return { allowed: true, remaining: 1, retryAfterSeconds: 0 };
  const values = {
    install: requestInstallId(req) ?? "missing",
    ip: requestIp(req),
    subject: context.subject?.trim().toLowerCase() || "missing",
    user: context.actorUserId ?? "missing",
  };
  const entries = policy.rateLimits.map((rule) => ({
    cost: rule.cost,
    endpoint: policyName,
    identifierHash: hashSecurityIdentifier(rule.dimension, values[rule.dimension]),
    limit: rule.limit,
    windowSeconds: rule.windowSeconds,
  }));
  if (entries.some((entry) => !entry.identifierHash)) {
    return { allowed: false, remaining: 0, retryAfterSeconds: 60 };
  }
  try {
    const { data, error } = await createAdminClient().rpc("consume_api_rate_limits", { p_entries: entries });
    if (error || !Array.isArray(data) || data.length !== 1) {
      return { allowed: false, remaining: 0, retryAfterSeconds: 30 };
    }
    const parsed: unknown = data[0];
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { allowed: false, remaining: 0, retryAfterSeconds: 30 };
    }
    const result = parsed as Record<string, unknown>;
    return {
      allowed: result.allowed === true,
      remaining: Number.isFinite(Number(result.remaining)) ? Math.max(0, Number(result.remaining)) : 0,
      retryAfterSeconds: Number.isFinite(Number(result.retryAfterSeconds))
        ? Math.max(0, Math.ceil(Number(result.retryAfterSeconds)))
        : 30,
    };
  } catch {
    // Security and provider-cost endpoints fail closed if the shared limiter is unavailable.
    return { allowed: false, remaining: 0, retryAfterSeconds: 30 };
  }
}

export function rateLimitResponse(req: NextRequest, methods: string[], result: RateLimitResult) {
  return mobileApiError(req, methods, "rate_limited", "Too many requests. Try again later.", 429, {
      "Retry-After": String(Math.max(1, result.retryAfterSeconds)),
      "X-RateLimit-Remaining": String(result.remaining),
  });
}

export function requireIdempotencyKey(req: NextRequest) {
  const value = req.headers.get("idempotency-key")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{16,128}$/.test(value) ? value : null;
}

export type IdempotencyClaim =
  | { state: "claimed"; actorHash: string; endpoint: string; keyHash: string }
  | { state: "in_progress" | "mismatch" }
  | { state: "replay"; body: unknown; status: number }
  | { state: "unavailable" };

export async function claimIdempotency(
  req: NextRequest,
  endpoint: string,
  actorUserId: string,
  requestBody: unknown
): Promise<IdempotencyClaim> {
  const key = requireIdempotencyKey(req);
  const actorHash = hashSecurityIdentifier("idempotency-actor", actorUserId);
  const keyHash = key ? hashSecurityIdentifier("idempotency-key", key) : null;
  const requestHash = sha256(JSON.stringify(requestBody));
  if (!key || !actorHash || !keyHash) return { state: "unavailable" };
  const admin = createAdminClient();
  const { error } = await admin.from("api_idempotency_records").insert({
    actor_hash: actorHash,
    endpoint,
    expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    key_hash: keyHash,
    request_hash: requestHash,
  });
  if (!error) return { actorHash, endpoint, keyHash, state: "claimed" };
  if (error.code !== "23505") return { state: "unavailable" };
  const { data, error: readError } = await admin
    .from("api_idempotency_records")
    .select("request_hash, response_status, response_body")
    .eq("actor_hash", actorHash)
    .eq("endpoint", endpoint)
    .eq("key_hash", keyHash)
    .maybeSingle<{ request_hash: string; response_body: unknown; response_status: number | null }>();
  if (readError || !data) return { state: "unavailable" };
  if (data.request_hash !== requestHash) return { state: "mismatch" };
  if (data.response_status == null) return { state: "in_progress" };
  return { body: data.response_body, state: "replay", status: data.response_status };
}

export async function completeIdempotency(
  claim: Extract<IdempotencyClaim, { state: "claimed" }>,
  status: number,
  body: unknown
) {
  await createAdminClient()
    .from("api_idempotency_records")
    .update({ response_body: body, response_status: status })
    .eq("actor_hash", claim.actorHash)
    .eq("endpoint", claim.endpoint)
    .eq("key_hash", claim.keyHash)
    .is("response_status", null);
}

export async function abandonIdempotency(
  claim: Extract<IdempotencyClaim, { state: "claimed" }>
) {
  await createAdminClient()
    .from("api_idempotency_records")
    .delete()
    .eq("actor_hash", claim.actorHash)
    .eq("endpoint", claim.endpoint)
    .eq("key_hash", claim.keyHash)
    .is("response_status", null);
}

export function idempotencyFailure(req: NextRequest, methods: string[], claim: IdempotencyClaim) {
  if (claim.state === "replay") return mobileApiJson(req, methods, claim.body, { status: claim.status });
  if (claim.state === "mismatch") {
    return mobileApiError(req, methods, "permanent_denial", "Idempotency key was reused for a different request", 409);
  }
  if (claim.state === "in_progress") {
    return mobileApiError(req, methods, "operation_in_progress", "Request is already being processed", 409);
  }
  return mobileApiError(req, methods, "invalid_input", "A valid idempotency key is required", 400);
}

export function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export function configuredInternalSecret(name: string) {
  const value = process.env[name]?.trim() ?? "";
  if (!value) return null;
  if (process.env.NODE_ENV === "production" && (value.length < 32 || FORBIDDEN_SECRETS.has(value.toLowerCase()))) {
    return null;
  }
  return value;
}

export function internalRequestSecret(req: NextRequest, headerName: string) {
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return req.headers.get(headerName)?.trim() ?? "";
}

export function timingSafeSecretMatch(received: string, expected: string | null) {
  if (!received || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function safeInternalFailure() {
  return apiJson({ error: "Not found" }, { status: 404 });
}

export async function fetchWithDeadline(input: string | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
