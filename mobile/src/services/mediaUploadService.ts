import { addMemoryDish, addMemoryPhoto } from "@/services/memories";
import type { MemoryCapturedMedia } from "@/types/memoryMediaCapture";

export type PostMemoryRoomMediaInput = {
  asset: MemoryCapturedMedia;
  caption?: string;
  dishName?: string;
  roomId: string;
};

export async function postMemoryRoomMedia(input: PostMemoryRoomMediaInput) {
  const caption = input.caption?.trim() || undefined;
  const dishName = input.dishName?.trim() || "";
  const mimeType = input.asset.mimeType ?? (input.asset.mediaType === "video" ? "video/mp4" : "image/jpeg");

  await addMemoryPhoto({
    assets: [{
      imageHeight: input.asset.height ?? null,
      imageWidth: input.asset.width ?? null,
      mediaMimeType: mimeType,
      mediaType: input.asset.mediaType,
      mediaUri: input.asset.uri
    }],
    body: caption,
    roomId: input.roomId
  });

  if (dishName) {
    await addMemoryDish({
      dishName,
      roomId: input.roomId
    });
  }

  return { ok: true };
}
