import type { HomeRefreshReason, HomeRefreshStatus } from "@/home/homeRefreshTransaction";

export const HOME_UP_TO_DATE_NOTICE_DURATION_MS = 1_800;

export function hasLeadingHomeNewPostIds(
  previousFirstPageIds: readonly string[],
  refreshedFirstPageIds: readonly string[]
) {
  const previousIds = new Set(previousFirstPageIds);
  const seenRefreshedIds = new Set<string>();

  for (const postId of refreshedFirstPageIds) {
    if (seenRefreshedIds.has(postId)) continue;
    seenRefreshedIds.add(postId);
    return !previousIds.has(postId);
  }

  return false;
}

export function shouldShowHomeUpToDateNotice(input: {
  previousFirstPageIds: readonly string[];
  reason: HomeRefreshReason;
  refreshedFirstPageIds: readonly string[];
  status: HomeRefreshStatus;
}) {
  if (input.status !== "success") return false;
  if (input.reason !== "pull" && input.reason !== "active-tab") return false;
  return !hasLeadingHomeNewPostIds(input.previousFirstPageIds, input.refreshedFirstPageIds);
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
