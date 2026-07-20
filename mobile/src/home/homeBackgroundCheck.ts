export type HomeBackgroundCheckStatus = "failed" | "skipped" | "success";

export type HomeBackgroundCheckResult = {
  feed: HomeBackgroundCheckStatus;
  notifications: HomeBackgroundCheckStatus;
};

type HomeBackgroundCheckDependencies<Context, FeedResult, NotificationResult> = {
  commitFeed: (result: FeedResult, context: Context) => boolean | Promise<boolean>;
  commitNotifications: (result: NotificationResult, context: Context) => boolean | Promise<boolean>;
  fetchFeed: (signal: AbortSignal, context: Context) => Promise<FeedResult>;
  fetchNotifications: (signal: AbortSignal, context: Context) => Promise<NotificationResult>;
  isContextActive: (context: Context) => boolean;
  prepare: () => Context | null;
};

const SKIPPED_RESULT: HomeBackgroundCheckResult = {
  feed: "skipped",
  notifications: "skipped"
};

export function createHomeBackgroundCheck<Context, FeedResult, NotificationResult>(
  dependencies: HomeBackgroundCheckDependencies<Context, FeedResult, NotificationResult>
) {
  let activeController: AbortController | null = null;
  let activePromise: Promise<HomeBackgroundCheckResult> | null = null;
  let requestRevision = 0;

  const check = (options: { includeFeed: boolean; includeNotifications?: boolean }) => {
    if (activePromise) return activePromise;

    const context = dependencies.prepare();
    if (!context) return Promise.resolve(SKIPPED_RESULT);

    const controller = new AbortController();
    const revision = ++requestRevision;
    activeController = controller;
    const isCanceled = () => (
      controller.signal.aborted ||
      revision !== requestRevision ||
      !dependencies.isContextActive(context)
    );

    const transaction = (async (): Promise<HomeBackgroundCheckResult> => {
      const feedPromise = options.includeFeed
        ? (async (): Promise<HomeBackgroundCheckStatus> => {
            try {
              const result = await dependencies.fetchFeed(controller.signal, context);
              if (isCanceled()) return "skipped";
              return await dependencies.commitFeed(result, context) ? "success" : "skipped";
            } catch {
              return isCanceled() ? "skipped" : "failed";
            }
          })()
        : Promise.resolve<HomeBackgroundCheckStatus>("skipped");

      const notificationsPromise = options.includeNotifications === false
        ? Promise.resolve<HomeBackgroundCheckStatus>("skipped")
        : (async (): Promise<HomeBackgroundCheckStatus> => {
            try {
              const result = await dependencies.fetchNotifications(controller.signal, context);
              if (isCanceled()) return "skipped";
              return await dependencies.commitNotifications(result, context) ? "success" : "skipped";
            } catch {
              return isCanceled() ? "skipped" : "failed";
            }
          })();

      const [feed, notifications] = await Promise.all([feedPromise, notificationsPromise]);
      return { feed, notifications };
    })();

    const settledPromise = transaction.finally(() => {
      if (activePromise !== settledPromise) return;
      activeController = null;
      activePromise = null;
    });
    activePromise = settledPromise;
    return settledPromise;
  };

  return {
    cancelActive: () => {
      requestRevision += 1;
      activeController?.abort();
    },
    check,
    isActive: () => activePromise !== null
  };
}
