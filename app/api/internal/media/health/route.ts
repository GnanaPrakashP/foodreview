import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedMediaWorkerRequest } from "@/lib/server/internal-media-auth";
import { mediaWorkerConfig, mediaWorkerQueueHealth, runMediaBinaryCheck } from "@/lib/server/media-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { mediaModerationProviderConfigured } from "@/lib/server/memory-media";
import { securityIdentifierHashingConfigured } from "@/lib/server/api-security";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorizedMediaWorkerRequest(req)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    if (!mediaModerationProviderConfigured()) throw new Error("media_moderation_provider_unavailable");
    if (!securityIdentifierHashingConfigured()) throw new Error("media_audit_hash_unavailable");
    mediaWorkerConfig();
    const admin = createAdminClient();
    const [queue] = await Promise.all([
      mediaWorkerQueueHealth(admin),
      runMediaBinaryCheck("ffmpeg"),
      runMediaBinaryCheck("ffprobe")
    ]);
    const startup = req.nextUrl.searchParams.get("startup") === "1";
    const degradedReasons = startup
      ? []
      : [
        ...(queue.workerHeartbeatDue || queue.workerHeartbeatAgeSeconds === null
          ? ["worker_heartbeat_stale"]
          : []),
        ...(queue.queued > 0 && queue.oldestQueuedAgeSeconds > 120 && queue.claimsPerMinute === 0
          ? ["queued_jobs_unclaimed"]
          : []),
        ...(queue.staleRunningLeases > 0 ? ["stale_running_lease"] : []),
        ...(queue.deadLetters24h > 0 ? ["dead_letters_present"] : [])
      ];
    if (degradedReasons.length > 0) {
      return NextResponse.json(
        { degradedReasons, ok: false, queue, ready: false },
        { headers: { "Cache-Control": "no-store" }, status: 503 }
      );
    }
    return NextResponse.json(
      { degradedReasons, ok: true, ready: true, queue },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ ok: false, ready: false }, { headers: { "Cache-Control": "no-store" }, status: 503 });
  }
}
