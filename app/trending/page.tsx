import TrendingPageClient from "./TrendingPageClient";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getTrendingPageData } from "@/lib/trending-page-data";
import {
  normalizeLocationBucket,
  normalizeLocationLabel,
  TRENDING_LOCATION_LABEL_COOKIE,
} from "@/lib/trending-location";

export const dynamic = "force-dynamic";

export default async function TrendingPage({
  searchParams,
}: {
  searchParams: Promise<{ loc?: string }>;
}) {
  const { loc } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const myName = (user?.user_metadata?.username as string) || user?.email?.split("@")[0] || "";
  const locationBucket = normalizeLocationBucket(loc);
  const cookieStore = await cookies();
  const initialLocationLabel = normalizeLocationLabel(cookieStore.get(TRENDING_LOCATION_LABEL_COOKIE)?.value);
  const data = await getTrendingPageData(supabase, myName, { locationBucket });

  return (
    <TrendingPageClient
      initialData={data}
      initialLocationBucket={locationBucket}
      initialLocationLabel={initialLocationLabel}
    />
  );
}
