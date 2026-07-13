import { apiJson } from "@/lib/server/api-security";

// Retired Phase 4 bypass: active media uses upload intent -> private source ->
// moderation quarantine -> trusted worker. This legacy route previously copied
// caller-selected quarantine paths directly into a public bucket.
export async function POST() {
  return apiJson({ error: "Legacy media moderation endpoint is retired" }, { status: 410 });
}
