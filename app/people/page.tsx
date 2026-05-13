import PeoplePageClient from "./PeoplePageClient";
import { createClient } from "@/lib/supabase/server";
import { getPeoplePageData } from "@/lib/people-page-data";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const myName = (user?.user_metadata?.username as string) || user?.email?.split("@")[0] || "";
  const data = await getPeoplePageData(supabase, myName);

  return <PeoplePageClient initialData={data} />;
}
