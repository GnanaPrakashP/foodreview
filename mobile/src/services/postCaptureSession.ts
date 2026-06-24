import type { MemoryCapturedMediaInput } from "@/types/memoryMediaCapture";

// Holds a single capture handed off from the in-app camera route back to the
// share/create tab, which stays mounted underneath the pushed camera screen.
let pendingCapture: MemoryCapturedMediaInput | null = null;

export function setPendingPostCapture(asset: MemoryCapturedMediaInput) {
  pendingCapture = asset;
}

export function consumePendingPostCapture() {
  const asset = pendingCapture;
  pendingCapture = null;
  return asset;
}
