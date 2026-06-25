import { NextRequest, NextResponse } from "next/server";
import { runAccountMediaCleanupJobs } from "@/lib/server/account-media-cleanup";
import { createAdminClient } from "@/lib/supabase/admin";

function configuredSecret() {
  return process.env.ACCOUNT_MEDIA_CLEANUP_SECRET ?? process.env.MEMORY_UPLOAD_CLEANUP_SECRET ?? "";
}

function requestSecret(req: NextRequest) {
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return req.headers.get("x-cleanup-secret")?.trim() ?? "";
}

export async function POST(req: NextRequest) {
  const secret = configuredSecret();
  if (!secret || requestSecret(req) !== secret) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const requestedLimit = Number(body?.limit);
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 100)
    : 25;

  try {
    const result = await runAccountMediaCleanupJobs(createAdminClient(), limit);
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
