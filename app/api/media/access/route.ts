import { NextRequest, NextResponse } from "next/server";
import { resolvePostMediaAccess } from "@/lib/server/post-media-access";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};
const MEDIA_ASSET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  const body = await req.json().catch(() => null);
  const assetIds = Array.isArray(body?.assetIds)
    ? body.assetIds.filter((id: unknown): id is string => typeof id === "string" && MEDIA_ASSET_ID_RE.test(id)).slice(0, 50)
    : [];
  if (assetIds.length === 0) return NextResponse.json({ media: [] }, { headers: CORS_HEADERS });

  try {
    const media = await resolvePostMediaAccess(createAdminClient(), assetIds, actor?.actorName ?? "");
    return NextResponse.json({ media }, {
      headers: { ...CORS_HEADERS, "Cache-Control": "private, no-store" }
    });
  } catch {
    return NextResponse.json({ error: "Unable to authorize post media" }, { headers: CORS_HEADERS, status: 500 });
  }
}

export function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS, status: 204 });
}
