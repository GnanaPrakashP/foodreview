import type { HomeRefreshReason } from "@/home/homeRefreshTransaction";

export const HOME_ACTIVE_TAB_REFRESH_MIN_VISIBLE_MS = 300;

type HomeActiveTabRefreshFeedbackDependencies<TimerHandle> = {
  cancelTimer: (timer: TimerHandle) => void;
  now: () => number;
  scheduleTimer: (callback: () => void, delayMs: number) => TimerHandle;
  setVisible: (visible: boolean) => void;
};

/**
 * Visual state driven by the canonical Home refresh transaction. The timer
 * only holds a completed fast refresh on screen long enough to be perceived.
 */
export function createHomeActiveTabRefreshFeedback<TimerHandle>(
  dependencies: HomeActiveTabRefreshFeedbackDependencies<TimerHandle>
) {
  let hideTimer: TimerHandle | null = null;
  let startedAt: number | null = null;

  const cancelPendingHide = () => {
    if (hideTimer === null) return;
    dependencies.cancelTimer(hideTimer);
    hideTimer = null;
  };

  const hide = () => {
    hideTimer = null;
    dependencies.setVisible(false);
  };

  return {
    onTransactionActiveChange(active: boolean, reason: HomeRefreshReason | null) {
      if (active) {
        if (reason !== "active-tab") {
          cancelPendingHide();
          if (reason !== "pull") dependencies.setVisible(false);
          return;
        }
        if (startedAt !== null) return;
        cancelPendingHide();
        startedAt = dependencies.now();
        dependencies.setVisible(true);
        return;
      }

      if (startedAt === null) return;
      const remainingMs = Math.max(
        0,
        HOME_ACTIVE_TAB_REFRESH_MIN_VISIBLE_MS - (dependencies.now() - startedAt)
      );
      startedAt = null;
      if (remainingMs === 0) {
        hide();
        return;
      }
      hideTimer = dependencies.scheduleTimer(hide, remainingMs);
    },
    reset() {
      cancelPendingHide();
      startedAt = null;
      dependencies.setVisible(false);
    }
  };
}
