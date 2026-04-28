import { createClient } from "@/lib/supabase/server";
import ReviewCard from "@/components/reviews/ReviewCard";
import type { Review } from "@/lib/types";
import Link from "next/link";

export const revalidate = 60;

export default async function FeedPage() {
  const supabase = await createClient();

  const { data: reviews, error } = await supabase
    .from("reviews")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<Review[]>();

  if (error) {
    return (
      <p className="text-center text-sm text-red-500 py-10">
        Failed to load reviews. Please try again later.
      </p>
    );
  }

  if (!reviews || reviews.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <span className="text-5xl">🍴</span>
        <h2 className="font-bold text-gray-800 text-lg">No reviews yet</h2>
        <p className="text-sm text-gray-500">
          Be the first to share a food experience!
        </p>
        <Link
          href="/reviews/new"
          className="bg-orange-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-orange-600 transition-colors"
        >
          Write a Review
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-gray-900">Recent Reviews</h1>
      {reviews.map((review) => (
        <ReviewCard key={review.id} review={review} />
      ))}
    </div>
  );
}
