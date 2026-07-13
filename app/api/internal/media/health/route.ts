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
    if (req.nextUrl.searchParams.get("startup") !== "1") {
      const { data: heartbeat, error } = await createAdminClient()
        .from("operational_scheduler_heartbeats")
        .select("last_succeeded_at, next_expected_at")
        .eq("job_name", "media-processing")
        .maybeSingle<{ last_succeeded_at: string | null; next_expected_at: string | null }>();
      if (error || !heartbeat?.last_succeeded_at || !heartbeat.next_expected_at || new Date(heartbeat.next_expected_at).getTime() + 60_000 < Date.now()) {
        return NextResponse.json({ ok: false, ready: false }, { headers: { "Cache-Control": "no-store" }, status: 503 });
      }
    }
    return NextResponse.json({ ok: true, ready: true, queue }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, ready: false }, { headers: { "Cache-Control": "no-store" }, status: 503 });
  }
}
