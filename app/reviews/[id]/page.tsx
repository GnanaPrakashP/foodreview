import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import StarRating from "@/components/ui/StarRating";
import { formatDate } from "@/lib/utils";
import type { Review } from "@/lib/types";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ReviewDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: review } = await supabase
    .from("reviews")
    .select("*")
    .eq("id", id)
    .single<Review>();

  if (!review) notFound();

  return (
    <article>
      {review.photo_url && (
        <div className="-mx-4 mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={review.photo_url}
            alt={`Review at ${review.restaurant_name}`}
            className="w-full h-64 object-cover"
          />
        </div>
      )}

      <div className="flex flex-col gap-5">
        {/* Restaurant */}
        <h1 className="text-2xl font-bold text-orange-500">
          {review.restaurant_name}
        </h1>

        {/* Items */}
        <div className="flex flex-col gap-3">
          {review.items.map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-4 bg-white rounded-2xl border border-gray-100 px-4 py-3"
            >
              <span className="font-medium text-gray-900">{item.name}</span>
              <StarRating value={item.rating} readonly size="md" />
            </div>
          ))}
        </div>

        {/* Notes */}
        {review.body && (
          <p className="text-gray-700 leading-relaxed text-sm whitespace-pre-wrap bg-white rounded-2xl border border-gray-100 px-4 py-3">
            {review.body}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-sm">
          <span className="text-gray-500">{review.reviewer_name}</span>
          <time className="text-xs text-gray-400">{formatDate(review.created_at)}</time>
        </div>
      </div>
    </article>
  );
}
