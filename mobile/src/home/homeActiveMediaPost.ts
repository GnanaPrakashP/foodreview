/**
 * Holds the feed's "current media post" outside React state so scroll-driven
 * viewability changes never re-render the list container or recreate its
 * renderItem. Rows subscribe individually (useSyncExternalStore) and only the
 * two rows whose active status flips re-render on a window shift.
 */
export type HomeActiveMediaPostStore = {
  get: () => string | null;
  set: (postId: string | null) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createHomeActiveMediaPostStore(): HomeActiveMediaPostStore {
  let activePostId: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => activePostId,
    set: (postId) => {
      if (postId === activePostId) return;
      activePostId = postId;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
