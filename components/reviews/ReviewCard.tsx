import Link from "next/link";
import StarRating from "@/components/ui/StarRating";
import { formatDate } from "@/lib/utils";
import type { Review } from "@/lib/types";

interface ReviewCardProps {
  review: Review;
}

export default function ReviewCard({ review }: ReviewCardProps) {
  const firstItem = review.items[0];
  const extraCount = review.items.length - 1;

  return (
    <article className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {review.photo_url && (
        <div className="h-48 w-full bg-gray-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={review.photo_url}
            alt={`${firstItem?.name} at ${review.restaurant_name}`}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div className="p-4">
        {/* Restaurant */}
        <p className="text-sm text-orange-500 font-semibold mb-2">
          {review.restaurant_name}
        </p>

        {/* Items */}
        <div className="flex flex-col gap-1.5 mb-3">
          {review.items.slice(0, 2).map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-gray-900 truncate">
                {item.name}
              </span>
              <StarRating value={item.rating} readonly size="sm" />
            </div>
          ))}
          {extraCount > 1 && (
            <p className="text-xs text-gray-400">+{extraCount - 1} more item{extraCount - 1 !== 1 ? "s" : ""}</p>
          )}
        </div>

        {/* Body snippet */}
        {review.body && (
          <p className="text-sm text-gray-500 leading-relaxed mb-3 line-clamp-2">
            {review.body}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-500">{review.reviewer_name}</span>
          <div className="flex items-center gap-2">
            <time className="text-xs text-gray-400">{formatDate(review.created_at)}</time>
            <Link
              href={`/reviews/${review.id}`}
              className="text-xs text-orange-500 font-medium hover:underline"
            >
              Read more
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
