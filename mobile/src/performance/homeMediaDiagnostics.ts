import type { HomeMediaPreparationClass } from "@/home/homeMediaPreparationPolicy";

export type { HomeMediaPreparationClass } from "@/home/homeMediaPreparationPolicy";

export type HomeMediaProfileEvent =
  | "blank_page_prevented"
  | "cached_remount"
  | "cached_readiness_reuse"
  | "carousel_page_mount"
  | "carousel_page_unmount"
  | "carousel_metadata_ready"
  | "carousel_metadata_requested"
  | "carousel_render"
  | "cover_mount"
  | "cover_successful_load"
  | "cover_unmount"
  | "derivative_used"
  | "first_uncached_load"
  | "feed_row_mount"
  | "feed_row_unmount"
  | "image_cache_type"
  | "interaction_mode_changed"
  | "media_renewal"
  | "on_page_selected"
  | "post_card_render"
  | "preparation_queued"
  | "prefetch_cancelled"
  | "prefetch_completed"
  | "prefetch_failed"
  | "prefetch_started"
  | "slow_bitmap_upload_marker"
  | "vertical_prediction_changed"
  | "vertical_priority_changed";

export type HomeMediaProfileGauge =
  | "active_carousel_preparations"
  | "active_video_players"
  | "mounted_carousel_media"
  | "mounted_home_image_surfaces"
  | "placeholder_pages"
  | "preparation_queue_depth"
  | "simultaneous_cover_preparations"
  | "simultaneous_media_preparations";

type SafeDetail = {
  cacheType?: "none" | "disk" | "memory";
  derivative?: "feed" | "playback" | "poster" | "thumbnail";
  derivativeType?: "canonical" | "feed" | "legacy" | "poster";
  elapsedMs?: number;
  interactionMode?: "carousel-interacting" | "idle" | "vertical-scrolling";
  currentSlotCount?: 0 | 1;
  nextSlotCount?: 0 | 1;
  previousSlotCount?: 0 | 1;
  position?: number;
  preparationClass?: HomeMediaPreparationClass;
  source?: "local-cache" | "remote";
};

const PROFILE_FLAG_ENABLED = process.env.EXPO_PUBLIC_HOME_MEDIA_PROFILE === "1";
const PROFILE_BUILD = __DEV__ || process.env.EXPO_PUBLIC_PERFORMANCE_PROFILE === "1";
const PRODUCTION_RELEASE = process.env.EXPO_PUBLIC_APP_ENVIRONMENT === "production" && !__DEV__;
export const HOME_MEDIA_PROFILE_ENABLED = PROFILE_FLAG_ENABLED && PROFILE_BUILD && !PRODUCTION_RELEASE;

const MAX_LOGGED_EVENTS = 400;
const counts = new Map<HomeMediaProfileEvent, number>();
const gauges = new Map<HomeMediaProfileGauge, number>();
const gaugeMaximums = new Map<HomeMediaProfileGauge, number>();
let loggedEvents = 0;

export function recordHomeMediaProfile(event: HomeMediaProfileEvent, detail: SafeDetail = {}) {
  if (!HOME_MEDIA_PROFILE_ENABLED) return;
  const count = (counts.get(event) ?? 0) + 1;
  counts.set(event, count);
  if (loggedEvents >= MAX_LOGGED_EVENTS) return;
  loggedEvents += 1;
  // This payload is intentionally restricted to aggregate counts and enums.
  // Never add post IDs, media IDs, URLs, paths, tokens, or account fields.
  console.info(`CB_HOME_MEDIA_PROFILE ${JSON.stringify({ count, detail, event })}`);
}

export function adjustHomeMediaProfileGauge(gauge: HomeMediaProfileGauge, delta: 1 | -1) {
  if (!HOME_MEDIA_PROFILE_ENABLED) return;
  const current = Math.max(0, (gauges.get(gauge) ?? 0) + delta);
  gauges.set(gauge, current);
  gaugeMaximums.set(gauge, Math.max(gaugeMaximums.get(gauge) ?? 0, current));
}

export function setHomeMediaProfileGauge(gauge: HomeMediaProfileGauge, value: number) {
  if (!HOME_MEDIA_PROFILE_ENABLED) return;
  const current = Math.max(0, Math.floor(value));
  gauges.set(gauge, current);
  gaugeMaximums.set(gauge, Math.max(gaugeMaximums.get(gauge) ?? 0, current));
}

export function recordHomeMediaSlowBitmapUploadMarker() {
  recordHomeMediaProfile("slow_bitmap_upload_marker");
}

export function getHomeMediaProfileSnapshot() {
  return {
    events: Object.fromEntries(counts),
    gauges: Object.fromEntries(gauges),
    gaugeMaximums: Object.fromEntries(gaugeMaximums)
  };
}

export function clearHomeMediaProfileSnapshot() {
  counts.clear();
  gauges.clear();
  gaugeMaximums.clear();
  loggedEvents = 0;
}
