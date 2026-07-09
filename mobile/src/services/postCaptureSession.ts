import type { MemoryCapturedMediaInput } from "@/types/memoryMediaCapture";

// Gallery picks travel camera -> crop -> create tab as a draft queue: the
// crop screen works through it one image at a time (videos pass through
// untouched), collecting outputs until the whole batch is delivered.
let draftQueue: MemoryCapturedMediaInput[] = [];
let draftCursor = 0;
let draftOutputs: MemoryCapturedMediaInput[] = [];

// Hands the final captures from the camera/crop routes back to the share
// tab, which stays mounted underneath the pushed screens.
//
// Delivery is push-first: when the share tab is subscribed, captures are
// handed over immediately so the tab commits its review-step tree swap while
// the camera/crop screen still covers it. Rebuilding that subtree during the
// screen-dismiss transition instead (a pull-on-focus-only model) races
// react-native-screens view recycling on Android and crashes Fabric mounting
// (IllegalStateException: addViewAt failed to insert view).
let pendingCaptures: MemoryCapturedMediaInput[] = [];

type PostCaptureListener = (assets: MemoryCapturedMediaInput[]) => void;
const captureListeners = new Set<PostCaptureListener>();

export function setPostCaptureDraftQueue(assets: MemoryCapturedMediaInput[]) {
  draftQueue = [...assets];
  draftCursor = 0;
  draftOutputs = [];
}

export function currentPostCaptureDraft() {
  const asset = draftQueue[draftCursor];
  if (!asset) return null;
  return {
    asset,
    index: draftCursor,
    total: draftQueue.length
  };
}

// Records the processed output for the current draft and moves to the next.
export function resolvePostCaptureDraft(output: MemoryCapturedMediaInput) {
  draftOutputs.push(output);
  draftCursor += 1;
}

// Returns everything resolved so far and resets the queue.
export function finishPostCaptureDrafts() {
  const outputs = draftOutputs;
  clearPostCaptureDrafts();
  return outputs;
}

export function clearPostCaptureDrafts() {
  draftQueue = [];
  draftCursor = 0;
  draftOutputs = [];
}

export function setPendingPostCaptures(assets: MemoryCapturedMediaInput[]) {
  if (assets.length === 0) return;
  if (captureListeners.size > 0) {
    pendingCaptures = [];
    for (const listener of captureListeners) listener(assets);
    return;
  }
  pendingCaptures = assets;
}

export function setPendingPostCapture(asset: MemoryCapturedMediaInput) {
  setPendingPostCaptures([asset]);
}

export function subscribeToPostCaptures(listener: PostCaptureListener) {
  captureListeners.add(listener);
  return () => {
    captureListeners.delete(listener);
  };
}

export function consumePendingPostCaptures() {
  const assets = pendingCaptures;
  pendingCaptures = [];
  return assets;
}
