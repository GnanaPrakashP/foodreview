import { createClient } from "@/lib/supabase/server";
import CirclePageClient from "@/app/CirclePageClient";
import { getCircleFeedPage } from "@/lib/circle-feed";

export const dynamic = "force-dynamic";

export default async function CirclePage() {
  const supabase = await createClient();
  const feed = await getCircleFeedPage(supabase);

  return <CirclePageClient initialData={feed} />;
}
