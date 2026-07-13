import { NextRequest } from "next/server";
import {
  abandonIdempotency,
  apiJson,
  claimIdempotency,
  completeIdempotency,
  configuredInternalSecret,
  hashSecurityIdentifier,
  idempotencyFailure,
  internalRequestSecret,
  readBoundedJson,
  safeInternalFailure,
  timingSafeSecretMatch,
} from "@/lib/server/api-security";
import { createAdminClient } from "@/lib/supabase/admin";

const REPORT_STATUSES = new Set(["open", "reviewing", "actioned", "dismissed", "appealed", "resolved", "all"]);
const DECISIONS = new Set(["approved", "rejected"]);
const METHODS = ["POST"];

function authorized(req: NextRequest) {
  return timingSafeSecretMatch(
    internalRequestSecret(req, "x-moderation-operator-secret"),
    configuredInternalSecret("MODERATION_OPERATOR_SECRET")
  );
}

function parseLimit(req: NextRequest) {
  const value = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 100) : 50;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return safeInternalFailure();
  const status = req.nextUrl.searchParams.get("status")?.trim() || "open";
  if (!REPORT_STATUSES.has(status)) return apiJson({ error: "Invalid request" }, { status: 400 });
  let query = createAdminClient()
    .from("content_reports")
    .select("id, reporter_id, reporter_name, target_type, target_id, reason, details, status, created_at, updated_at, resolved_at")
    .order("created_at", { ascending: false })
    .limit(parseLimit(req));
  if (status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return apiJson({ error: "Unable to load moderation queue" }, { status: 500 });
  return apiJson({ reports: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return safeInternalFailure();
  const parsed = await readBoundedJson<Record<string, unknown>>(req, 16 * 1024);
  if (!parsed.ok) return apiJson(
    { error: parsed.reason === "too_large" ? "Request too large" : "Invalid request" },
    { status: parsed.reason === "too_large" ? 413 : 400 }
  );
  const body = parsed.value ?? {};
  const targetType = typeof body.targetType === "string" ? body.targetType.trim() : "";
  const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  const reasonCode = typeof body.reasonCode === "string" ? body.reasonCode.trim().toLowerCase() : null;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : null;
  if (!/^[0-9a-f-]{36}$/i.test(targetId) || (reasonCode && !/^[a-z0-9_]{1,80}$/.test(reasonCode))) {
    return apiJson({ error: "Invalid request" }, { status: 400 });
  }
  const operatorIdentity = process.env.MODERATION_OPERATOR_ID?.trim() || "configured-operator";
  const operatorHash = hashSecurityIdentifier("moderation-operator", operatorIdentity);
  if (!operatorHash) return apiJson({ error: "Moderation service unavailable" }, { status: 503 });
  const idempotency = await claimIdempotency(req, "internal.operator", operatorHash, body);
  if (idempotency.state !== "claimed") return idempotencyFailure(req, METHODS, idempotency);

  const admin = createAdminClient();
  let changed = false;
  if (targetType === "media" && DECISIONS.has(action)) {
    const { data, error } = await admin.rpc("apply_media_moderation_action", {
      p_action: action,
      p_asset_id: targetId,
      p_operator_hash: operatorHash,
      p_reason_code: reasonCode,
    });
    if (error) {
      await abandonIdempotency(idempotency);
      return apiJson({ error: "Moderation action failed" }, { status: 500 });
    }
    changed = data === true;
  } else if (targetType === "report" && REPORT_STATUSES.has(action) && action !== "all" && action !== "open") {
    const { data, error } = await admin.rpc("apply_report_moderation_action", {
      p_action_code: reasonCode || `mark_${action}`,
      p_note: note,
      p_operator_hash: operatorHash,
      p_report_id: targetId,
      p_to_status: action,
    });
    if (error) {
      await abandonIdempotency(idempotency);
      return apiJson({ error: "Moderation action failed" }, { status: 500 });
    }
    changed = data === true;
  } else {
    await abandonIdempotency(idempotency);
    return apiJson({ error: "Invalid request" }, { status: 400 });
  }
  if (!changed) {
    await abandonIdempotency(idempotency);
    return apiJson({ error: "Target not found or already actioned" }, { status: 404 });
  }
  const responseBody = { ok: true };
  await completeIdempotency(idempotency, 200, responseBody);
  return apiJson(responseBody);
}
