import { NextRequest, NextResponse } from "next/server";
import { safeMediaFailureMessage, type MediaAssetRow, type MediaDerivativeRow } from "@/lib/server/media-pipeline";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type StatusDerivative = Pick<MediaDerivativeRow, "blurhash" | "duration_ms" | "file_size_bytes" | "height" | "kind" | "mime_type" | "width">;

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

  // Status is an upload-owner endpoint, not a post-delivery endpoint. Post
  // access is resolved only after review linkage and current authorization.
  const assets = (rows ?? []).filter((asset) => asset.owner_id === actor.userId && asset.owner_name === actor.actorName);
  const allowedIds = assets.map((asset) => asset.id);
  if (allowedIds.length === 0) return NextResponse.json({ assets: [] });

  const { data: derivativeRows, error: derivativeError } = await admin
    .from("media_derivatives")
    .select("*")
    .in("asset_id", allowedIds)
    .returns<MediaDerivativeRow[]>();
  if (derivativeError) return NextResponse.json({ error: "Could not load media derivatives" }, { status: 500 });

  const derivatives: Array<StatusDerivative & { asset_id: string }> = (derivativeRows ?? []).map((derivative) => ({
    asset_id: derivative.asset_id,
    blurhash: derivative.blurhash,
    duration_ms: derivative.duration_ms,
    file_size_bytes: derivative.file_size_bytes,
    height: derivative.height,
    kind: derivative.kind,
    mime_type: derivative.mime_type,
    width: derivative.width
  }));

  const derivativesByAsset = new Map<string, StatusDerivative[]>();
  for (const derivative of derivatives) {
    const existing = derivativesByAsset.get(derivative.asset_id) ?? [];
    existing.push(derivative);
    derivativesByAsset.set(derivative.asset_id, existing);
  }

  const { data: jobRows, error: jobError } = await admin
    .from("media_processing_jobs")
    .select("asset_id,status,failure_code,next_attempt_at,attempts,max_attempts")
    .in("asset_id", allowedIds);
  if (jobError) return NextResponse.json({ error: "Could not load media status" }, { status: 500 });
  const jobsByAsset = new Map((jobRows ?? []).map((job) => [job.asset_id, job]));

  return NextResponse.json({
    assets: assets.map((asset) => ({
      accessClass: asset.access_class,
      assetId: asset.id,
      derivatives: derivativesByAsset.get(asset.id) ?? [],
      failureCode: asset.failure_code ?? jobsByAsset.get(asset.id)?.failure_code ?? null,
      failureReason: asset.failure_code ? safeMediaFailureMessage(asset.failure_code) : null,
      job: jobsByAsset.has(asset.id) ? {
        attempts: jobsByAsset.get(asset.id)?.attempts ?? 0,
        maxAttempts: jobsByAsset.get(asset.id)?.max_attempts ?? 0,
        nextAttemptAt: jobsByAsset.get(asset.id)?.next_attempt_at ?? null,
        status: jobsByAsset.get(asset.id)?.status ?? null
      } : null,
      mediaType: asset.media_type,
      status: asset.status,
      surface: asset.surface
    }))
  });
}
