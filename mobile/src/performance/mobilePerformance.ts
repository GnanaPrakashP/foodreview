type PerformanceEventName =
  | "app.account_boundary_ready"
  | "app.cache_hydration"
  | "app.js_start_to_feed_content"
  | "feed.first_content"
  | "media.active_feed_players"
  | "screen.mount"
  | "tab.circle.cached_content"
  | "tab.circle.fresh_settled"
  | "tab.explore.cached_content"
  | "tab.explore.fresh_settled"
  | "tab.profile.cached_content"
  | "tab.profile.fresh_settled";

import { recordMobileFlow } from "@/observability/mobileTelemetry";

type PerformanceSample = {
  at: number;
  durationMs?: number;
  name: PerformanceEventName;
  value?: number;
};

export const PERFORMANCE_PROFILE_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_PERFORMANCE_PROFILE === "1";
export const JS_RUNTIME_STARTED_AT_MS = Date.now();
const MAX_SAMPLES = 250;
const samples: PerformanceSample[] = [];
const counters = new Map<PerformanceEventName, number>();

function append(sample: PerformanceSample) {
  if (!PERFORMANCE_PROFILE_ENABLED) return;
  globalThis.performance?.mark?.(sample.name);
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  // Profile-build output is deliberately aggregate-only: stable event name,
  // elapsed time or count. It contains no account, content, or URL fields.
  console.info(`CB_PERF ${JSON.stringify(sample)}`);
}

export function recordPerformanceSample(
  name: PerformanceEventName,
  sample: Omit<PerformanceSample, "at" | "name"> = {}
) {
  append({ at: Date.now(), name, ...sample });
  if (typeof sample.durationMs === "number") {
    recordMobileFlow(name, sample.durationMs, "success", { source: "phase6_marker" });
  }
}

export function adjustPerformanceCounter(name: PerformanceEventName, delta: number) {
  if (!PERFORMANCE_PROFILE_ENABLED) return () => {};
  const value = Math.max(0, (counters.get(name) ?? 0) + delta);
  counters.set(name, value);
  append({ at: Date.now(), name, value });
  return () => {
    const next = Math.max(0, (counters.get(name) ?? 0) - delta);
    counters.set(name, next);
    append({ at: Date.now(), name, value: next });
  };
}

export function getSanitizedPerformanceSnapshot() {
  return {
    counters: Object.fromEntries(counters),
    samples: [...samples]
  };
}

export function clearPerformanceSnapshot() {
  counters.clear();
  samples.length = 0;
}
