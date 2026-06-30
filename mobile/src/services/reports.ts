import { apiUrl } from "@/api/config";
import { supabase } from "@/api/supabase";

export type ReportTargetType = "review" | "comment" | "profile" | "media";
export type ReportReason = "spam" | "harassment" | "unsafe" | "off_topic" | "copyright" | "other";

export type ReportContentInput = {
  details?: string;
  reason?: ReportReason;
  targetId: string;
  targetType: ReportTargetType;
};

async function authToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error("Log in before reporting content");
  return token;
}

export async function reportContent(input: ReportContentInput) {
  const targetId = input.targetId.trim();
  if (!targetId) throw new Error("Choose something to report");

  const token = await authToken();
  const response = await fetch(apiUrl("/api/reports"), {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
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
