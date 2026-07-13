import { NextRequest, NextResponse } from "next/server";
import { configuredInternalSecret, internalRequestSecret, readBoundedJson, timingSafeSecretMatch } from "@/lib/server/api-security";
import { processPushReceiptBatch, processPushSendBatch } from "@/lib/server/push-delivery";

export const runtime = "nodejs";
export const maxDuration = 120;

function authorized(req: NextRequest) {
  return timingSafeSecretMatch(
    internalRequestSecret(req, "x-push-delivery-secret"),
    configuredInternalSecret("PUSH_DELIVERY_WORKER_SECRET")
  );
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = await readBoundedJson<Record<string, unknown>>(req, 4096);
  if (!parsed.ok) return NextResponse.json({ error: "Invalid request" }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const action = parsed.value?.action;
  const requestedLimit = Number(parsed.value?.limit);
  const limit = Number.isSafeInteger(requestedLimit) ? requestedLimit : undefined;
  const workerId = typeof parsed.value?.workerId === "string" ? parsed.value.workerId : undefined;
  try {
    if (action === "send") return NextResponse.json({ ok: true, ...(await processPushSendBatch({ limit, workerId })) });
    if (action === "receipts") return NextResponse.json({ ok: true, ...(await processPushReceiptBatch({ limit, workerId })) });
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Push delivery processing failed" }, { status: 500 });
  }
}
