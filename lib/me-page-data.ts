import type { Review } from "@/lib/types";
import { getCircleRelationshipsForName } from "@/lib/circle-db";
import { getPrivateCached, invalidatePrivateCacheByTags } from "@/lib/private-cache";

const ME_PAGE_CACHE_TTL_MS = 5 * 60 * 1000;

type SupabaseLike = {
  from: (table: string) => any;
};

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

export function invalidateMePageCacheForNames(names: string[]) {
  const tags = [];
  for (const name of names) {
    const normalized = normalizeName(name);
    if (normalized) tags.push(`me-page:${normalized}`);
  }
  invalidatePrivateCacheByTags(tags);
}

const globalForMeCache = globalThis as typeof globalThis & {
  __foodReviewInvalidateMePageCacheForNames?: (names: string[]) => void;
};

globalForMeCache.__foodReviewInvalidateMePageCacheForNames = invalidateMePageCacheForNames;

export async function getMePageData(supabase: SupabaseLike, myName: string) {
  const viewer = normalizeName(myName);
  if (!viewer) return { reviews: [] as Review[], circleMembers: [] as string[] };

  return getPrivateCached({
    key: `me-page:v1:${viewer}`,
    ttlMs: ME_PAGE_CACHE_TTL_MS,
    load: async () => ({
      value: await loadMePageData(supabase, myName),
      tags: [`me-page:${viewer}`],
    }),
  });
}

async function loadMePageData(supabase: SupabaseLike, myName: string) {
  const [relationships, { data: reviews }] = await Promise.all([
    getCircleRelationshipsForName(supabase, myName),
    supabase
      .from("reviews")
      .select("*")
      .eq("reviewer_name", myName)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  return {
    reviews: (reviews ?? []) as Review[],
    circleMembers: [...relationships.circleMembers],
  };
}
