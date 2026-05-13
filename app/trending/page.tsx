import TrendingPageClient from "./TrendingPageClient";
import { createClient } from "@/lib/supabase/server";
import { getTrendingPageData } from "@/lib/trending-page-data";

export const dynamic = "force-dynamic";

export default async function TrendingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const myName = (user?.user_metadata?.username as string) || user?.email?.split("@")[0] || "";
  const data = await getTrendingPageData(supabase, myName);

  return <TrendingPageClient initialData={data} />;
}
