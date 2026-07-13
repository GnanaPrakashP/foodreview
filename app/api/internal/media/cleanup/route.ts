import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedMediaWorkerRequest, readBoundedMediaWorkerJson } from "@/lib/server/internal-media-auth";
import { runMediaCleanupBatch } from "@/lib/server/media-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!isAuthorizedMediaWorkerRequest(req)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsedBody = await readBoundedMediaWorkerJson(req);
  if (!parsedBody.ok) {
    return NextResponse.json(
      { error: parsedBody.reason === "too_large" ? "Request too large" : "Invalid request" },
      { status: parsedBody.reason === "too_large" ? 413 : 400 }
    );
  }
  const body = parsedBody.value as { limit?: unknown; workerId?: unknown } | null;
  const requestedLimit = Number(body?.limit);
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 25;
  const workerId = typeof body?.workerId === "string" && /^[A-Za-z0-9._:-]{1,120}$/.test(body.workerId)
    ? body.workerId
    : undefined;
  try {
    return NextResponse.json({ ok: true, ...(await runMediaCleanupBatch(createAdminClient(), { limit, workerId })) });
  } catch {
    console.error(JSON.stringify({ component: "media-worker", event: "cleanup_batch_failed", failureCode: "media_cleanup_failed" }));
    return NextResponse.json({ error: "Media cleanup failed" }, { status: 500 });
  }
}
