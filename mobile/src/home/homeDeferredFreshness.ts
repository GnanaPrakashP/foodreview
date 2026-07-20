export type HomeDeferredFreshnessContext = {
  generation: number;
  ownerScope: string;
  structuralRevision: number;
};

export type HomeDeferredFreshnessNotificationStatus =
  | "not-requested"
  | "pending"
  | "failed"
  | "success";

export type HomeDeferredFreshnessIntent = HomeDeferredFreshnessContext & {
  id: number;
  notificationStatus: HomeDeferredFreshnessNotificationStatus;
};

export type HomeDeferredFreshnessEligibility = {
  hasUsableContent: boolean;
  isAutomaticCheckActive: boolean;
  isExplicitRefreshActive: boolean;
  isFeedRequestPending: boolean;
  isFocused: boolean;
  isForeground: boolean;
  isFresh: boolean;
  isOnline: boolean;
  isPaginationActive: boolean;
};

export function canRunHomeDeferredFreshness(input: HomeDeferredFreshnessEligibility) {
  return input.hasUsableContent &&
    input.isFocused &&
    input.isForeground &&
    input.isOnline &&
    !input.isFresh &&
    !input.isPaginationActive &&
    !input.isFeedRequestPending &&
    !input.isExplicitRefreshActive &&
    !input.isAutomaticCheckActive;
}

function sameContext(
  intent: HomeDeferredFreshnessIntent,
  context: HomeDeferredFreshnessContext
) {
  return intent.generation === context.generation &&
    intent.ownerScope === context.ownerScope &&
    intent.structuralRevision === context.structuralRevision;
}

/**
 * Memory-only intent state for one page-one check skipped by active Home
 * pagination. The caller owns eligibility checks; this coordinator owns
 * context replacement, notification deduplication and atomic claiming.
 */
export function createHomeDeferredFreshnessState() {
  let intent: HomeDeferredFreshnessIntent | null = null;
  let nextId = 0;

  return {
    claim() {
      const claimed = intent;
      intent = null;
      return claimed;
    },
    clear() {
      intent = null;
    },
    defer(context: HomeDeferredFreshnessContext) {
      if (intent && sameContext(intent, context)) return intent;
      intent = {
        ...context,
        id: ++nextId,
        notificationStatus: "not-requested"
      };
      return intent;
    },
    isCurrentContext(context: HomeDeferredFreshnessContext) {
      return Boolean(intent && sameContext(intent, context));
    },
    read() {
      return intent;
    },
    setNotificationStatus(
      target: HomeDeferredFreshnessIntent,
      notificationStatus: HomeDeferredFreshnessNotificationStatus
    ) {
      if (!intent || intent.id !== target.id) return false;
      intent = { ...intent, notificationStatus };
      return true;
    }
  };
}
