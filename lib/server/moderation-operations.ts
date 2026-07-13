import { randomUUID } from "node:crypto";
import { moderateImageContent } from "@/lib/server/content-moderation";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiLogger } from "@/lib/observability/server";

type AdminClient = ReturnType<typeof createAdminClient>;

type ModerationClaim = {
  id: string;
  media_type: string;
  moderation_claim_token: string;
  quarantine_bucket_id: string;
  quarantine_storage_path: string;
};

function workerId(value?: string) {
  const candidate = value?.trim() || `moderation-${process.pid}-${randomUUID().slice(0, 8)}`;
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(candidate)) throw new Error("moderation_worker_id_invalid");
  return candidate;
}

export async function processModerationBatch(options: {
  admin?: AdminClient;
  limit?: number;
  workerId?: string;
} = {}) {
  const admin = options.admin ?? createAdminClient();
  const { data, error } = await admin.rpc("claim_review_moderation_intents", {
    p_lease_seconds: 120,
    p_limit: Math.min(Math.max(options.limit ?? 10, 1), 50),
    p_worker_id: workerId(options.workerId)
  });
  if (error) throw new Error("moderation_claim_failed");
  const claims = (Array.isArray(data) ? data : []) as ModerationClaim[];
  let approved = 0;
  let pending = 0;
  let rejected = 0;

  for (const claim of claims) {
    let decision: "approved" | "pending" | "rejected" = "pending";
    let reasonCode: string | null = "provider_unavailable";
    if (claim.media_type !== "image") {
      decision = "rejected";
      reasonCode = "video_not_supported";
    } else {
      const { data: object, error: downloadError } = await admin.storage
        .from(claim.quarantine_bucket_id)
        .download(claim.quarantine_storage_path);
      if (downloadError || !object) {
        decision = "rejected";
        reasonCode = "object_missing";
      } else {
        const moderation = await moderateImageContent(Buffer.from(await object.arrayBuffer()));
        decision = moderation.decision;
        reasonCode = moderation.decision === "approved" ? null : moderation.reasonCode;
      }
    }
    if (decision === "rejected") {
      await admin.storage.from(claim.quarantine_bucket_id).remove([claim.quarantine_storage_path]).catch(() => undefined);
    }
    const { data: completed, error: completeError } = await admin.rpc("complete_review_moderation_intent", {
      p_claim_token: claim.moderation_claim_token,
      p_decision: decision,
      p_intent_id: claim.id,
      p_reason_code: reasonCode
    });
    if (completeError || completed !== true) throw new Error("moderation_completion_failed");
    if (decision === "approved") approved += 1;
    else if (decision === "rejected") rejected += 1;
    else pending += 1;
  }
  apiLogger.info("moderation_batch_completed", { approved, claimed: claims.length, pending, rejected });
  return { approved, claimed: claims.length, pending, rejected };
}
