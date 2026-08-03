import { getThumbnailAsync, type VideoThumbnailsResult } from "expo-video-thumbnails";

/**
 * Shared local-first poster generator used by both post sharing and Table
 * Memory. A first-frame still avoids native VideoView clipping/blank-surface
 * problems while the source is being prepared or uploaded.
 */
export function createLocalVideoPoster(uri: string): Promise<VideoThumbnailsResult> {
  return getThumbnailAsync(uri, { quality: 0.6, time: 0 });
}
