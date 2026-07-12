import type { MemoryCapturedMediaInput } from "@/types/memoryMediaCapture";

// Hands the final captures from the camera route back to the share tab,
// which stays mounted underneath the pushed screens.
//
// Delivery is push-first: when the share tab is subscribed, captures are
// handed over immediately so the tab commits its review-step tree swap while
// the camera screen still covers it. Rebuilding that subtree during the
// screen-dismiss transition instead (a pull-on-focus-only model) races
// react-native-screens view recycling on Android and crashes Fabric mounting
// (IllegalStateException: addViewAt failed to insert view).
let pendingCaptures: MemoryCapturedMediaInput[] = [];

type PostCaptureListener = (assets: MemoryCapturedMediaInput[]) => void;
const captureListeners = new Set<PostCaptureListener>();

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

// The camera's X abandons the whole post. The share tab applies the reset on
// focus return (never mid-transition — see the Fabric note above).
let composerResetRequested = false;

export function requestPostComposerReset() {
  composerResetRequested = true;
}

export function consumePostComposerReset() {
  const requested = composerResetRequested;
  composerResetRequested = false;
  return requested;
}

export function clearPostCaptureSession() {
  pendingCaptures = [];
  composerResetRequested = false;
}
