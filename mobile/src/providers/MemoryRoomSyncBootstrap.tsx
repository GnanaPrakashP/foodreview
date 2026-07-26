import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  memoryKeys,
  restoreJoinedMemoryRoomSummaries,
  syncLoadedMemoryRoomCaches,
  useMemoryRoomsQuery,
  useMemoryRoomsRealtime
} from "@/hooks/useMemories";
import { captureMobileError } from "@/observability/mobileTelemetry";
import { useRuntimeActivity } from "@/performance/runtimeActivity";

/**
 * Authenticated application-level owner for Table Memory synchronization.
 *
 * The server remains authoritative. This host keeps the recent joined-room
 * projection warm in owner-scoped SQLite regardless of which app tab is open.
 */
export function MemoryRoomSyncBootstrap() {
  const queryClient = useQueryClient();
  const runtime = useRuntimeActivity();
  const previousRuntimeRef = useRef({
    isForeground: runtime.isForeground,
    isOnline: runtime.isOnline
  });
  const syncQueueRef = useRef(Promise.resolve());

  const rooms = useMemoryRoomsQuery();
  useMemoryRoomsRealtime();

  useEffect(() => {
    if (!rooms.data?.pages[0]) return;
    void restoreJoinedMemoryRoomSummaries(queryClient).catch((error) => {
      captureMobileError("memory.summary_restore_failed", error);
    });
  }, [queryClient, rooms.data?.pages]);

  useEffect(() => {
    const previous = previousRuntimeRef.current;
    previousRuntimeRef.current = {
      isForeground: runtime.isForeground,
      isOnline: runtime.isOnline
    };
    const resumed = runtime.isForeground && !previous.isForeground;
    const reconnected = runtime.isOnline && !previous.isOnline;
    if (!resumed && !reconnected) return;

    const synchronize = async () => {
      // The list query is permanently observed by this bootstrap, so an exact
      // invalidation restores joined rooms first. Then delta-sync every loaded
      // room in bounded two-room batches.
      await queryClient.invalidateQueries({
        exact: true,
        queryKey: memoryKeys.list
      });
      await syncLoadedMemoryRoomCaches(queryClient, { force: true });
    };
    syncQueueRef.current = syncQueueRef.current
      .then(synchronize, synchronize)
      .catch((error) => {
        captureMobileError("memory.runtime_sync_failed", error);
      });
  }, [queryClient, runtime.isForeground, runtime.isOnline]);

  return null;
}
