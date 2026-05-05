import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import type { Review } from "@/lib/types";
import FriendProfileClient from "@/components/people/FriendProfileClient";
import { normalizeAccountType } from "@/lib/circle";

interface Props {
  params: Promise<{ username: string }>;
}

export const dynamic = "force-dynamic";

type ProfileSummary = {
  first_name: string;
  last_name: string;
  account_type: string | null;
};

export default async function UserProfilePage({ params }: Props) {
  const { username } = await params;
  const name = decodeURIComponent(username);

  const supabase = await createClient();

  const [{ data: reviews }, { data: profiles }] = await Promise.all([
    supabase
      .from("reviews")
      .select("*")
      .eq("reviewer_name", name)
      .order("created_at", { ascending: false })
      .returns<Review[]>(),
    supabase
      .from("profiles")
      .select("first_name, last_name, account_type")
      .limit(1000)
      .returns<ProfileSummary[]>(),
  ]);

  const profile = (profiles ?? []).find((row) => `${row.first_name} ${row.last_name}`.trim() === name);

  if ((!reviews || reviews.length === 0) && !profile) notFound();

  return (
    <FriendProfileClient
      name={name}
      accountType={normalizeAccountType(profile?.account_type)}
      reviews={reviews ?? []}
    />
  );
}
