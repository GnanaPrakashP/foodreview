import { MEMORY_MEDIA_BUCKET, MEMORY_MEDIA_PENDING_REVIEW_TTL_HOURS } from "@/lib/memory-media-policy";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
type Transition = { cleanup_kind: "expired_intent" | "stale_pending_photo"; storage_path: string | null };

export async function runMemoryUploadCleanup(admin: AdminClient = createAdminClient(), limit = 100) {
  const boundedLimit = Math.min(Math.max(limit, 1), 200);
  const now = new Date().toISOString();
  const pendingCutoff = new Date(Date.now() - MEMORY_MEDIA_PENDING_REVIEW_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const [{ data: intents, error: intentsError }, { data: photos, error: photosError }] = await Promise.all([
    admin.from("shared_memory_upload_intents").select("id").eq("status", "created").lt("expires_at", now).limit(boundedLimit),
    admin.from("shared_memory_photos").select("id").eq("moderation_status", "pending").lt("created_at", pendingCutoff).limit(boundedLimit)
  ]);
  if (intentsError || photosError) throw new Error("memory_cleanup_candidates_failed");
  const intentIds = (intents ?? []).map((row: { id: string }) => row.id);
  const photoIds = (photos ?? []).map((row: { id: string }) => row.id);
  let transitions: Transition[] = [];
  if (intentIds.length || photoIds.length) {
    const { data, error } = await admin.rpc("cleanup_shared_memory_media", {
      p_expired_intent_ids: intentIds,
      p_now: now,
      p_pending_photo_ids: photoIds,
      p_pending_reason: "pending_review_expired"
    });
    if (error) throw new Error("memory_cleanup_transition_failed");
    transitions = Array.isArray(data) ? data as Transition[] : [];
  }
  const paths = [...new Set(transitions.map((row) => row.storage_path).filter((value): value is string => Boolean(value)))];
  if (paths.length) {
    const { error } = await admin.storage.from(MEMORY_MEDIA_BUCKET).remove(paths);
    if (error) throw new Error("memory_cleanup_storage_failed");
  }
  return {
    expiredIntents: transitions.filter((row) => row.cleanup_kind === "expired_intent").length,
    rejectedPendingMedia: transitions.filter((row) => row.cleanup_kind === "stale_pending_photo").length,
    removedObjects: paths.length
  };
}
