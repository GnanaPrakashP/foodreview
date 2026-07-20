import { type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { feedKeys, findCachedPostById, mergeUniqueFeedPosts } from "@/hooks/useFeeds";
import {
  captureHomeEngagementRevisions,
  reconcileHomeRefreshPost,
  type HomeEngagementRevisionSnapshot
} from "@/home/homeEngagementReconciliation";
import { createHomeBackgroundCheck } from "@/home/homeBackgroundCheck";
import {
  canRunHomeDeferredFreshness,
  createHomeDeferredFreshnessState,
  type HomeDeferredFreshnessContext
} from "@/home/homeDeferredFreshness";
import {
  detectLeadingHomeNewPosts,
  homeFirstPageIds,
  resolveHomeFreshnessAction,
  sameHomePostIds
} from "@/home/homeFreshness";
import { buildHomeFirstPageReplacement } from "@/home/homeRefreshCache";
import { createHomeActiveTabRefreshFeedback } from "@/home/homeActiveTabRefreshFeedback";
import {
  createHomeUpToDateNotice,
  homeFirstPageVisibleFingerprint,
  shouldShowHomeUpToDateNotice
} from "@/home/homeExplicitRefreshNotice";
import {
  isHomePageOneFresh,
  readHomePageOneRefreshAt,
  recordHomePageOneRefreshAt
} from "@/home/homeRefreshMetadata";
import {
  createHomeRefreshTransaction,
  type HomeRefreshReason
} from "@/home/homeRefreshTransaction";
import { readHomeStructuralRevision } from "@/home/homeStructuralRevision";
import { notificationKeys } from "@/hooks/useNotifications";
import { getActiveCacheGeneration, getActiveCacheOwner, isCacheGenerationActive } from "@/security/cacheOwnership";
import { getCircleFeed } from "@/services/feeds";
import { getNotificationHasUnread } from "@/services/notifications";
import type { FeedPage } from "@/types/models";

type HomeRequestContext = {
  engagementSnapshot: HomeEngagementRevisionSnapshot;
  generation: number;
  ownerScope: string;
  structuralRevision: number;
};

type HomeRefreshContext = HomeRequestContext & {
  baseFirstPageIds: string[];
  baseVisibleFingerprint: string;
  reason: HomeRefreshReason;
};

type HomeBackgroundContext = HomeRequestContext & {
  baseFirstPageIds: string[];
};

type PendingHomeFirstPage = HomeBackgroundContext & {
  newPostCount: number;
  page: FeedPage;
};

type ExplicitRefreshComparison = Pick<
  HomeRefreshContext,
  "baseVisibleFingerprint" | "reason"
> & {
  refreshedVisibleFingerprint: string;
};

export type HomeFreshnessEvaluationInput = {
  hasUsableContent: boolean;
  isAtTop: boolean;
  isFeedRequestPending: boolean;
  isOnline: boolean;
  isPaginationActive: boolean;
};

export type HomeDeferredFreshnessEvaluationInput = HomeFreshnessEvaluationInput & {
  isFocused: boolean;
  isForeground: boolean;
};

type UseHomeRefreshOptions = {
  ownerIdentity: string | null;
  resetPaginationClaims: () => void;
  scrollToTop: () => void;
};

export function useHomeRefresh({ ownerIdentity, resetPaginationClaims, scrollToTop }: UseHomeRefreshOptions) {
  const queryClient = useQueryClient();
  const resetPaginationClaimsRef = useRef(resetPaginationClaims);
  const scrollToTopRef = useRef(scrollToTop);
  resetPaginationClaimsRef.current = resetPaginationClaims;
  scrollToTopRef.current = scrollToTop;
  const mountedRef = useRef(true);
  const applyingPendingRef = useRef(false);
  const activeReasonRef = useRef<HomeRefreshReason | null>(null);
  const explicitRefreshComparisonRef = useRef<ExplicitRefreshComparison | null>(null);
  const pendingRef = useRef<PendingHomeFirstPage | null>(null);
  const deferredFreshnessStateRef = useRef<ReturnType<typeof createHomeDeferredFreshnessState> | null>(null);
  const latestDeferredEvaluationRef = useRef<HomeDeferredFreshnessEvaluationInput | null>(null);
  if (!deferredFreshnessStateRef.current) {
    deferredFreshnessStateRef.current = createHomeDeferredFreshnessState();
  }
  const [pendingFreshFirstPage, setPendingFreshFirstPage] = useState<PendingHomeFirstPage | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const activeTabRefreshFeedbackRef = useRef<ReturnType<typeof createHomeActiveTabRefreshFeedback> | null>(null);
  if (!activeTabRefreshFeedbackRef.current) {
    activeTabRefreshFeedbackRef.current = createHomeActiveTabRefreshFeedback({
      cancelTimer: clearTimeout,
      now: Date.now,
      scheduleTimer: setTimeout,
      setVisible: (visible) => {
        if (mountedRef.current) setIsRefreshing(visible);
      }
    });
  }
  const [isUpToDateNoticeVisible, setIsUpToDateNoticeVisible] = useState(false);
  const upToDateNoticeRef = useRef<ReturnType<typeof createHomeUpToDateNotice> | null>(null);
  if (!upToDateNoticeRef.current) {
    upToDateNoticeRef.current = createHomeUpToDateNotice({
      cancelTimer: clearTimeout,
      scheduleTimer: setTimeout,
      setVisible: (visible) => {
        if (mountedRef.current) setIsUpToDateNoticeVisible(visible);
      }
    });
  }
  const transactionRef = useRef<ReturnType<typeof createHomeRefreshTransaction<HomeRefreshContext, FeedPage, boolean>> | null>(null);
  const backgroundCheckRef = useRef<ReturnType<typeof createHomeBackgroundCheck<HomeBackgroundContext, FeedPage, boolean>> | null>(null);

  const clearPendingHomePage = useCallback(() => {
    pendingRef.current = null;
    if (mountedRef.current) setPendingFreshFirstPage(null);
  }, []);

  const clearDeferredHomeFreshness = useCallback(() => {
    deferredFreshnessStateRef.current?.clear();
  }, []);

  if (!transactionRef.current) {
    transactionRef.current = createHomeRefreshTransaction<HomeRefreshContext, FeedPage, boolean>({
      cancelConflicts: async () => {
        await Promise.all([
          queryClient.cancelQueries({ exact: true, queryKey: feedKeys.circlePages }),
          queryClient.cancelQueries({ exact: true, queryKey: notificationKeys.hasUnread })
        ]);
      },
      commitFeed: (freshPage, context) => {
        if (!isContextActive(context)) return false;
        if (readHomeStructuralRevision(queryClient) !== context.structuralRevision) return false;
        const replacement = buildHomeFirstPageReplacement(freshPage, (post) => (
          reconcileHomeRefreshPost(
            queryClient,
            post,
            findCachedPostById(queryClient, post.id),
            context.engagementSnapshot
          )
        ));
        queryClient.setQueryData<InfiniteData<FeedPage>>(feedKeys.circlePages, replacement);
        recordHomePageOneRefreshAt(queryClient, context.ownerScope);
        if (context.reason === "pull" || context.reason === "active-tab") {
          explicitRefreshComparisonRef.current = {
            baseVisibleFingerprint: context.baseVisibleFingerprint,
            reason: context.reason,
            refreshedVisibleFingerprint: homeFirstPageVisibleFingerprint(replacement.pages[0]?.posts ?? [])
          };
        }
        clearDeferredHomeFreshness();
        resetPaginationClaimsRef.current();
        clearPendingHomePage();
        return true;
      },
      commitNotifications: (hasUnread, context) => {
        if (!isContextActive(context)) return false;
        queryClient.setQueryData(notificationKeys.hasUnread, hasUnread);
        return true;
      },
      fetchFeed: (signal) => getCircleFeed(null, { refresh: true, signal }),
      fetchNotifications: (signal) => getNotificationHasUnread({ signal }),
      isContextActive,
      onActiveChange: (active) => {
        const activeReason = activeReasonRef.current;
        if (active) resetPaginationClaimsRef.current();
        if (mountedRef.current && activeReason === "pull") setIsRefreshing(active);
        activeTabRefreshFeedbackRef.current?.onTransactionActiveChange(active, activeReason);
        if (!active) activeReasonRef.current = null;
      },
      prepare: (reason) => {
        const owner = getActiveCacheOwner();
        if (!owner) return null;
        const current = queryClient.getQueryData<InfiniteData<FeedPage>>(feedKeys.circlePages);
        return {
          baseFirstPageIds: homeFirstPageIds(current?.pages[0]),
          baseVisibleFingerprint: homeFirstPageVisibleFingerprint(current?.pages[0]?.posts ?? []),
          engagementSnapshot: captureHomeEngagementRevisions(queryClient),
          generation: getActiveCacheGeneration(),
          ownerScope: owner.scope,
          reason,
          structuralRevision: readHomeStructuralRevision(queryClient)
        };
      }
    });
  }

  if (!backgroundCheckRef.current) {
    backgroundCheckRef.current = createHomeBackgroundCheck<HomeBackgroundContext, FeedPage, boolean>({
      commitFeed: (freshPage, context) => {
        if (!isContextActive(context)) return false;
        // A successful network page one is fresh even when it is staged or
        // proves there are no new leading IDs.
        recordHomePageOneRefreshAt(queryClient, context.ownerScope);
        clearDeferredHomeFreshness();
        if (readHomeStructuralRevision(queryClient) !== context.structuralRevision) {
          clearPendingHomePage();
          return true;
        }
        const current = queryClient.getQueryData<InfiniteData<FeedPage>>(feedKeys.circlePages);
        const currentFirstPageIds = homeFirstPageIds(current?.pages[0]);
        if (!sameHomePostIds(currentFirstPageIds, context.baseFirstPageIds)) {
          clearPendingHomePage();
          return true;
        }
        const currentPosts = mergeUniqueFeedPosts(current?.pages);
        const leadingNewPosts = detectLeadingHomeNewPosts(freshPage, currentPosts);
        if (leadingNewPosts.length === 0) {
          clearPendingHomePage();
          return true;
        }
        const pending: PendingHomeFirstPage = {
          ...context,
          newPostCount: leadingNewPosts.length,
          page: freshPage
        };
        pendingRef.current = pending;
        if (mountedRef.current) setPendingFreshFirstPage(pending);
        return true;
      },
      commitNotifications: (hasUnread, context) => {
        if (!isContextActive(context)) return false;
        queryClient.setQueryData(notificationKeys.hasUnread, hasUnread);
        return true;
      },
      fetchFeed: (signal) => getCircleFeed(null, { refresh: true, signal }),
      fetchNotifications: (signal) => getNotificationHasUnread({ signal }),
      isContextActive,
      prepare: () => {
        const owner = getActiveCacheOwner();
        const current = queryClient.getQueryData<InfiniteData<FeedPage>>(feedKeys.circlePages);
        if (!owner || !current?.pages[0]) return null;
        return {
          baseFirstPageIds: homeFirstPageIds(current.pages[0]),
          engagementSnapshot: captureHomeEngagementRevisions(queryClient),
          generation: getActiveCacheGeneration(),
          ownerScope: owner.scope,
          structuralRevision: readHomeStructuralRevision(queryClient)
        };
      }
    });
  }

  useEffect(() => {
    backgroundCheckRef.current?.cancelActive();
    activeTabRefreshFeedbackRef.current?.reset();
    upToDateNoticeRef.current?.clear();
    explicitRefreshComparisonRef.current = null;
    clearDeferredHomeFreshness();
    clearPendingHomePage();
  }, [clearDeferredHomeFreshness, clearPendingHomePage, ownerIdentity]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeTabRefreshFeedbackRef.current?.reset();
      upToDateNoticeRef.current?.clear();
      clearDeferredHomeFreshness();
      transactionRef.current?.cancelActive();
      backgroundCheckRef.current?.cancelActive();
    };
  }, [clearDeferredHomeFreshness]);

  const refreshHome = useCallback((reason: HomeRefreshReason) => {
    clearDeferredHomeFreshness();
    const transaction = transactionRef.current!;
    if (transaction.isActive()) return transaction.refreshHome(reason);
    const isExplicitRefresh = reason === "pull" || reason === "active-tab";
    if (isExplicitRefresh) {
      upToDateNoticeRef.current?.clear();
      explicitRefreshComparisonRef.current = null;
    }
    activeReasonRef.current = reason;
    backgroundCheckRef.current?.cancelActive();
    clearPendingHomePage();
    const refreshPromise = transaction.refreshHome(reason);
    if (isExplicitRefresh) {
      void refreshPromise.then((result) => {
        const comparison = explicitRefreshComparisonRef.current;
        explicitRefreshComparisonRef.current = null;
        if (!comparison) return;
        if (shouldShowHomeUpToDateNotice({
          previousVisibleFingerprint: comparison.baseVisibleFingerprint,
          reason: comparison.reason,
          refreshedVisibleFingerprint: comparison.refreshedVisibleFingerprint,
          status: result.feed
        })) upToDateNoticeRef.current?.show();
      });
    }
    return refreshPromise;
  }, [clearDeferredHomeFreshness, clearPendingHomePage]);

  const refreshStaleHome = useCallback(() => refreshHome("stale-return"), [refreshHome]);

  const reevaluateDeferredHomeFreshness = useCallback((input: HomeDeferredFreshnessEvaluationInput) => {
    latestDeferredEvaluationRef.current = input;
    const deferredState = deferredFreshnessStateRef.current!;
    const deferred = deferredState.read();
    if (!deferred) return Promise.resolve(null);

    const owner = getActiveCacheOwner();
    const currentContext: HomeDeferredFreshnessContext | null = owner ? {
      generation: getActiveCacheGeneration(),
      ownerScope: owner.scope,
      structuralRevision: readHomeStructuralRevision(queryClient)
    } : null;
    if (!currentContext || !deferredState.isCurrentContext(currentContext)) {
      deferredState.clear();
      return Promise.resolve(null);
    }

    const refreshedAt = readHomePageOneRefreshAt(queryClient, currentContext.ownerScope);
    const isFresh = isHomePageOneFresh(refreshedAt);
    if (isFresh) {
      deferredState.clear();
      return Promise.resolve(null);
    }

    const queryState = queryClient.getQueryState(feedKeys.circlePages);
    const isFeedRequestPending = input.isFeedRequestPending || (
      !input.isPaginationActive && queryState?.fetchStatus === "fetching"
    );
    if (!canRunHomeDeferredFreshness({
      hasUsableContent: input.hasUsableContent,
      isAutomaticCheckActive: backgroundCheckRef.current?.isActive() ?? false,
      isExplicitRefreshActive: transactionRef.current?.isActive() ?? false,
      isFeedRequestPending,
      isFocused: input.isFocused,
      isForeground: input.isForeground,
      isFresh,
      isOnline: input.isOnline,
      isPaginationActive: input.isPaginationActive
    })) return Promise.resolve(null);

    const claimed = deferredState.claim();
    if (!claimed) return Promise.resolve(null);
    if (input.isAtTop) return refreshStaleHome();
    return backgroundCheckRef.current!.check({
      includeFeed: true,
      includeNotifications: claimed.notificationStatus !== "success"
    });
  }, [queryClient, refreshStaleHome]);

  const evaluateHomeFreshness = useCallback((input: HomeFreshnessEvaluationInput) => {
    const owner = getActiveCacheOwner();
    if (!owner) return Promise.resolve(null);
    const queryState = queryClient.getQueryState(feedKeys.circlePages);
    const refreshedAt = readHomePageOneRefreshAt(queryClient, owner.scope);
    const action = resolveHomeFreshnessAction({
      ...input,
      isAutomaticCheckActive: backgroundCheckRef.current?.isActive() ?? false,
      isExplicitRefreshActive: transactionRef.current?.isActive() ?? false,
      isFeedRequestPending: input.isFeedRequestPending || (
        !input.isPaginationActive && queryState?.fetchStatus === "fetching"
      ),
      isFresh: isHomePageOneFresh(refreshedAt)
    });

    if (action === "refresh-stale-return") return refreshStaleHome();
    if (action === "background-check") return backgroundCheckRef.current!.check({ includeFeed: true });
    if (action === "notifications-only") {
      const deferredState = deferredFreshnessStateRef.current!;
      const deferred = deferredState.defer({
        generation: getActiveCacheGeneration(),
        ownerScope: owner.scope,
        structuralRevision: readHomeStructuralRevision(queryClient)
      });
      if (deferred.notificationStatus !== "not-requested") return Promise.resolve(null);
      deferredState.setNotificationStatus(deferred, "pending");
      return backgroundCheckRef.current!.check({ includeFeed: false }).then((result) => {
        deferredState.setNotificationStatus(
          deferred,
          result.notifications === "success" ? "success" : "failed"
        );
        return result;
      }).finally(() => {
        const latestInput = latestDeferredEvaluationRef.current;
        if (latestInput) void reevaluateDeferredHomeFreshness(latestInput);
      });
    }
    return Promise.resolve(null);
  }, [queryClient, reevaluateDeferredHomeFreshness, refreshStaleHome]);

  const applyPendingHomePage = useCallback(async () => {
    if (applyingPendingRef.current) return false;
    const pending = pendingRef.current;
    if (!pending || !isContextActive(pending)) return false;
    applyingPendingRef.current = true;

    try {
      await queryClient.cancelQueries({ exact: true, queryKey: feedKeys.circlePages });
      if (pendingRef.current !== pending || !isContextActive(pending)) return false;
      if (readHomeStructuralRevision(queryClient) !== pending.structuralRevision) {
        clearPendingHomePage();
        return false;
      }
      const current = queryClient.getQueryData<InfiniteData<FeedPage>>(feedKeys.circlePages);
      if (!sameHomePostIds(homeFirstPageIds(current?.pages[0]), pending.baseFirstPageIds)) {
        clearPendingHomePage();
        return false;
      }
      const replacement = buildHomeFirstPageReplacement(pending.page, (post) => (
        reconcileHomeRefreshPost(
          queryClient,
          post,
          findCachedPostById(queryClient, post.id),
          pending.engagementSnapshot
        )
      ));
      queryClient.setQueryData<InfiniteData<FeedPage>>(feedKeys.circlePages, replacement);
      resetPaginationClaimsRef.current();
      clearPendingHomePage();
      scrollToTopRef.current();
      return true;
    } catch {
      return false;
    } finally {
      applyingPendingRef.current = false;
    }
  }, [clearPendingHomePage, queryClient]);

  const invalidatePendingHomePageIfChanged = useCallback((currentFirstPage: FeedPage | undefined) => {
    const deferred = deferredFreshnessStateRef.current?.read();
    if (deferred && readHomeStructuralRevision(queryClient) !== deferred.structuralRevision) {
      clearDeferredHomeFreshness();
    }
    const pending = pendingRef.current;
    if (!pending) return;
    if (sameHomePostIds(homeFirstPageIds(currentFirstPage), pending.baseFirstPageIds)) return;
    clearPendingHomePage();
  }, [clearDeferredHomeFreshness, clearPendingHomePage, queryClient]);

  const isRefreshActive = useCallback(() => transactionRef.current?.isActive() ?? false, []);
  const isAutomaticCheckActive = useCallback(() => backgroundCheckRef.current?.isActive() ?? false, []);

  return {
    applyPendingHomePage,
    evaluateHomeFreshness,
    hasPendingHomePage: pendingFreshFirstPage !== null,
    invalidatePendingHomePageIfChanged,
    isAutomaticCheckActive,
    isRefreshActive,
    isRefreshing,
    isUpToDateNoticeVisible,
    pendingNewPostCount: pendingFreshFirstPage?.newPostCount ?? 0,
    reevaluateDeferredHomeFreshness,
    refreshHome
  };
}

function isContextActive(context: HomeRequestContext) {
  return isCacheGenerationActive(context.generation) && getActiveCacheOwner()?.scope === context.ownerScope;
}
