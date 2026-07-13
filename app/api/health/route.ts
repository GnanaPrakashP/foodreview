import { NextResponse } from "next/server";
import { safeReleaseMetadata } from "@/lib/observability/config";

export function GET() {
  return NextResponse.json({ ok: true, ...safeReleaseMetadata() }, {
    headers: { "Cache-Control": "no-store" }
  });
}
