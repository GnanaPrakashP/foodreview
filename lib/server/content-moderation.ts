import { fetchWithDeadline } from "@/lib/server/api-security";

type SafeSearchLikelihood = "UNKNOWN" | "VERY_UNLIKELY" | "UNLIKELY" | "POSSIBLE" | "LIKELY" | "VERY_LIKELY";
export type ModerationDecision =
  | { decision: "approved" }
  | { decision: "pending"; reasonCode: "provider_unavailable" | "provider_unconfigured" }
  | { decision: "rejected"; reasonCode: "adult_content" | "violent_content" };

const UNSAFE = new Set<SafeSearchLikelihood>(["LIKELY", "VERY_LIKELY"]);

export async function moderateImageContent(buffer: Buffer): Promise<ModerationDecision> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!apiKey) return { decision: "pending", reasonCode: "provider_unconfigured" };
  try {
    const response = await fetchWithDeadline(
      `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`,
      {
        body: JSON.stringify({
          requests: [{
            features: [{ maxResults: 1, type: "SAFE_SEARCH_DETECTION" }],
            image: { content: buffer.toString("base64") },
          }],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
      8_000
    );
    if (!response.ok) return { decision: "pending", reasonCode: "provider_unavailable" };
    const payload = await response.json() as {
      responses?: Array<{
        error?: unknown;
        safeSearchAnnotation?: {
          adult?: SafeSearchLikelihood;
          violence?: SafeSearchLikelihood;
        };
      }>;
    };
    const first = payload.responses?.[0];
    if (!first || first.error || !first.safeSearchAnnotation) {
      return { decision: "pending", reasonCode: "provider_unavailable" };
    }
    if (first.safeSearchAnnotation.adult && UNSAFE.has(first.safeSearchAnnotation.adult)) {
      return { decision: "rejected", reasonCode: "adult_content" };
    }
    if (first.safeSearchAnnotation.violence && UNSAFE.has(first.safeSearchAnnotation.violence)) {
      return { decision: "rejected", reasonCode: "violent_content" };
    }
    return { decision: "approved" };
  } catch {
    return { decision: "pending", reasonCode: "provider_unavailable" };
  }
}
