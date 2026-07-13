import { apiUrl } from "@/api/config";
import { supabase } from "@/api/supabase";
import { createRequestId, getInstallId } from "@/services/installIdentity";

const DEFAULT_TIMEOUT_MS = 12_000;

export class MobileApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryAfterSeconds: number | null,
    readonly correlationId: string | null,
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

async function sessionToken(action: string, required = true) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token ?? null;
  if (!token && required) throw new Error(`Log in before ${action}`);
  return token;
}

export async function authorizedApiHeaders(action: string, method = "GET") {
  const token = await sessionToken(action);
  const installId = await getInstallId();
  const normalizedMethod = method.toUpperCase();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-FoodReview-Install-Id": installId,
    ...(normalizedMethod === "GET" || normalizedMethod === "HEAD" ? {} : { "Idempotency-Key": createRequestId() }),
  };
}

export async function authorizedJson<T>(
  path: string,
  init: RequestInit & { body?: string } = {},
  options: { action?: string; timeoutMs?: number } = {}
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const method = (init.method ?? "GET").toUpperCase();
    const securityHeaders = await authorizedApiHeaders(options.action ?? "using CircleBites", method);
    const response = await fetch(apiUrl(path), {
      ...init,
      signal: controller.signal,
      headers: {
        ...securityHeaders,
        ...(init.headers ?? {})
      }
    });
    const payload = await response.json().catch(() => null) as (T & { code?: string; correlationId?: string; error?: string }) | null;
    if (!response.ok || !payload) {
      throw new MobileApiError(
        payload?.error ?? "Network request failed",
        payload?.code ?? (response.status === 401 ? "authentication_required" : "temporary_failure"),
        response.status,
        response.headers.get("retry-after") ? Number(response.headers.get("retry-after")) : null,
        payload?.correlationId ?? response.headers.get("x-correlation-id"),
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
