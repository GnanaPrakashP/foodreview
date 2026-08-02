import type { MemoryRoomTabMode } from "@/features/memories/room/useMemoryRoomController";
import type { MemoryCapturedMedia, MemoryCapturedMediaInput } from "@/types/memoryMediaCapture";

const captures = new Map<string, MemoryCapturedMedia>();
const pendingPosts = new Map<string, { caption?: string; dishName?: string }>();
// Where the room should land when the capture flow hands control back. A `tab`
// route param cannot carry this: the room screen is still mounted underneath,
// so `router.dismissTo` returns to the existing route rather than remounting
// it, and re-sending a value the param already holds is not a change the room
// can observe. Requested before the dismiss, consumed when the room refocuses.
const pendingRoomTabs = new Map<string, MemoryRoomTabMode>();

export function saveMemoryCapture(input: MemoryCapturedMediaInput) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const capture: MemoryCapturedMedia = {
    ...input,
    createdAt: new Date().toISOString(),
    id
  };
  captures.set(id, capture);
  return capture;
}

export function getMemoryCapture(id: string) {
  return captures.get(id) ?? null;
}

export function queueMemoryCapturePost(
  id: string,
  input: {
    caption?: string;
    dishName?: string;
  }
) {
  if (!captures.has(id)) return false;
  pendingPosts.set(id, {
    caption: input.caption?.trim() || undefined,
    dishName: input.dishName?.trim() || undefined
  });
  return true;
}

export function consumeMemoryCapturePost(id: string) {
  const asset = captures.get(id);
  const pendingPost = pendingPosts.get(id);
  if (!asset || !pendingPost) return null;
  pendingPosts.delete(id);
  return {
    asset,
    caption: pendingPost.caption,
    dishName: pendingPost.dishName
  };
}

export function requestMemoryRoomTab(roomId: string, tab: MemoryRoomTabMode) {
  pendingRoomTabs.set(roomId, tab);
}

export function consumeMemoryRoomTab(roomId: string) {
  const tab = pendingRoomTabs.get(roomId);
  if (!tab) return null;
  pendingRoomTabs.delete(roomId);
  return tab;
}

export function removeMemoryCapture(id: string) {
  pendingPosts.delete(id);
  captures.delete(id);
}

export function clearMemoryCaptureSession() {
  captures.clear();
  pendingPosts.clear();
  pendingRoomTabs.clear();
}
