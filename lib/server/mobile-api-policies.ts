export type ApiRateLimitRule = {
  cost: number;
  dimension: "ip" | "install" | "user" | "subject";
  limit: number;
  windowSeconds: number;
};

export type MobileApiPolicy = {
  authentication: "anonymous" | "optional" | "required" | "internal";
  bodyBytes: number;
  cors: "none" | "mobile";
  idempotency: "none" | "recommended" | "required";
  providerCost: "none" | "low" | "medium" | "high";
  rateLimits: ApiRateLimitRule[];
};

export const MOBILE_API_POLICIES = {
  "auth.email-otp": {
    authentication: "anonymous",
    bodyBytes: 1024,
    cors: "mobile",
    idempotency: "none",
    providerCost: "medium",
    rateLimits: [
      { cost: 1, dimension: "ip", limit: 8, windowSeconds: 300 },
      { cost: 1, dimension: "install", limit: 12, windowSeconds: 300 },
      { cost: 1, dimension: "subject", limit: 4, windowSeconds: 900 },
    ],
  },
  "provider.places-autocomplete": {
    authentication: "required",
    bodyBytes: 0,
    cors: "mobile",
    idempotency: "none",
    providerCost: "medium",
    rateLimits: [
      { cost: 1, dimension: "user", limit: 30, windowSeconds: 60 },
      { cost: 1, dimension: "install", limit: 40, windowSeconds: 60 },
      { cost: 1, dimension: "ip", limit: 80, windowSeconds: 60 },
    ],
  },
  "provider.places-details": {
    authentication: "required",
    bodyBytes: 0,
    cors: "mobile",
    idempotency: "none",
    providerCost: "high",
    rateLimits: [
      { cost: 2, dimension: "user", limit: 30, windowSeconds: 60 },
      { cost: 2, dimension: "install", limit: 40, windowSeconds: 60 },
      { cost: 2, dimension: "ip", limit: 80, windowSeconds: 60 },
    ],
  },
  "provider.reverse-geocode": {
    authentication: "required",
    bodyBytes: 0,
    cors: "mobile",
    idempotency: "none",
    providerCost: "medium",
    rateLimits: [
      { cost: 1, dimension: "user", limit: 20, windowSeconds: 60 },
      { cost: 1, dimension: "install", limit: 30, windowSeconds: 60 },
      { cost: 1, dimension: "ip", limit: 60, windowSeconds: 60 },
    ],
  },
  "public.share-image": {
    authentication: "anonymous",
    bodyBytes: 0,
    cors: "none",
    idempotency: "none",
    providerCost: "high",
    rateLimits: [
      { cost: 2, dimension: "ip", limit: 60, windowSeconds: 60 },
    ],
  },
  "mutation.social": {
    authentication: "required",
    bodyBytes: 16 * 1024,
    cors: "mobile",
    idempotency: "recommended",
    providerCost: "none",
    rateLimits: [
      { cost: 1, dimension: "user", limit: 60, windowSeconds: 60 },
      { cost: 1, dimension: "install", limit: 90, windowSeconds: 60 },
      { cost: 1, dimension: "ip", limit: 180, windowSeconds: 60 },
    ],
  },
  "mutation.activity": {
    authentication: "required",
    bodyBytes: 16 * 1024,
    cors: "mobile",
    idempotency: "recommended",
    providerCost: "none",
    rateLimits: [
      { cost: 1, dimension: "user", limit: 240, windowSeconds: 60 },
      { cost: 1, dimension: "install", limit: 300, windowSeconds: 60 },
      { cost: 1, dimension: "ip", limit: 600, windowSeconds: 60 },
    ],
  },
  "mutation.report": {
    authentication: "required",
    bodyBytes: 4096,
    cors: "mobile",
    idempotency: "required",
    providerCost: "none",
    rateLimits: [
      { cost: 1, dimension: "user", limit: 8, windowSeconds: 3600 },
      { cost: 1, dimension: "install", limit: 12, windowSeconds: 3600 },
      { cost: 1, dimension: "ip", limit: 30, windowSeconds: 3600 },
    ],
  },
  "mutation.block": {
    authentication: "required",
    bodyBytes: 2048,
    cors: "mobile",
    idempotency: "recommended",
    providerCost: "none",
    rateLimits: [
      { cost: 1, dimension: "user", limit: 20, windowSeconds: 3600 },
      { cost: 1, dimension: "install", limit: 30, windowSeconds: 3600 },
      { cost: 1, dimension: "ip", limit: 60, windowSeconds: 3600 },
    ],
  },
  "mutation.circle": {
    authentication: "required",
    bodyBytes: 4096,
    cors: "mobile",
    idempotency: "recommended",
    providerCost: "medium",
    rateLimits: [
      { cost: 1, dimension: "user", limit: 20, windowSeconds: 3600 },
      { cost: 1, dimension: "install", limit: 30, windowSeconds: 3600 },
      { cost: 1, dimension: "ip", limit: 60, windowSeconds: 3600 },
    ],
  },
  "notification.memory": {
    authentication: "required",
    bodyBytes: 4096,
    cors: "mobile",
    idempotency: "required",
    providerCost: "high",
    rateLimits: [
      { cost: 1, dimension: "user", limit: 12, windowSeconds: 60 },
      { cost: 1, dimension: "install", limit: 18, windowSeconds: 60 },
      { cost: 1, dimension: "ip", limit: 50, windowSeconds: 60 },
    ],
  },
  "notification.event": {
    authentication: "required",
    bodyBytes: 4096,
    cors: "mobile",
    idempotency: "required",
    providerCost: "medium",
    rateLimits: [
      { cost: 1, dimension: "user", limit: 20, windowSeconds: 60 },
      { cost: 1, dimension: "install", limit: 30, windowSeconds: 60 },
      { cost: 1, dimension: "ip", limit: 80, windowSeconds: 60 },
    ],
  },
  "media.intent": {
    authentication: "required",
    bodyBytes: 16 * 1024,
    cors: "mobile",
    idempotency: "required",
    providerCost: "high",
    rateLimits: [
      { cost: 1, dimension: "user", limit: 12, windowSeconds: 900 },
      { cost: 1, dimension: "install", limit: 18, windowSeconds: 900 },
      { cost: 1, dimension: "ip", limit: 50, windowSeconds: 900 },
    ],
  },
  "media.access": {
    authentication: "optional",
    bodyBytes: 8192,
    cors: "mobile",
    idempotency: "none",
    providerCost: "none",
    rateLimits: [
      { cost: 1, dimension: "user", limit: 120, windowSeconds: 60 },
      { cost: 1, dimension: "install", limit: 180, windowSeconds: 60 },
      { cost: 1, dimension: "ip", limit: 300, windowSeconds: 60 },
    ],
  },
  "profile.username": {
    authentication: "required",
    bodyBytes: 2048,
    cors: "mobile",
    idempotency: "recommended",
    providerCost: "none",
    rateLimits: [
      { cost: 1, dimension: "user", limit: 8, windowSeconds: 3600 },
      { cost: 1, dimension: "install", limit: 12, windowSeconds: 3600 },
      { cost: 1, dimension: "ip", limit: 30, windowSeconds: 3600 },
    ],
  },
  "profile.username-availability": {
    authentication: "required",
    bodyBytes: 0,
    cors: "mobile",
    idempotency: "none",
    providerCost: "none",
    rateLimits: [
      { cost: 1, dimension: "user", limit: 60, windowSeconds: 60 },
      { cost: 1, dimension: "install", limit: 90, windowSeconds: 60 },
      { cost: 1, dimension: "ip", limit: 180, windowSeconds: 60 },
    ],
  },
  "account.deletion": {
    authentication: "required",
    bodyBytes: 0,
    cors: "none",
    idempotency: "recommended",
    providerCost: "high",
    rateLimits: [
      { cost: 1, dimension: "user", limit: 3, windowSeconds: 86400 },
      { cost: 1, dimension: "install", limit: 3, windowSeconds: 86400 },
      { cost: 1, dimension: "ip", limit: 10, windowSeconds: 86400 },
    ],
  },
  "memory.participant": {
    authentication: "required",
    bodyBytes: 4096,
    cors: "mobile",
    idempotency: "recommended",
    providerCost: "medium",
    rateLimits: [
      { cost: 1, dimension: "user", limit: 20, windowSeconds: 3600 },
      { cost: 1, dimension: "install", limit: 30, windowSeconds: 3600 },
      { cost: 1, dimension: "ip", limit: 60, windowSeconds: 3600 },
    ],
  },
  "internal.worker": {
    authentication: "internal",
    bodyBytes: 4096,
    cors: "none",
    idempotency: "recommended",
    providerCost: "high",
    rateLimits: [],
  },
  "internal.operator": {
    authentication: "internal",
    bodyBytes: 16 * 1024,
    cors: "none",
    idempotency: "required",
    providerCost: "none",
    rateLimits: [],
  },
} as const satisfies Record<string, MobileApiPolicy>;

export type MobileApiPolicyName = keyof typeof MOBILE_API_POLICIES;
