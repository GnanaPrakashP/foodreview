import { apiJson } from "@/lib/server/api-security";

export async function POST() {
  return apiJson({ error: "Legacy media moderation endpoint is retired" }, { status: 410 });
}
