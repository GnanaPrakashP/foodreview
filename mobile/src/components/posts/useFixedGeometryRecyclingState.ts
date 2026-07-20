import { useRecyclingState } from "@shopify/flash-list";
import { type DependencyList, type SetStateAction, useCallback } from "react";

/**
 * Recycling state for values that can change native descendants but never the
 * measured outer row height. FlashList otherwise requests a parent layout for
 * every setter call, including image-ready and opacity-only updates.
 */
export function useFixedGeometryRecyclingState<T>(
  initialState: T | (() => T),
  dependencies: DependencyList
) {
  const [state, setRecyclingState] = useRecyclingState(initialState, dependencies);
  const setState = useCallback((nextState: SetStateAction<T>) => {
    setRecyclingState(nextState, true);
  }, [setRecyclingState]);
  return [state, setState] as const;
}
