import { accessClassForPostVisibility, MEDIA_PRIVATE_BUCKET, MEDIA_POST_SIGNED_URL_TTL_SECONDS, type MediaAccessClass, type MediaDerivativeKind } from "@/lib/server/media-pipeline";
import { canViewerAccessPostMedia, postMediaPolicyPair } from "@/lib/server/post-media-policy";
import type { RequestPerformanceTrace } from "@/lib/server/request-performance";

type AdminClient = {
  from: (table: string) => any;
  storage: { from: (bucket: string) => any };
};

type ReviewAccessRow = {
  id: string;
  reviewer_name: string;
  visibility: string | null;
  deleted_at: string | null;
  hidden_at: string | null;
  reported_at: string | null;
  status: string | null;
};

type AssetRow = {
  access_class: MediaAccessClass;
  id: string;
  media_type: "image" | "video";
  owner_name: string;
  privacy_state: string;
  status: string;
  surface: string;
};

type LinkRow = {
  media_asset_id: string | null;
  media_type: "image" | "video" | null;
  position: number | null;
  review_id: string;
};

type DerivativeRow = {
  asset_id: string;
  blurhash: string | null;
  bucket_id: string;
  duration_ms: number | null;
  height: number | null;
  kind: MediaDerivativeKind;
  mime_type: string;
  storage_path: string;
  width: number | null;
};

export type PostMediaDto = {
  accessClass: MediaAccessClass;
  aspectRatio: number | null;
  displayUrl: string;
  durationMs: number | null;
  expiresAt: string;
  height: number | null;
  id: string;
  mediaType: "image" | "video";
  placeholder: string | null;
  posterUrl: string | null;
  position: number;
  thumbnailUrl: string | null;
  width: number | null;
};

function accessClassMatchesReview(asset: AssetRow, review: ReviewAccessRow) {
  try {
    return asset.access_class === accessClassForPostVisibility(review.visibility);
  } catch {
    return false;
  }
}

