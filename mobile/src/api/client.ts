import { apiUrl } from "@/api/config";
import { supabase } from "@/api/supabase";

const DEFAULT_TIMEOUT_MS = 12_000;

async function sessionToken(action: string, required = true) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token ?? null;
  if (!token && required) throw new Error(`Log in before ${action}`);
  return token;
}

export async function authorizedJson<T>(
  path: string,
  init: RequestInit & { body?: string } = {},
  options: { action?: string; timeoutMs?: number } = {}
): Promise<T> {
  const token = await sessionToken(options.action ?? "using CircleBites");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      }
    });
    const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
    if (!response.ok || !payload) throw new Error(payload?.error ?? "Network request failed");
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
