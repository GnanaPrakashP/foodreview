import { Image, type ImageLoadEventData } from "expo-image";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { mediaDerivativeCacheKey } from "@/components/posts/mediaCacheKey";
import { useFixedGeometryRecyclingState } from "@/components/posts/useFixedGeometryRecyclingState";
import { recordHomeMediaProfile } from "@/performance/homeMediaDiagnostics";
import { homeMediaWasDisplayed, markHomeMediaDisplayed } from "@/services/homeMediaReadiness";

type Props = {
  avatarMediaAssetId?: string | null;
  avatarCacheRevision?: number;
  avatarThumbnailUrl?: string | null;
  backgroundColor: string;
  initials: string;
  recyclingEnabled?: boolean;
};

type AvatarImageProps = Pick<
  Props,
  "avatarMediaAssetId" | "avatarCacheRevision" | "avatarThumbnailUrl" | "recyclingEnabled"
>;

const HomeAuthorAvatarImage = memo(function HomeAuthorAvatarImage({
  avatarMediaAssetId,
  avatarCacheRevision = 1,
  avatarThumbnailUrl,
  recyclingEnabled = false
}: AvatarImageProps) {
  const identity = avatarMediaAssetId ?? "missing";
  const cacheKey = mediaDerivativeCacheKey(identity, "thumbnail", avatarCacheRevision);
  const recyclingStateScope = recyclingEnabled ? cacheKey : "home-avatar-instance";
  const [loadedIdentity, setLoadedIdentity] = useFixedGeometryRecyclingState<string | null>(() => (
    homeMediaWasDisplayed(identity, "thumbnail", avatarCacheRevision) ? identity : null
  ), [recyclingStateScope]);
  const [failedIdentity, setFailedIdentity] = useFixedGeometryRecyclingState<string | null>(null, [recyclingStateScope]);
  const renderedSourceRef = useRef({ identity, revision: avatarCacheRevision });
  const source = useMemo(() => avatarMediaAssetId && avatarThumbnailUrl
    ? { cacheKey, uri: avatarThumbnailUrl }
    : null, [avatarMediaAssetId, avatarThumbnailUrl, cacheKey]);

  useEffect(() => {
    const previous = renderedSourceRef.current;
    if (previous.identity === identity && previous.revision === avatarCacheRevision) return;
    renderedSourceRef.current = { identity, revision: avatarCacheRevision };
    if (!recyclingEnabled) {
      setLoadedIdentity(homeMediaWasDisplayed(identity, "thumbnail", avatarCacheRevision) ? identity : null);
      setFailedIdentity(null);
    }
  }, [avatarCacheRevision, identity, recyclingEnabled, setFailedIdentity, setLoadedIdentity]);

  const onLoad = useCallback((event: ImageLoadEventData) => {
    setLoadedIdentity(identity);
    if (avatarMediaAssetId) markHomeMediaDisplayed(avatarMediaAssetId, "thumbnail", event.cacheType, avatarCacheRevision);
    recordHomeMediaProfile("image_cache_type", { cacheType: event.cacheType, derivative: "thumbnail" });
  }, [avatarCacheRevision, avatarMediaAssetId, identity, setLoadedIdentity]);
  const onError = useCallback(() => setFailedIdentity(identity), [identity, setFailedIdentity]);

  const showImage = Boolean(source && failedIdentity !== identity);
  if (!showImage || !source) return null;

  return (
    <Image
      accessibilityIgnoresInvertColors
      alt=""
      cachePolicy="memory-disk"
      contentFit="cover"
      onError={onError}
      onLoad={onLoad}
      recyclingKey={cacheKey}
      source={source}
      style={[styles.image, loadedIdentity === identity ? styles.visible : styles.hidden]}
      transition={0}
    />
  );
});

export const HomeAuthorAvatar = memo(function HomeAuthorAvatar({
  avatarMediaAssetId,
  avatarCacheRevision = 1,
  avatarThumbnailUrl,
  backgroundColor,
  initials,
  recyclingEnabled = false
}: Props) {
  const rootStyle = useMemo(() => [styles.root, { backgroundColor }], [backgroundColor]);
  return (
    <View style={rootStyle}>
      <Text style={styles.initials}>{initials || "?"}</Text>
      <HomeAuthorAvatarImage
        avatarMediaAssetId={avatarMediaAssetId}
        avatarCacheRevision={avatarCacheRevision}
        avatarThumbnailUrl={avatarThumbnailUrl}
        recyclingEnabled={recyclingEnabled}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    borderRadius: 19,
    height: 38,
    justifyContent: "center",
    overflow: "hidden",
    width: 38
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 19
  },
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  initials: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 15,
    textAlign: "center"
  }
});
