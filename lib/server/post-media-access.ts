import {
  accessClassForPostVisibility,
  MEDIA_PRIVATE_BUCKET,
  MEDIA_POST_SIGNED_URL_TTL_SECONDS,
  type MediaAccessClass,
  type MediaDerivativeKind
} from "@/lib/server/media-delivery-contract";
import { canViewerAccessPostMedia, postMediaPolicyPair } from "@/lib/server/post-media-policy";
import type { RequestPerformanceTrace } from "@/lib/server/request-performance";

type AdminClient = {
  from: (table: string) => any;
  rpc: (name: string, args?: Record<string, unknown>) => any;
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

export type HomeMediaDerivative = "feed" | "poster" | "playback";
export type HomeMediaDeliveryKind = "feed" | "canonical" | "poster";

export type HomeMediaCoverDto = {
  cacheRevision: number;
  deliveryDerivative: HomeMediaDeliveryKind;
  expiresAt: string;
  feedUrl: string | null;
  height: number;
  mediaAssetId: string;
  mediaType: "image" | "video";
  placeholder: string | null;
  playbackUrl: null;
  posterUrl: string | null;
  thumbnailExpiresAt: string | null;
  thumbnailUrl: string | null;
  width: number;
};

export type HomeCarouselMediaItemDto = {
  cacheRevision: number;
  deliveryDerivative: HomeMediaDeliveryKind;
  expiresAt: string;
  feedUrl: string | null;
  height: number;
  mediaAssetId: string;
  mediaType: "image" | "video";
  placeholder: string | null;
  position: number;
  posterUrl: string | null;
  width: number;
};

type HomeAuthorizedDerivativeRow = {
  access_class: MediaAccessClass;
  asset_id: string;
  blurhash: string | null;
  bucket_id: string;
  duration_ms: number | null;
  height: number | null;
  kind: MediaDerivativeKind;
  media_type: "image" | "video";
  mime_type: string;
  media_position: number;
  storage_path: string;
  width: number | null;
  content_revision: number | null;
};

export type RenewedHomeMedia = {
  cacheRevision: number;
  derivative: HomeMediaDerivative;
  expiresAt: string;
  mediaAssetId: string;
  url: string;
};

function homeKindsForRequest(derivative?: HomeMediaDerivative, includeCoverThumbnail = false) {
  if (derivative === "poster") return ["poster"];
  if (derivative === "playback") return ["canonical"];
  if (derivative === "feed") return ["feed", "canonical"];
  return includeCoverThumbnail
    ? ["feed", "canonical", "thumbnail", "poster"]
    : ["feed", "canonical", "poster"];
}

function selectHomeDerivative(
  mediaType: "image" | "video",
  kinds: Map<MediaDerivativeKind, HomeAuthorizedDerivativeRow>,
  requested?: HomeMediaDerivative
) {
  if (requested === "playback") return mediaType === "video" ? kinds.get("canonical") ?? null : null;
  if (requested === "poster") return mediaType === "video" ? kinds.get("poster") ?? null : null;
  if (requested === "feed") return mediaType === "image" ? kinds.get("feed") ?? kinds.get("canonical") ?? null : kinds.get("poster") ?? null;
  return mediaType === "image" ? kinds.get("feed") ?? kinds.get("canonical") ?? null : kinds.get("poster") ?? null;
}

/**
 * Home uses one database authorization statement for the whole page (or one
 * asset renewal), then one batched signing operation. The SQL function owns
 * every visibility and relationship check; storage paths never come from the
 * client or from the feed projection.
 */
export async function resolveHomeMediaAccess(
  admin: AdminClient,
  assetIdsInput: string[],
  viewerUserId: string,
  trace?: RequestPerformanceTrace | null,
  requestedDerivative?: HomeMediaDerivative,
  options: { includeCoverThumbnail?: boolean } = {}
): Promise<HomeMediaCoverDto[] | RenewedHomeMedia[]> {
  const assetIds = Array.from(new Set(assetIdsInput.map((id) => id.trim()).filter(Boolean))).slice(0, 50);
  if (assetIds.length === 0 || !viewerUserId) return [];
  const query = () => admin.rpc("authorized_home_media_derivatives_v1", {
    p_asset_ids: assetIds,
    p_derivative_kinds: homeKindsForRequest(requestedDerivative, options.includeCoverThumbnail === true),
    p_viewer_user_id: viewerUserId
  });
  const { data, error } = trace
    ? await trace.database("media.authorized_home_derivatives", query)
    : await query();
  if (error) throw new Error("home_media_authorization_failed");

  const rows = (data ?? []) as HomeAuthorizedDerivativeRow[];
  const grouped = new Map<string, { mediaType: "image" | "video"; kinds: Map<MediaDerivativeKind, HomeAuthorizedDerivativeRow> }>();
  for (const row of rows) {
    if (row.bucket_id !== MEDIA_PRIVATE_BUCKET) continue;
    const group = grouped.get(row.asset_id) ?? { mediaType: row.media_type, kinds: new Map() };
    group.kinds.set(row.kind, row);
    grouped.set(row.asset_id, group);
  }

  const selected = assetIds.flatMap((assetId) => {
    const group = grouped.get(assetId);
    if (!group) return [];
    const derivative = selectHomeDerivative(group.mediaType, group.kinds, requestedDerivative);
    const thumbnail = options.includeCoverThumbnail === true && group.mediaType === "image"
      ? group.kinds.get("thumbnail") ?? null
      : null;
    return derivative ? [{ assetId, derivative, mediaType: group.mediaType, thumbnail }] : [];
  });
  const canonicalFallbackCount = selected.filter(({ derivative, mediaType }) => (
    mediaType === "image" && derivative.kind === "canonical"
  )).length;
  if (canonicalFallbackCount > 0) {
    console.warn("[home-media] ready image used canonical fallback", { count: canonicalFallbackCount });
  }
  const paths = Array.from(new Set(selected.flatMap(({ derivative, thumbnail }) => [
    derivative.storage_path,
    ...(thumbnail ? [thumbnail.storage_path] : [])
  ])));
  const signing = () => admin.storage.from(MEDIA_PRIVATE_BUCKET).createSignedUrls(paths, MEDIA_POST_SIGNED_URL_TTL_SECONDS);
  const { data: signedRows, error: signError } = paths.length > 0
    ? trace
      ? await trace.measure("storage", "media.sign_home_urls", signing)
      : await signing()
    : { data: [], error: null };
  if (signError) throw new Error("home_media_signing_failed");
  const signedByPath = new Map<string, string>((signedRows ?? []).map(
    (row: { path?: string | null; signedUrl?: string | null }): [string, string] => [row.path ?? "", row.signedUrl ?? ""]
  ));
  const expiresAt = new Date(Date.now() + MEDIA_POST_SIGNED_URL_TTL_SECONDS * 1000).toISOString();

  if (requestedDerivative) {
    return selected.flatMap(({ assetId, derivative }) => {
      const url = signedByPath.get(derivative.storage_path) ?? "";
      return url ? [{
        cacheRevision: Math.max(1, derivative.content_revision ?? 1),
        derivative: requestedDerivative,
        expiresAt,
        mediaAssetId: assetId,
        url
      }] : [];
    });
  }

  return selected.flatMap(({ assetId, derivative, mediaType, thumbnail }) => {
    const url = signedByPath.get(derivative.storage_path) ?? "";
    if (!url) return [];
    return [{
      cacheRevision: Math.max(1, derivative.content_revision ?? 1),
      deliveryDerivative: derivative.kind === "poster" ? "poster" : derivative.kind === "canonical" ? "canonical" : "feed",
      expiresAt,
      feedUrl: mediaType === "image" ? url : null,
      height: derivative.height ?? 900,
      mediaAssetId: assetId,
      mediaType,
      placeholder: derivative.blurhash ?? null,
      playbackUrl: null,
      posterUrl: mediaType === "video" ? url : null,
      thumbnailExpiresAt: thumbnail ? expiresAt : null,
      thumbnailUrl: thumbnail ? signedByPath.get(thumbnail.storage_path) || null : null,
      width: derivative.width ?? 720
    } satisfies HomeMediaCoverDto];
  });
}

export async function resolveHomeCarouselMediaAccess(
  admin: AdminClient,
  postId: string,
  viewerUserId: string,
  trace?: RequestPerformanceTrace | null
): Promise<HomeCarouselMediaItemDto[]> {
  const linksQuery = () => admin
    .from("review_photos")
    .select("id, media_asset_id, position")
    .eq("review_id", postId)
    .not("media_asset_id", "is", null)
    .order("position", { ascending: true })
    .order("id", { ascending: true })
    .limit(10);
  const { data, error } = trace
    ? await trace.database("media.home_carousel_links", linksQuery)
    : await linksQuery();
  if (error) throw new Error("home_carousel_lookup_failed");

  const links = (data ?? []) as Array<{ id: string; media_asset_id: string | null; position: number | null }>;
  const assetIds = links.flatMap((link) => link.media_asset_id ? [link.media_asset_id] : []);
  const authorised = await resolveHomeMediaAccess(admin, assetIds, viewerUserId, trace) as HomeMediaCoverDto[];
  const byAssetId = new Map(authorised.map((item) => [item.mediaAssetId, item]));

  return links.flatMap((link) => {
    if (!link.media_asset_id) return [];
    const item = byAssetId.get(link.media_asset_id);
    if (!item) return [];
    return [{
      cacheRevision: item.cacheRevision,
      deliveryDerivative: item.deliveryDerivative,
      expiresAt: item.expiresAt,
      feedUrl: item.feedUrl,
      height: item.height,
      mediaAssetId: item.mediaAssetId,
      mediaType: item.mediaType,
      placeholder: item.placeholder,
      position: link.position ?? 0,
      posterUrl: item.posterUrl,
      width: item.width
    } satisfies HomeCarouselMediaItemDto];
  });
}

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
  trace?: RequestPerformanceTrace | null,
  options: { deliveryMode?: "cover" | "full" } = {}
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
  const derivativeByAsset = new Map<string, Map<MediaDerivativeKind, DerivativeRow>>();
  for (const row of derivativeRows) {
    const kinds = derivativeByAsset.get(row.asset_id) ?? new Map<MediaDerivativeKind, DerivativeRow>();
    kinds.set(row.kind, row);
    derivativeByAsset.set(row.asset_id, kinds);
  }
  const paths = Array.from(new Set(allowed.flatMap(({ asset }) => {
    const kinds = derivativeByAsset.get(asset.id);
    if (options.deliveryMode !== "cover") {
      return Array.from(kinds?.values() ?? []).map((row) => row.storage_path);
    }
    const canonical = kinds?.get("canonical");
    if (asset.media_type === "video") {
      return [canonical?.storage_path, kinds?.get("poster")?.storage_path]
        .filter((path): path is string => Boolean(path));
    }
    return [kinds?.get("thumbnail")?.storage_path ?? canonical?.storage_path]
      .filter((path): path is string => Boolean(path));
  }).filter(Boolean)));
  const signing = () => admin.storage.from(MEDIA_PRIVATE_BUCKET).createSignedUrls(paths, MEDIA_POST_SIGNED_URL_TTL_SECONDS);
  const { data: signedRows, error: signError } = paths.length > 0
    ? trace
      ? await trace.measure("storage", "media.sign_urls", signing)
      : await signing()
    : { data: [], error: null };
  if (signError) throw new Error("post_media_signing_failed");
  const signedByPath = new Map<string, string>((signedRows ?? []).map((row: { path?: string | null; signedUrl?: string | null }): [string, string] => [row.path ?? "", row.signedUrl ?? ""]));
  const expiresAt = new Date(Date.now() + MEDIA_POST_SIGNED_URL_TTL_SECONDS * 1000).toISOString();

  return allowed.flatMap(({ asset, link }) => {
    const kinds = derivativeByAsset.get(asset.id);
    const canonical = kinds?.get("canonical");
    if (!canonical) return [];
    const thumbnail = kinds?.get("thumbnail");
    const poster = kinds?.get("poster");
    const imageDelivery = options.deliveryMode === "cover" && asset.media_type === "image"
      ? thumbnail ?? canonical
      : canonical;
    const dimensionDerivative = options.deliveryMode === "cover" && asset.media_type === "video"
      ? poster ?? canonical
      : imageDelivery;
    const displayUrl = signedByPath.get(imageDelivery.storage_path) ?? "";
    if (!displayUrl) return [];
    return [{
      accessClass: asset.access_class,
      aspectRatio: dimensionDerivative.width && dimensionDerivative.height ? dimensionDerivative.width / dimensionDerivative.height : null,
      displayUrl,
      durationMs: canonical.duration_ms,
      expiresAt,
      height: dimensionDerivative.height,
      id: asset.id,
      mediaType: asset.media_type,
      placeholder: options.deliveryMode === "cover"
        ? dimensionDerivative.blurhash ?? null
        : canonical.blurhash ?? poster?.blurhash ?? null,
      posterUrl: poster ? signedByPath.get(poster.storage_path) || null : null,
      position: link.position ?? 0,
      thumbnailUrl: thumbnail ? signedByPath.get(thumbnail.storage_path) || null : null,
      width: dimensionDerivative.width
    } satisfies PostMediaDto];
  });
}
