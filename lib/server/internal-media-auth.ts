import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

const FORBIDDEN_DEFAULTS = new Set([
  "change-me",
  "changeme",
  "default",
  "media-worker-secret",
  "secret"
]);

export function configuredMediaWorkerSecret() {
  const secret = process.env.MEDIA_WORKER_SECRET?.trim() ?? "";
  if (!secret) return null;
  if (process.env.NODE_ENV === "production" && (secret.length < 32 || FORBIDDEN_DEFAULTS.has(secret.toLowerCase()))) {
    return null;
  }
  return secret;
}

export function mediaWorkerRequestSecret(req: NextRequest) {
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return req.headers.get("x-media-worker-secret")?.trim() ?? "";
}

export function isAuthorizedMediaWorkerRequest(req: NextRequest) {
  const expected = configuredMediaWorkerSecret();
  const received = mediaWorkerRequestSecret(req);
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function mediaWorkerRequestBodyAllowed(req: NextRequest, maximumBytes = 4096) {
  const raw = req.headers.get("content-length");
  if (!raw) return true;
  const length = Number(raw);
  return Number.isSafeInteger(length) && length >= 0 && length <= maximumBytes;
}

export async function readBoundedMediaWorkerJson(req: NextRequest, maximumBytes = 4096) {
  if (!mediaWorkerRequestBodyAllowed(req, maximumBytes)) return { ok: false as const, reason: "too_large" as const };
  if (!req.body) return { ok: true as const, value: null };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false as const, reason: "too_large" as const };
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true as const, value: JSON.parse(new TextDecoder().decode(body)) as unknown };
  } catch {
    return { ok: false as const, reason: "invalid_json" as const };
  }
}
