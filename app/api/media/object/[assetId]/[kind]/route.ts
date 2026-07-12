import { NextRequest, NextResponse } from "next/server";
import { resolvePostMediaAccess } from "@/lib/server/post-media-access";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const MEDIA_ASSET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ assetId: string; kind: string }> }) {
  const { assetId, kind } = await params;
  if (!MEDIA_ASSET_ID_RE.test(assetId) || !["canonical", "thumbnail", "poster"].includes(kind)) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }
  const { actor } = await getRouteActor(req);
  try {
    const [media] = await resolvePostMediaAccess(createAdminClient(), [assetId], actor?.actorName ?? "");
    const target = kind === "thumbnail" ? media?.thumbnailUrl : kind === "poster" ? media?.posterUrl : media?.displayUrl;
    if (!target) return NextResponse.json({ error: "Media not found" }, { status: 404 });
    return NextResponse.redirect(target, {
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff"
      },
      status: 307
    });
  } catch {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }
}
