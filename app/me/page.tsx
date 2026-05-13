import MePageClient from "./MePageClient";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMePageData } from "@/lib/me-page-data";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const myName = (user?.user_metadata?.username as string) || user?.email?.split("@")[0] || "";
  const displayName =
    (user?.user_metadata?.full_name as string) ||
    (user?.user_metadata?.name as string) ||
    myName;

  const data = myName
    ? await getMePageData(createAdminClient(), myName)
    : { reviews: [], circleMembers: [] };

  return <MePageClient initialData={{ ...data, myName, displayName }} />;
}
