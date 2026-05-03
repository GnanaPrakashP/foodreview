import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import type { Review } from "@/lib/types";
import FriendProfileClient from "@/components/people/FriendProfileClient";

interface Props {
  params: Promise<{ username: string }>;
}

export const dynamic = "force-dynamic";

export default async function UserProfilePage({ params }: Props) {
  const { username } = await params;
  const name = decodeURIComponent(username);

  const supabase = await createClient();

  const { data: reviews } = await supabase
    .from("reviews")
    .select("*")
    .eq("reviewer_name", name)
    .order("created_at", { ascending: false })
    .returns<Review[]>();

  if (!reviews || reviews.length === 0) notFound();

  return <FriendProfileClient name={name} reviews={reviews} />;
}
