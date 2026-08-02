import type { MemoryPhoto } from "@/types/models";

export function recordMemoryUploadProgress(photoId: string, progress: number): number;
export function memoryUploadProgressFor(photoId: string): number | null;
export function resolveMemoryUploadProgress(media: MemoryPhoto | null | undefined): number | null;
export function forgetMemoryUploadProgress(photoIds: Iterable<string> | null | undefined): void;
export function clearMemoryUploadProgress(): void;
