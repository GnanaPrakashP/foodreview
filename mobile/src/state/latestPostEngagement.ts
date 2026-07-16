export type LatestIntentDisplaySource = "optimistic" | "rebase" | "rollback" | "stable";

type LatestIntentExecution<Intent, Result> = {
  from: Result;
  revision: number;
  to: Intent;
};

type LatestIntentDisplayMeta = {
  revision: number;
  source: LatestIntentDisplaySource;
};

type LatestIntentQueueOptions<Intent, Result> = {
  equals?: (first: Intent, second: Intent) => boolean;
  execute: (execution: LatestIntentExecution<Intent, Result>) => Promise<Result>;
  getIntent: (result: Result) => Intent;
  initialResult: Result;
  onDisplay: (result: Result, meta: LatestIntentDisplayMeta) => void;
  onError?: (error: unknown, rolledBackTo: Result) => void;
  optimisticResult: (current: Result, desired: Intent) => Result;
};

/**
 * Keeps one mutation in flight and continually reconciles the server toward the
 * most recent local intent. Intermediate responses become the next request's
 * server baseline, but never replace a newer optimistic display state.
 */
export class LatestIntentQueue<Intent, Result> {
  private desiredIntent: Intent;
  private displayedResult: Result;
  private drainPromise: Promise<void> | null = null;
  private readonly equals: (first: Intent, second: Intent) => boolean;
  private serverStateUncertain = false;
  private revision = 0;
  private syncedResult: Result;

  constructor(private readonly options: LatestIntentQueueOptions<Intent, Result>) {
    this.displayedResult = options.initialResult;
    this.syncedResult = options.initialResult;
    this.desiredIntent = options.getIntent(options.initialResult);
    this.equals = options.equals ?? Object.is;
  }

  getDesiredIntent() {
    return this.desiredIntent;
  }

  getDisplayedResult() {
    return this.displayedResult;
  }

  getSyncedResult() {
    return this.syncedResult;
  }

  isPending() {
    return this.drainPromise !== null || this.serverStateUncertain || !this.equals(this.desiredIntent, this.options.getIntent(this.syncedResult));
  }

  /** Rebase only when no local intent is pending, so cache echoes cannot clobber taps. */
  rebase(result: Result) {
    if (this.isPending()) return false;
    this.revision += 1;
    this.syncedResult = result;
    this.displayedResult = result;
    this.desiredIntent = this.options.getIntent(result);
    this.options.onDisplay(result, { revision: this.revision, source: "rebase" });
    return true;
  }

  setDesiredIntent(intent: Intent) {
    this.revision += 1;
    this.desiredIntent = intent;
    this.displayedResult = this.options.optimisticResult(this.displayedResult, intent);
    this.options.onDisplay(this.displayedResult, { revision: this.revision, source: "optimistic" });
    this.ensureDrain();
  }

  async waitForIdle() {
    while (this.drainPromise) await this.drainPromise;
  }

  private ensureDrain() {
    if (this.drainPromise) return;
    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = null;
      if (this.serverStateUncertain || !this.equals(this.desiredIntent, this.options.getIntent(this.syncedResult))) this.ensureDrain();
    });
  }

  private async drain() {
    while (this.serverStateUncertain || !this.equals(this.desiredIntent, this.options.getIntent(this.syncedResult))) {
      const from = this.syncedResult;
      const fromIntent = this.options.getIntent(from);
      const targetIntent = this.desiredIntent;
      const requestRevision = this.revision;

      try {
        const result = await this.options.execute({ from, revision: requestRevision, to: targetIntent });
        const resultIntent = this.options.getIntent(result);
        this.serverStateUncertain = false;
        this.syncedResult = result;

        if (this.equals(this.desiredIntent, resultIntent)) {
          this.displayedResult = result;
          this.options.onDisplay(result, { revision: this.revision, source: "stable" });
          continue;
        }

        // A successful response that did not move the server cannot be retried
        // forever. Roll back only if it still represents the latest intent.
        if (
          requestRevision === this.revision &&
          this.equals(this.desiredIntent, targetIntent) &&
          this.equals(fromIntent, resultIntent)
        ) {
          this.desiredIntent = resultIntent;
          this.displayedResult = result;
          this.options.onDisplay(result, { revision: this.revision, source: "rollback" });
          this.options.onError?.(new Error("The server did not apply the requested state."), result);
        }
      } catch (error) {
        const requestIsStillCurrent = requestRevision === this.revision && this.equals(this.desiredIntent, targetIntent);
        if (!requestIsStillCurrent) {
          // A timeout or transport failure can happen after the server committed.
          // Force one explicit write of the newest intent before declaring idle.
          this.serverStateUncertain = true;
          continue;
        }

        this.serverStateUncertain = false;
        this.desiredIntent = fromIntent;
        this.displayedResult = from;
        this.options.onDisplay(from, { revision: this.revision, source: "rollback" });
        this.options.onError?.(error, from);
      }
    }
  }
}

export type LikeIntentState = {
  likeCount: number;
  likedByMe: boolean;
  postId: string;
};

export function optimisticLikeIntentState<T extends LikeIntentState>(current: T, likedByMe: boolean): T {
  if (current.likedByMe === likedByMe) return current;
  return {
    ...current,
    likedByMe,
    likeCount: Math.max(0, current.likeCount + (likedByMe ? 1 : -1))
  };
}

export type BookmarkIntentState = {
  bookmarkedByMe: boolean;
  postId: string;
};

export function optimisticBookmarkIntentState<T extends BookmarkIntentState>(current: T, bookmarkedByMe: boolean): T {
  return current.bookmarkedByMe === bookmarkedByMe ? current : { ...current, bookmarkedByMe };
}

export type ReactionIntentLabel = "Disagree" | "Helpful";

export type ReactionIntentState = {
  myFeedbackLabel: ReactionIntentLabel | null;
  summary: {
    feedback_counts: Record<ReactionIntentLabel, number>;
  };
};

export function optimisticReactionIntentState<T extends ReactionIntentState>(
  current: T,
  nextLabel: ReactionIntentLabel | null
): T {
  const previousLabel = current.myFeedbackLabel;
  if (previousLabel === nextLabel) return current;
  const feedbackCounts = { ...current.summary.feedback_counts };

  if (previousLabel) feedbackCounts[previousLabel] = Math.max(0, feedbackCounts[previousLabel] - 1);
  if (nextLabel) feedbackCounts[nextLabel] += 1;

  return {
    ...current,
    summary: {
      ...current.summary,
      feedback_counts: feedbackCounts
    },
    myFeedbackLabel: nextLabel
  };
}
