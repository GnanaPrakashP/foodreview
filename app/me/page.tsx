import { createClient } from "@/lib/supabase/server";
import type { Review } from "@/lib/types";
import MeClient from "@/components/me/MeClient";

export const dynamic = "force-dynamic";

export interface WishlistItem {
  restaurant_name: string;
  post_id: string | null;
}

export interface MyComment {
  id: string;
  post_id: string;
  content: string;
  created_at: string;
  restaurant_name: string;
  reviewer_name: string;
}

export default async function MePage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const myName = user?.user_metadata?.full_name ?? "";

  const [
    { data: reviews },
    { data: likedRows },
    { data: wishlistRows },
    { data: commentRows },
  ] = await Promise.all([
    supabase
      .from("reviews")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300)
      .returns<Review[]>(),

    myName
      ? supabase
          .from("likes")
          .select("post_id")
          .eq("user_name", myName)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),

    myName
      ? supabase
          .from("wishlist")
          .select("restaurant_name, post_id")
          .eq("user_name", myName)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),

    myName
      ? supabase
          .from("comments")
          .select("id, post_id, content, created_at")
          .eq("user_name", myName)
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
  ]);

  const allReviews = reviews ?? [];

  // Resolve liked IDs → full Review objects
  const likedIds = new Set((likedRows ?? []).map((r: { post_id: string }) => r.post_id));
  const likedReviews = allReviews.filter((r) => likedIds.has(r.id));

  // Wishlist
  const wishlist: WishlistItem[] = (wishlistRows ?? []) as WishlistItem[];

  // Comments — attach restaurant_name from the review lookup
  const reviewById = new Map(allReviews.map((r) => [r.id, r]));
  const myComments: MyComment[] = (commentRows ?? []).map(
    (c: { id: string; post_id: string; content: string; created_at: string }) => {
      const rev = reviewById.get(c.post_id);
      return {
        ...c,
        restaurant_name: rev?.restaurant_name ?? "Unknown place",
        reviewer_name: rev?.reviewer_name ?? "",
      };
    }
  );

  return (
    <MeClient
      allReviews={allReviews}
      likedReviews={likedReviews}
      wishlist={wishlist}
      myComments={myComments}
    />
  );
}
