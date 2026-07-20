import type { HomeRefreshReason, HomeRefreshStatus } from "@/home/homeRefreshTransaction";
import type { ReviewPost } from "@/types/models";

export const HOME_UP_TO_DATE_NOTICE_DURATION_MS = 1_800;

export function homeFirstPageVisibleFingerprint(posts: readonly ReviewPost[]) {
  return JSON.stringify(posts.slice(0, 10).map((post) => ({
    area: post.area,
    authorInitials: post.authorInitials,
    authorName: post.authorName,
    authorProfileId: post.authorProfileId ?? null,
    avatarCacheRevision: post.avatarCacheRevision ?? null,
    avatarMediaAssetId: post.avatarMediaAssetId ?? null,
    avatarPlaceholder: post.avatarPlaceholder ?? null,
    body: post.body,
    bookmarkedByMe: post.bookmarkedByMe,
    circleRequestAccountType: post.circleRequestAccountType ?? null,
    circleRequestStatus: post.circleRequestStatus ?? null,
    commentCount: post.commentCount,
    createdAt: post.createdAt,
    foodReaction: post.foodReaction ?? null,
    id: post.id,
    isPublicDiscovery: post.isPublicDiscovery ?? false,
    items: post.items.map((item) => ({ name: item.name, rating: item.rating })),
    likedByMe: post.likedByMe,
    likeCount: post.likeCount,
    media: post.media.map((item) => ({
      cacheRevision: item.cacheRevision ?? null,
      height: item.height,
      identity: item.mediaAssetId ?? (item.expiresAt ? null : item.publicUrl),
      mediaType: item.mediaType,
      placeholder: item.placeholder,
      position: item.position,
      width: item.width
    })),
    mediaCount: post.mediaCount ?? post.media.length,
    mustTryCount: post.mustTryCount ?? 0,
    notWorthItCount: post.notWorthItCount ?? 0,
    restaurantAddress: post.restaurantAddress,
    restaurantId: post.restaurantId,
    restaurantLat: post.restaurantLat,
    restaurantLng: post.restaurantLng,
    restaurantName: post.restaurantName,
    reviewerUsername: post.reviewerUsername,
    status: post.status,
    tags: post.tags,
    updatedAt: post.updatedAt ?? null,
    visibility: post.visibility
  })));
}

export function shouldShowHomeUpToDateNotice(input: {
  previousVisibleFingerprint: string;
  reason: HomeRefreshReason;
  refreshedVisibleFingerprint: string;
  status: HomeRefreshStatus;
}) {
  if (input.status !== "success") return false;
  if (input.reason !== "pull" && input.reason !== "active-tab") return false;
  return input.previousVisibleFingerprint === input.refreshedVisibleFingerprint;
}

type HomeUpToDateNoticeDependencies<TimerHandle> = {
  cancelTimer: (timer: TimerHandle) => void;
  scheduleTimer: (callback: () => void, delayMs: number) => TimerHandle;
  setVisible: (visible: boolean) => void;
};

export function createHomeUpToDateNotice<TimerHandle>(
  dependencies: HomeUpToDateNoticeDependencies<TimerHandle>
) {
  let hideTimer: TimerHandle | null = null;
  let visible = false;

  const clearTimer = () => {
    if (hideTimer === null) return;
    dependencies.cancelTimer(hideTimer);
    hideTimer = null;
  };

  return {
    clear() {
      clearTimer();
      if (!visible) return;
      visible = false;
      dependencies.setVisible(false);
    },
    show() {
      clearTimer();
      if (!visible) {
        visible = true;
        dependencies.setVisible(true);
      }
      hideTimer = dependencies.scheduleTimer(() => {
        hideTimer = null;
        visible = false;
        dependencies.setVisible(false);
      }, HOME_UP_TO_DATE_NOTICE_DURATION_MS);
    }
  };
}
