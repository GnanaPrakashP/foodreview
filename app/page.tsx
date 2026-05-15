import { createClient } from "@/lib/supabase/server";
import { getCircleFeedPage } from "@/lib/circle-feed";
import CirclePageClient from "./CirclePageClient";

export const dynamic = "force-dynamic";

export default async function CirclePage() {
  const supabase = await createClient();
  const feed = await getCircleFeedPage(supabase);

  return <CirclePageClient initialData={feed} />;
}
