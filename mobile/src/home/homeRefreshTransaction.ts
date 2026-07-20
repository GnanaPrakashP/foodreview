export type HomeRefreshReason = "pull" | "active-tab" | "stale-return";

export type HomeRefreshStatus = "success" | "failed" | "skipped";

export type HomeRefreshResult = {
  feed: HomeRefreshStatus;
  notifications: HomeRefreshStatus;
};

type HomeRefreshTransactionDependencies<Context, FeedResult, NotificationResult> = {
  cancelConflicts: () => Promise<void>;
  commitFeed: (result: FeedResult, context: Context) => boolean | Promise<boolean>;
  commitNotifications: (result: NotificationResult, context: Context) => boolean | Promise<boolean>;
  fetchFeed: (signal: AbortSignal, context: Context) => Promise<FeedResult>;
  fetchNotifications: (signal: AbortSignal, context: Context) => Promise<NotificationResult>;
  isContextActive: (context: Context) => boolean;
  onActiveChange?: (active: boolean) => void;
  onFeedFailure?: (error: unknown, context: Context) => void;
  prepare: (reason: HomeRefreshReason) => Context | null;
};

export type HomeRefreshTransaction = {
  cancelActive: () => void;
  isActive: () => boolean;
  refreshHome: (reason: HomeRefreshReason) => Promise<HomeRefreshResult>;
};

const SKIPPED_RESULT: HomeRefreshResult = {
  feed: "skipped",
  notifications: "skipped"
};

/**
 * One reusable Home refresh transaction. Feed and unread reads settle and
 * commit independently, while one abort controller and one promise cover the
 * complete operation.
 */
export function createHomeRefreshTransaction<Context, FeedResult, NotificationResult>(
  dependencies: HomeRefreshTransactionDependencies<Context, FeedResult, NotificationResult>
): HomeRefreshTransaction {
  let activeController: AbortController | null = null;
  let activePromise: Promise<HomeRefreshResult> | null = null;

  const isCanceled = (controller: AbortController, context: Context) => (
    controller.signal.aborted || !dependencies.isContextActive(context)
  );

  const refreshHome = (reason: HomeRefreshReason) => {
    if (activePromise) return activePromise;

    const controller = new AbortController();
    activeController = controller;
    dependencies.onActiveChange?.(true);

    const transaction = (async (): Promise<HomeRefreshResult> => {
      const context = dependencies.prepare(reason);
      if (!context) return SKIPPED_RESULT;

      try {
        await dependencies.cancelConflicts();
      } catch {
        // Do not replace page one unless conflicting work is known to be
        // canceled; otherwise a stale pagination result could append later.
        controller.abort();
        return SKIPPED_RESULT;
      }

      if (isCanceled(controller, context)) return SKIPPED_RESULT;

      // Start both requests before awaiting either one. Each branch owns its
      // own failure and commit so neither result blocks the other.
      const feedPromise = (async (): Promise<HomeRefreshStatus> => {
        try {
          const result = await dependencies.fetchFeed(controller.signal, context);
          if (isCanceled(controller, context)) return "skipped";
          return await dependencies.commitFeed(result, context) ? "success" : "skipped";
        } catch (error) {
          if (isCanceled(controller, context)) return "skipped";
          dependencies.onFeedFailure?.(error, context);
          return "failed";
        }
      })();

      const notificationsPromise = (async (): Promise<HomeRefreshStatus> => {
        try {
          const result = await dependencies.fetchNotifications(controller.signal, context);
          if (isCanceled(controller, context)) return "skipped";
          return await dependencies.commitNotifications(result, context) ? "success" : "skipped";
        } catch {
          return isCanceled(controller, context) ? "skipped" : "failed";
        }
      })();

      const [feed, notifications] = await Promise.all([feedPromise, notificationsPromise]);
      return { feed, notifications };
    })();

    const settledPromise = transaction.finally(() => {
      if (activePromise !== settledPromise) return;
      activeController = null;
      activePromise = null;
      dependencies.onActiveChange?.(false);
    });
    activePromise = settledPromise;
    return settledPromise;
  };

  return {
    cancelActive: () => activeController?.abort(),
    isActive: () => activePromise !== null,
    refreshHome
  };
}
