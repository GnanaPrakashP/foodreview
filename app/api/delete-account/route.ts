import { NextRequest, NextResponse } from "next/server";
import { memoryErrorKind, memoryOperationDurationMs, recordMemoryOperation } from "@/lib/server/memory-observability";
import { getRouteActor } from "@/lib/server/route-supabase";
import { enforceRateLimit, rateLimitResponse } from "@/lib/server/api-security";

const METHODS = ["POST"];

type DeletionRequestRow = {
  job_id: string;
  job_status: string;
};

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const { actor, actorResolution, authenticatedUserId, supabase } = await getRouteActor(req);
    const deletionUserId = actor?.userId
      ?? (actorResolution.status === "frozen" ? authenticatedUserId : null);
    if (!deletionUserId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const rate = await enforceRateLimit(req, "account.deletion", { actorUserId: deletionUserId });
    if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

    // The owner-only RPC creates or reuses a durable job and freezes/suppresses
    // the account in the same transaction. Storage, database, and Auth cleanup
    // are intentionally completed by the protected bounded worker.
    const { data, error } = await supabase.rpc("request_account_deletion");
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] as DeletionRequestRow | undefined : null;
    if (!row?.job_id) throw new Error("account_deletion_job_not_recorded");

    recordMemoryOperation("account_delete.request", {
      durationMs: memoryOperationDurationMs(startedAt),
      status: "accepted",
      statusCode: 202
    });
    return NextResponse.json({
      accepted: true,
      jobId: row.job_id,
      status: row.job_status
    }, {
      headers: { "Cache-Control": "private, no-store" },
      status: 202
    });
  } catch (error) {
    recordMemoryOperation("account_delete.request", {
      durationMs: memoryOperationDurationMs(startedAt),
      errorKind: memoryErrorKind(error),
      status: "error",
      statusCode: 500
    });
    return NextResponse.json({ error: "Unable to start account deletion" }, { status: 500 });
  }
}
