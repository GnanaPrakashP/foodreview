import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedMediaWorkerRequest } from "@/lib/server/internal-media-auth";
import { mediaWorkerConfig, mediaWorkerQueueHealth, runMediaBinaryCheck } from "@/lib/server/media-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorizedMediaWorkerRequest(req)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    mediaWorkerConfig();
    const [queue] = await Promise.all([
      mediaWorkerQueueHealth(createAdminClient()),
      runMediaBinaryCheck("ffmpeg"),
      runMediaBinaryCheck("ffprobe")
    ]);
    return NextResponse.json({ ok: true, ready: true, queue }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, ready: false }, { headers: { "Cache-Control": "no-store" }, status: 503 });
  }
}
