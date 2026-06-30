import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function configuredSecret() {
  return process.env.ACCOUNT_MEDIA_CLEANUP_SECRET ?? process.env.MEMORY_UPLOAD_CLEANUP_SECRET ?? "";
}

function requestSecret(req: NextRequest) {
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return req.headers.get("x-cleanup-secret")?.trim() ?? "";
}

function parseLimit(req: NextRequest) {
  const value = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 200) : 50;
}

export async function GET(req: NextRequest) {
  const secret = configuredSecret();
  if (!secret || requestSecret(req) !== secret) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const status = req.nextUrl.searchParams.get("status")?.trim() || "open";
  let query = createAdminClient()
    .from("content_reports")
    .select("id, reporter_id, reporter_name, target_type, target_id, reason, details, status, moderator_id, moderator_name, resolution_note, created_at, updated_at, resolved_at")
    .order("created_at", { ascending: false })
    .limit(parseLimit(req));

  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load reports" }, { status: 500 });
  return NextResponse.json({ reports: data ?? [] });
}
