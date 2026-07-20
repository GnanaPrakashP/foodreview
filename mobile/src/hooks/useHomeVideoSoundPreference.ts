import { useCallback, useEffect, useState } from "react";
import { getActiveCacheOwner } from "@/security/cacheOwnership";

// Session-only and owner-scoped. This map is intentionally never persisted.
const mutedByOwner = new Map<string, boolean>();

export function useHomeVideoSoundPreference() {
  const ownerScope = getActiveCacheOwner()?.scope ?? "inactive";
  const [muted, setMutedState] = useState(() => mutedByOwner.get(ownerScope) ?? true);

  useEffect(() => {
    setMutedState(mutedByOwner.get(ownerScope) ?? true);
  }, [ownerScope]);

  const setMuted = useCallback((next: boolean) => {
    mutedByOwner.set(ownerScope, next);
    setMutedState(next);
  }, [ownerScope]);

  return { muted, setMuted };
}
