import type { FoodItem, Visibility } from "@/lib/types";

const VALID_VISIBILITIES = new Set<Visibility>(["public", "circle", "me"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(id: string): boolean {
  return UUID_RE.test(id);
}

export function isValidVisibility(value: unknown): value is Visibility {
  return typeof value === "string" && VALID_VISIBILITIES.has(value as Visibility);
}

export function normalizeReviewItems(items: unknown): { items?: FoodItem[]; error?: string } {
  if (!Array.isArray(items)) {
    return { error: "At least one dish is required" };
  }

  const normalized: FoodItem[] = [];
  for (const item of items as { name?: string; rating?: unknown }[]) {
    const name = item?.name?.trim();
    if (!name) continue;

    if (
      item.rating !== undefined
      && (typeof item.rating !== "number" || item.rating < 1 || item.rating > 5)
    ) {
      return { error: "Invalid rating" };
    }

    normalized.push({
      name,
      rating: item.rating ?? 0,
    });
  }

  if (normalized.length === 0) {
    return { error: "At least one dish is required" };
  }

  return { items: normalized };
}

export function validateReviewBody(value: unknown): { body?: string | null; error?: string } {
  if (value === undefined) return {};
  if (value === null) return { body: null };
  if (typeof value !== "string") return { error: "Invalid body" };

  const body = value.trim();
  if (body && body.length < 5) {
    return { error: "Body must be at least 5 characters" };
  }

  return { body: body || null };
}
