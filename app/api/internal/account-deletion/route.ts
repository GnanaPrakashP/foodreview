import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runAccountDeletionJobs } from "@/lib/server/account-deletion";
import { createAdminClient } from "@/lib/supabase/admin";

function configuredSecret() {
  return process.env.ACCOUNT_DELETION_WORKER_SECRET ?? "";
}

function requestSecret(req: NextRequest) {
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return req.headers.get("x-account-deletion-secret")?.trim() ?? "";
}

function secretsMatch(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export async function POST(req: NextRequest) {
  const secret = configuredSecret();
  if (!secret || !secretsMatch(requestSecret(req), secret)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const requestedLimit = Number(body?.limit);
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 50)
    : 10;
  const jobId = typeof body?.jobId === "string" && /^[0-9a-f-]{36}$/i.test(body.jobId)
    ? body.jobId
    : null;

  try {
    const result = await runAccountDeletionJobs(createAdminClient(), { jobId, limit });
    return NextResponse.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch {
    return NextResponse.json({ error: "Account deletion processing failed" }, { status: 500 });
  }
}
