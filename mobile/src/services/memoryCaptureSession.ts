import type { MemoryCapturedMedia, MemoryCapturedMediaInput } from "@/types/memoryMediaCapture";

const captures = new Map<string, MemoryCapturedMedia>();

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

export function removeMemoryCapture(id: string) {
  captures.delete(id);
}
