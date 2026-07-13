export function createApiSecurityStub({ json, fetchImpl } = {}) {
  const respond = json ?? ((body, init) => Response.json(body, init));
  const apiJson = (body, init = {}) => respond(body, init);
  const mobileApiJson = (_req, _methods, body, init = {}) => respond(body, init);

  return {
    abandonIdempotency: async () => undefined,
    apiJson,
    boundedJsonError: (_req, _methods, reason) => mobileApiJson(
      null,
      [],
      { error: reason === "too_large" ? "Request too large" : "Invalid request" },
      { status: reason === "too_large" ? 413 : 400 }
    ),
    claimIdempotency: async () => ({
      state: "claimed",
      id: "test-idempotency-record",
      keyHash: "test-idempotency-key",
    }),
    completeIdempotency: async () => undefined,
    configuredInternalSecret: () => "test-internal-secret",
    enforceRateLimit: async () => ({ allowed: true, remaining: 99, retryAfterSeconds: 0 }),
    fetchWithDeadline: (...args) => (fetchImpl ?? globalThis.fetch)(...args.slice(0, 2)),
    hashSecurityIdentifier: () => "test-security-hash",
    idempotencyFailure: (req, methods, claim) => mobileApiJson(
      req,
      methods,
      claim?.state === "replay" ? claim.body : { error: "Request already in progress" },
      { status: claim?.state === "replay" ? claim.status : 409 }
    ),
    internalRequestSecret: () => "test-internal-secret",
    mobileApiError: (req, methods, code, message, init = {}) => mobileApiJson(
      req,
      methods,
      { error: message, code, correlationId: "00000000-0000-4000-8000-000000000000" },
      init
    ),
    mobileApiJson,
    mobileCorsHeaders: () => ({}),
    mobileOptions: (req, methods) => mobileApiJson(req, methods, null, { status: 204 }),
    rateLimitResponse: (req, methods, result) => mobileApiJson(
      req,
      methods,
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(result?.retryAfterSeconds ?? 1) } }
    ),
    readBoundedJson: async (req) => {
      try {
        return { ok: true, value: await req.json() };
      } catch {
        return { ok: false, reason: "invalid_json" };
      }
    },
    requestInstallId: () => "00000000-0000-4000-8000-000000000001",
    requireIdempotencyKey: () => "test-idempotency-key",
    safeInternalFailure: () => apiJson({ error: "Not found" }, { status: 404 }),
    sha256: () => "test-sha256",
    timingSafeSecretMatch: (received, expected) => Boolean(expected) && received === expected,
  };
}
