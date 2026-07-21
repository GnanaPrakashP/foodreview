import { useEffect, useRef } from "react";
import { InteractionManager } from "react-native";
import { useQueryClient, type QueryState } from "@tanstack/react-query";
import { feedKeys } from "@/hooks/useFeeds";
import { currentProfilePageQueryOptions } from "@/hooks/useProfiles";
import { notificationKeys } from "@/hooks/useNotifications";
import { useSessionStore } from "@/stores/sessionStore";
import { useUserLocationStore } from "@/stores/userLocationStore";

const PROFILE_PREFETCH_IDLE_DELAY_MS = 250;

function requestSettled(state: QueryState<unknown, unknown> | undefined) {
  return Boolean(state && state.fetchStatus === "idle" && state.status !== "pending");
}

/**
 * Warms only the small Profile shell after Home's two launch-critical reads
 * settle. Posts and Memories keep their own focus-gated loading lifecycles.
 */
export function ProfileHeaderPrefetchBootstrap() {
  const queryClient = useQueryClient();
  const ownerUserId = useSessionStore((state) => state.session?.user.id ?? null);
  const location = useUserLocationStore((state) => state.location);
  const startupLocationResolved = useUserLocationStore((state) => state.startupResolved);
  const scheduledRef = useRef(false);

  useEffect(() => {
    scheduledRef.current = false;
    if (!ownerUserId || !startupLocationResolved) return;

    const homeQueryKey = feedKeys.circlePagesForLocation(location);
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let interactionTask: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
    let disposed = false;

    const scheduleWhenHomeSettles = () => {
      if (disposed || scheduledRef.current) return;
      const homeState = queryClient.getQueryState(homeQueryKey);
      const notificationState = queryClient.getQueryState(notificationKeys.hasUnread);
      if (!requestSettled(homeState) || !requestSettled(notificationState)) return;

      scheduledRef.current = true;
      idleTimer = setTimeout(() => {
        if (disposed) return;
        interactionTask = InteractionManager.runAfterInteractions(() => {
          if (disposed) return;
          void queryClient.prefetchQuery(currentProfilePageQueryOptions());
        });
      }, PROFILE_PREFETCH_IDLE_DELAY_MS);
    };

    const unsubscribe = queryClient.getQueryCache().subscribe(scheduleWhenHomeSettles);
    scheduleWhenHomeSettles();

    return () => {
      disposed = true;
      unsubscribe();
      if (idleTimer) clearTimeout(idleTimer);
      interactionTask?.cancel();
    };
  }, [location, ownerUserId, queryClient, startupLocationResolved]);

  return null;
}
