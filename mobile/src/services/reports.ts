import { apiUrl } from "@/api/config";
import { authorizedApiHeaders } from "@/api/client";

export type ReportTargetType = "review" | "comment" | "profile" | "media";
export type ReportReason = "spam" | "harassment" | "unsafe" | "off_topic" | "copyright" | "other";

export type ReportContentInput = {
  details?: string;
  reason?: ReportReason;
  targetId: string;
  targetType: ReportTargetType;
};

export async function reportContent(input: ReportContentInput) {
  const targetId = input.targetId.trim();
  if (!targetId) throw new Error("Choose something to report");

  const response = await fetch(apiUrl("/api/reports"), {
    method: "POST",
    headers: await authorizedApiHeaders("reporting content", "POST"),
    body: JSON.stringify({
      details: input.details?.trim() || undefined,
      reason: input.reason ?? "other",
      targetId,
      targetType: input.targetType
    })
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? "Could not send report");
  return payload;
}
