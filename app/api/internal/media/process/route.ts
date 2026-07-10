import { NextRequest, NextResponse } from "next/server";
import { runMediaProcessingBatch } from "@/lib/server/media-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

function configuredSecret() {
  return process.env.MEDIA_WORKER_SECRET ?? process.env.ACCOUNT_MEDIA_CLEANUP_SECRET ?? process.env.MEMORY_UPLOAD_CLEANUP_SECRET ?? "";
}

function requestSecret(req: NextRequest) {
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return req.headers.get("x-media-worker-secret")?.trim() ?? "";
}

export async function POST(req: NextRequest) {
  const secret = configuredSecret();
  if (!secret || requestSecret(req) !== secret) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const requestedLimit = Number(body?.limit);
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 25)
    : 5;

  try {
    const result = await runMediaProcessingBatch(createAdminClient(), limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[media-process] failed:", error);
    return NextResponse.json({ error: "Media processing failed" }, { status: 500 });
  }
}
