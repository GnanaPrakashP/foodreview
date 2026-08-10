import { apiUrl } from "@/api/config";
import { supabase } from "@/api/supabase";
import { createRequestId, getInstallId } from "@/services/installIdentity";
import { captureMobileError, recordMobileFlow } from "@/observability/mobileTelemetry";

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
    "X-Witoh-Install-Id": installId,
    ...(normalizedMethod === "GET" || normalizedMethod === "HEAD" ? {} : { "Idempotency-Key": createRequestId() }),
  };
}

export async function authorizedJson<T>(
  path: string,
  init: RequestInit & { body?: string } = {},
  options: { action?: string; timeoutMs?: number } = {}
): Promise<T> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  let didTimeout = false;
  const forwardExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", forwardExternalAbort, { once: true });
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();
  const requestId = createRequestId();
  const endpoint = path.split("?")[0]
    .split("/")
    .filter(Boolean)
    .map((segment) => /^[0-9a-f-]{20,}$/i.test(segment) || /^\d+$/.test(segment) ? ":id" : segment.replace(/[^a-z0-9-]/gi, "_").slice(0, 40))
    .join("/")
    .slice(0, 120);

  try {
    const method = (init.method ?? "GET").toUpperCase();
    const securityHeaders = await authorizedApiHeaders(options.action ?? "using Witoh", method);
    const response = await fetch(apiUrl(path), {
      ...init,
      signal: controller.signal,
      headers: {
        ...securityHeaders,
        "X-Request-Id": requestId,
        ...(init.headers ?? {})
      }
    });
    const payload = await response.json().catch(() => null) as (T & { code?: string; correlationId?: string; error?: string }) | null;
    if (!response.ok || !payload) {
      const error = new MobileApiError(
        payload?.error ?? "Network request failed",
        payload?.code ?? (response.status === 401 ? "authentication_required" : "temporary_failure"),
        response.status,
        response.headers.get("retry-after") ? Number(response.headers.get("retry-after")) : null,
        payload?.correlationId ?? response.headers.get("x-request-id") ?? response.headers.get("x-correlation-id"),
      );
      captureMobileError("api.failure", error, {
        correlation_id: error.correlationId,
        endpoint,
        status: error.status
      });
      recordMobileFlow("api.request", Date.now() - startedAt, "failure", { endpoint, status: error.status });
      throw error;
    }
    recordMobileFlow("api.request", Date.now() - startedAt, "success", { endpoint, status: response.status });
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (externalSignal?.aborted && !didTimeout) throw error;
      const timeoutError = new Error("Request timed out. Please try again.");
      captureMobileError("api.timeout", timeoutError, { correlation_id: requestId, endpoint });
      recordMobileFlow("api.request", Date.now() - startedAt, "failure", { endpoint, status: 0 });
      throw timeoutError;
    }
    if (!(error instanceof MobileApiError)) {
      captureMobileError("api.failure", error, { correlation_id: requestId, endpoint });
      recordMobileFlow("api.request", Date.now() - startedAt, "failure", { endpoint, status: 0 });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", forwardExternalAbort);
  }
}
