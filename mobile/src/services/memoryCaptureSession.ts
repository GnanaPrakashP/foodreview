import type { MemoryCapturedMedia, MemoryCapturedMediaInput } from "@/types/memoryMediaCapture";

const captures = new Map<string, MemoryCapturedMedia>();
const pendingPosts = new Map<string, { caption?: string; dishName?: string }>();

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

export function removeMemoryCapture(id: string) {
  pendingPosts.delete(id);
  captures.delete(id);
}
