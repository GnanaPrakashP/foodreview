import { useEffect, useRef } from "react";
import { recordPerformanceSample } from "@/performance/mobilePerformance";

type ProfiledTab = "circle" | "explore" | "profile";

/**
 * Measures focus-to-cached-content and focus-to-fresh-settled for the three
 * data-heavy main tabs. Only aggregate durations are emitted by profile builds.
 */
export function useTabPerformance(
  tab: ProfiledTab,
  active: boolean,
  contentReady: boolean,
  freshSettled: boolean
) {
  const activeRef = useRef(false);
  const focusStartedAtRef = useRef(Date.now());
  const cachedRecordedRef = useRef(false);
  const freshRecordedRef = useRef(false);

  useEffect(() => {
    if (active && !activeRef.current) {
      focusStartedAtRef.current = Date.now();
      cachedRecordedRef.current = false;
      freshRecordedRef.current = false;
      recordPerformanceSample("screen.mount");
    }
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!active || !contentReady || cachedRecordedRef.current) return;
    cachedRecordedRef.current = true;
    recordPerformanceSample(`tab.${tab}.cached_content`, {
      durationMs: Date.now() - focusStartedAtRef.current
    });
  }, [active, contentReady, tab]);

  useEffect(() => {
    if (!active || !contentReady || !freshSettled || freshRecordedRef.current) return;
    freshRecordedRef.current = true;
    recordPerformanceSample(`tab.${tab}.fresh_settled`, {
      durationMs: Date.now() - focusStartedAtRef.current
    });
  }, [active, contentReady, freshSettled, tab]);
}
