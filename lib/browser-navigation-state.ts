"use client";

let initialHref = "";
let initialNavigationType = "";
let spaNavigationStarted = false;
let historyPatched = false;

function readInitialState() {
  if (typeof window === "undefined") return;
  if (!initialHref) initialHref = window.location.href;
  if (!initialNavigationType) {
    try {
      const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
      initialNavigationType = navigation?.type ?? "";
      const legacyNavigation = (performance as Performance & { navigation?: { type?: number } }).navigation;
      if (!initialNavigationType && legacyNavigation?.type === 1) initialNavigationType = "reload";
    } catch {
      initialNavigationType = "";
    }
  }
}

function noteNavigationChange(previousHref: string) {
  if (typeof window === "undefined") return;
  if (window.location.href !== previousHref) spaNavigationStarted = true;
}

function patchHistory() {
  if (historyPatched || typeof window === "undefined") return;
  historyPatched = true;

  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  window.history.pushState = function patchedPushState(...args) {
    const previousHref = window.location.href;
    const result = originalPushState.apply(this, args);
    noteNavigationChange(previousHref);
    return result;
  };

  window.history.replaceState = function patchedReplaceState(...args) {
    const previousHref = window.location.href;
    const result = originalReplaceState.apply(this, args);
    noteNavigationChange(previousHref);
    return result;
  };

  window.addEventListener("popstate", () => {
    spaNavigationStarted = true;
  });
}

export function markSpaNavigationStarted() {
  spaNavigationStarted = true;
}

export function isInitialDocumentReload() {
  if (typeof window === "undefined") return false;
  readInitialState();
  patchHistory();
  return initialNavigationType === "reload" && !spaNavigationStarted && window.location.href === initialHref;
}