export async function resolvePostMediaAccess(
  admin: AdminClient,
  assetIdsInput: string[],
  viewerName: string,
  trace?: RequestPerformanceTrace | null
): Promise<PostMediaDto[]> {
  const assetIds = Array.from(new Set(assetIdsInput.map((id) => id.trim()).filter(Boolean))).slice(0, 50);
  if (assetIds.length === 0) return [];

  const assetQuery = () => admin.from("media_assets")
      .select("id, owner_name, surface, media_type, status, access_class, privacy_state")
      .in("id", assetIds);
  const linkQuery = () => admin.from("review_photos")
      .select("media_asset_id, review_id, media_type, position")
      .in("media_asset_id", assetIds);
  const [{ data: assets, error: assetError }, { data: links, error: linkError }] = await Promise.all([
    trace ? trace.database("media.assets", assetQuery) : assetQuery(),
    trace ? trace.database("media.review_links", linkQuery) : linkQuery(),
  ]);
  if (assetError || linkError) throw new Error("post_media_lookup_failed");

  const assetById = new Map(((assets ?? []) as AssetRow[]).map((asset) => [asset.id, asset]));
  const linkByAssetId = new Map<string, LinkRow>();
  const ambiguousAssetIds = new Set<string>();
  for (const link of (links ?? []) as LinkRow[]) {
    if (!link.media_asset_id) continue;
    if (linkByAssetId.has(link.media_asset_id)) ambiguousAssetIds.add(link.media_asset_id);
    else linkByAssetId.set(link.media_asset_id, link);
  }
  const reviewIds = Array.from(new Set(Array.from(linkByAssetId.values()).map((link) => link.review_id)));
  if (reviewIds.length === 0) return [];

  const reviewQuery = () => admin.from("reviews")
    .select("id, reviewer_name, visibility, deleted_at, hidden_at, reported_at, status")
    .in("id", reviewIds);
  const { data: reviews, error: reviewError } = trace
    ? await trace.database("media.review_access", reviewQuery)
    : await reviewQuery();
  if (reviewError) throw new Error("post_media_review_lookup_failed");
  const reviewById = new Map(((reviews ?? []) as ReviewAccessRow[]).map((review) => [review.id, review]));
  const ownerNames = Array.from(new Set(((reviews ?? []) as ReviewAccessRow[]).map((review) => review.reviewer_name).filter(Boolean)));

  const activeProfileQuery = () => admin.from("profiles")
      .select("username")
      .in("username", ownerNames)
      .eq("account_status", "active")
      .is("deletion_started_at", null);
  const { data: activeProfiles, error: profileError } = ownerNames.length > 0
    ? trace
      ? await trace.database("media.active_owners", activeProfileQuery)
      : await activeProfileQuery()
    : { data: [], error: null };
  if (profileError) throw new Error("post_media_owner_status_lookup_failed");
  const activeOwnerNames = new Set((activeProfiles ?? []).map((profile: { username: string }) => profile.username));

  const circleMemberships = new Set<string>();
  const blockedPairs = new Set<string>();
  if (viewerName && ownerNames.length > 0) {
    const membershipQuery = () => admin.from("circle_memberships").select("user_name, member_name").eq("member_name", viewerName).in("user_name", ownerNames);
    const blockQuery = () => admin.from("blocked_users").select("blocker_name, blocked_name")
      .in("blocker_name", Array.from(new Set([...ownerNames, viewerName])))
      .in("blocked_name", Array.from(new Set([...ownerNames, viewerName])));
    const [{ data: memberships, error: membershipError }, { data: blocks, error: blockError }] = await Promise.all([
      trace ? trace.database("media.circle_memberships", membershipQuery) : membershipQuery(),
      trace ? trace.database("media.blocked_users", blockQuery) : blockQuery(),
    ]);
    if (membershipError || blockError) throw new Error("post_media_relationship_lookup_failed");
    for (const row of memberships ?? []) circleMemberships.add(postMediaPolicyPair(row.user_name, row.member_name));
    for (const row of blocks ?? []) blockedPairs.add(postMediaPolicyPair(row.blocker_name, row.blocked_name));
  }

  const allowed: Array<{ asset: AssetRow; link: LinkRow; review: ReviewAccessRow }> = [];
  for (const assetId of assetIds) {
    if (ambiguousAssetIds.has(assetId)) continue;
    const asset = assetById.get(assetId);
    const link = linkByAssetId.get(assetId);
    const review = link ? reviewById.get(link.review_id) : undefined;
    if (!asset || !link || !review) continue;
    if (!activeOwnerNames.has(review.reviewer_name)) continue;
    if (asset.surface !== "post" || asset.status !== "ready" || asset.privacy_state !== "stable" || asset.owner_name !== review.reviewer_name) continue;
    if (!accessClassMatchesReview(asset, review)) continue;
    if (!canViewerAccessPostMedia({ blockedPairs, circleMemberships, review, viewerName })) continue;
    allowed.push({ asset, link, review });
  }
  if (allowed.length === 0) return [];

  const allowedIds = allowed.map(({ asset }) => asset.id);
  const derivativeQuery = () => admin.from("media_derivatives")
    .select("asset_id, kind, bucket_id, storage_path, mime_type, width, height, duration_ms, blurhash")
    .in("asset_id", allowedIds)
    .eq("bucket_id", MEDIA_PRIVATE_BUCKET);
  const { data: derivatives, error: derivativeError } = trace
    ? await trace.database("media.derivatives", derivativeQuery)
    : await derivativeQuery();
  if (derivativeError) throw new Error("post_media_derivative_lookup_failed");

  const derivativeRows = (derivatives ?? []) as DerivativeRow[];
  const paths = Array.from(new Set(derivativeRows.map((row) => row.storage_path).filter(Boolean)));
  const signing = () => admin.storage.from(MEDIA_PRIVATE_BUCKET).createSignedUrls(paths, MEDIA_POST_SIGNED_URL_TTL_SECONDS);
  const { data: signedRows, error: signError } = paths.length > 0
    ? trace
      ? await trace.measure("storage", "media.sign_urls", signing)
      : await signing()
    : { data: [], error: null };
  if (signError) throw new Error("post_media_signing_failed");
  const signedByPath = new Map<string, string>((signedRows ?? []).map((row: { path?: string | null; signedUrl?: string | null }): [string, string] => [row.path ?? "", row.signedUrl ?? ""]));
  const derivativeByAsset = new Map<string, Map<MediaDerivativeKind, DerivativeRow>>();
  for (const row of derivativeRows) {
    const kinds = derivativeByAsset.get(row.asset_id) ?? new Map<MediaDerivativeKind, DerivativeRow>();
    kinds.set(row.kind, row);
    derivativeByAsset.set(row.asset_id, kinds);
  }
  const expiresAt = new Date(Date.now() + MEDIA_POST_SIGNED_URL_TTL_SECONDS * 1000).toISOString();

  return allowed.flatMap(({ asset, link }) => {
    const kinds = derivativeByAsset.get(asset.id);
    const canonical = kinds?.get("canonical");
    if (!canonical) return [];
    const displayUrl = signedByPath.get(canonical.storage_path) ?? "";
    if (!displayUrl) return [];
    const thumbnail = kinds?.get("thumbnail");
    const poster = kinds?.get("poster");
    return [{
      accessClass: asset.access_class,
      aspectRatio: canonical.width && canonical.height ? canonical.width / canonical.height : null,
      displayUrl,
      durationMs: canonical.duration_ms,
      expiresAt,
      height: canonical.height,
      id: asset.id,
      mediaType: asset.media_type,
      placeholder: canonical.blurhash ?? poster?.blurhash ?? null,
      posterUrl: poster ? signedByPath.get(poster.storage_path) || null : null,
      position: link.position ?? 0,
      thumbnailUrl: thumbnail ? signedByPath.get(thumbnail.storage_path) || null : null,
      width: canonical.width
    } satisfies PostMediaDto];
  });
}
