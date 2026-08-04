import type { MemoryPhoto } from "@/types/models";

export function isLocalMemoryMediaPreview(url: string | null | undefined): boolean;
export function mergeServerMemoryPhoto(
  local: MemoryPhoto | null | undefined,
  incoming: MemoryPhoto
): MemoryPhoto;
export function mergeServerMemoryAttachments(
  local: MemoryPhoto[] | null | undefined,
  incoming: MemoryPhoto[]
): MemoryPhoto[];
export function memoryPhotoIndexById(
  photos: Array<MemoryPhoto | null | undefined> | null | undefined
): Map<string, MemoryPhoto>;
