import { NextRequest, NextResponse } from "next/server";
import {
  MEDIA_PRIVATE_BUCKET,
  MEDIA_PRIVATE_SIGNED_URL_TTL_SECONDS,
  type MediaAssetRow,
  type MediaDerivativeRow
} from "@/lib/server/media-pipeline";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type StatusDerivative = MediaDerivativeRow & {
  signedUrl?: string | null;
};

function parseIds(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("ids") ?? "";
  return Array.from(new Set(raw.split(",").map((id) => id.trim()).filter(Boolean))).slice(0, 25);
}

export async function GET(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ids = parseIds(req);
  if (ids.length === 0) return NextResponse.json({ assets: [] });

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("media_assets")
    .select("*")
    .in("id", ids)
    .returns<MediaAssetRow[]>();
  if (error) return NextResponse.json({ error: "Could not load media status" }, { status: 500 });

  const assets = (rows ?? []).filter((asset) => asset.owner_id === actor.userId || (asset.visibility === "public" && asset.status === "ready"));
  const allowedIds = assets.map((asset) => asset.id);
  if (allowedIds.length === 0) return NextResponse.json({ assets: [] });

  const { data: derivativeRows, error: derivativeError } = await admin
    .from("media_derivatives")
    .select("*")
    .in("asset_id", allowedIds)
    .returns<MediaDerivativeRow[]>();
  if (derivativeError) return NextResponse.json({ error: "Could not load media derivatives" }, { status: 500 });

  const derivatives = await Promise.all((derivativeRows ?? []).map(async (derivative): Promise<StatusDerivative> => {
    if (derivative.bucket_id !== MEDIA_PRIVATE_BUCKET) return derivative;
    const { data } = await admin.storage
      .from(MEDIA_PRIVATE_BUCKET)
      .createSignedUrl(derivative.storage_path, MEDIA_PRIVATE_SIGNED_URL_TTL_SECONDS);
    return { ...derivative, signedUrl: data?.signedUrl ?? null };
  }));

  const derivativesByAsset = new Map<string, StatusDerivative[]>();
  for (const derivative of derivatives) {
    const existing = derivativesByAsset.get(derivative.asset_id) ?? [];
    existing.push(derivative);
    derivativesByAsset.set(derivative.asset_id, existing);
  }

  return NextResponse.json({
    assets: assets.map((asset) => ({
      assetId: asset.id,
      derivatives: derivativesByAsset.get(asset.id) ?? [],
      failureReason: asset.failure_reason ?? null,
      mediaType: asset.media_type,
      status: asset.status,
      surface: asset.surface
    }))
  });
}
