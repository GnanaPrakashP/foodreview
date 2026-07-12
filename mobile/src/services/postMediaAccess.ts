import { apiUrl } from "@/api/config";
import { supabase } from "@/api/supabase";
import type { ReviewMedia } from "@/types/models";

type PostMediaDto = {
  accessClass: ReviewMedia["accessClass"];
  aspectRatio: number | null;
  displayUrl: string;
  durationMs: number | null;
  expiresAt: string;
  height: number | null;
  id: string;
  mediaType: "image" | "video";
  placeholder: string | null;
  posterUrl: string | null;
  position: number;
  thumbnailUrl: string | null;
  width: number | null;
};

export async function fetchPostMediaAccess(assetIdsInput: string[]) {
  const assetIds = Array.from(new Set(assetIdsInput.filter(Boolean)));
  const result: Record<string, ReviewMedia> = {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? null;
  for (let offset = 0; offset < assetIds.length; offset += 50) {
    const batch = assetIds.slice(offset, offset + 50);
    const response = await fetch(apiUrl("/api/media/access"), {
      body: JSON.stringify({ assetIds: batch }),
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = await response.json().catch(() => null) as { media?: PostMediaDto[]; error?: string } | null;
    if (!response.ok || !payload) throw new Error(payload?.error ?? "Could not authorize post media");
    for (const media of payload.media ?? []) {
      result[media.id] = {
        accessClass: media.accessClass,
        aspectRatio: media.aspectRatio,
        expiresAt: media.expiresAt,
        height: media.height,
        mediaAssetId: media.id,
        mediaType: media.mediaType,
        placeholder: media.placeholder,
        posterUrl: media.posterUrl,
        position: media.position,
        publicUrl: media.displayUrl,
        thumbnailUrl: media.thumbnailUrl,
        width: media.width
      };
    }
  }
  return result;
}
