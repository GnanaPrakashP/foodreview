import { supabase } from "@/api/supabase";
import type { AddMemoryPhotoInput } from "@/services/memories";

export async function uploadMemoryPhoto(input: AddMemoryPhotoInput, username: string) {
  const ext = extensionFor(input.imageUri, input.imageMimeType);
  const contentType = input.imageMimeType || (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
  const path = `public/memories/${input.roomId}/${username}/${Date.now()}.${ext}`;
  const blob = await blobFromUri(input.imageUri);

  const { error } = await supabase.storage
    .from("review-photos")
    .upload(path, blob, { contentType, upsert: false });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("review-photos").getPublicUrl(path);
  return { publicUrl: data.publicUrl, storagePath: path };
}

function extensionFor(uri: string, mimeType?: string | null) {
  if (mimeType?.includes("png")) return "png";
  if (mimeType?.includes("webp")) return "webp";
  const match = uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  const ext = match?.[1]?.toLowerCase();
  if (ext === "png" || ext === "webp" || ext === "jpg" || ext === "jpeg") return ext;
  return "jpg";
}

async function blobFromUri(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("Could not read selected photo");
  return response.blob();
}
