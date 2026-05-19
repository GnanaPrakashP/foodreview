import Link from "next/link";
import type { Review } from "@/lib/types";
import { googleMapsUrl, restaurantLocationLabel } from "@/lib/location";
import { reviewMediaItems } from "@/lib/review-media";

interface ReviewCardProps {
  review: Review;
  hideSender?: boolean;
}

function avgRating(review: Review): number {
  if (!review.items.length) return 0;
  return review.items.reduce((s, it) => s + it.rating, 0) / review.items.length;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ReviewCard({ review, hideSender }: ReviewCardProps) {
  const firstItem = review.items[0];
  const rating = avgRating(review);
  const locationLabel = restaurantLocationLabel(review);
  const mapsUrl = googleMapsUrl(review);
  const primaryMedia = reviewMediaItems(review)[0] ?? null;

  return (
    <article
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "20px",
        overflow: "hidden",
      }}
    >
      {/* Sender row */}
      {!hideSender && <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "50%",
            background: "linear-gradient(135deg, #F06030, #C04020)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: "14px",
            color: "white",
            flexShrink: 0,
          }}
        >
          {review.reviewer_name?.[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="flex-1 min-w-0">
          <p style={{ fontSize: "14px", fontWeight: 500, color: "var(--cream)" }}>
            {review.reviewer_name} shared a spot 📍
          </p>
          <p suppressHydrationWarning style={{ fontSize: "11px", color: "var(--muted)", marginTop: "1px" }}>
            {timeAgo(review.created_at)}
          </p>
        </div>
      </div>}

      {/* Image / hero */}
      {primaryMedia && (
        <div
          style={{
            margin: "0 16px",
            aspectRatio: "4/5",
            borderRadius: "16px",
            background: "#000",
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {primaryMedia.media_type === "video" ? (
            <video src={primaryMedia.public_url} controls playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={primaryMedia.public_url}
              alt={firstItem?.name ?? review.restaurant_name}
              loading="lazy"
              decoding="async"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 50%)",
              pointerEvents: "none",
            }}
          />
          {firstItem && (
            <span
              style={{
                position: "absolute",
                bottom: "10px",
                left: "10px",
                background: "rgba(255,255,255,0.1)",
                backdropFilter: "blur(8px)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "white",
                fontSize: "11px",
                fontWeight: 500,
                padding: "4px 10px",
                borderRadius: "20px",
              }}
            >
              {firstItem.name}
            </span>
          )}
        </div>
      )}

      {/* Body */}
      <div className="px-4 pt-3 pb-1">
        <h2
          style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: "18px",
            fontWeight: 800,
            color: "var(--cream)",
            lineHeight: 1.15,
            margin: 0,
          }}
        >
          {review.restaurant_name}
        </h2>
        {locationLabel && (
          <a
            href={mapsUrl ?? undefined}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            style={{ display: "inline-block", fontSize: "11px", lineHeight: 1.2, color: "var(--muted)", marginTop: "1px", textDecoration: "none" }}
          >
            📍 {locationLabel}
          </a>
        )}

        {review.items.length > 1 && (
          <p style={{ fontSize: "12px", color: "var(--muted)", marginTop: "3px" }}>
            {review.items.map((it) => it.name).join(" · ")}
          </p>
        )}

        {review.body && (
          <div
            style={{
              marginTop: "10px",
              padding: "10px 12px",
              background: "var(--surface)",
              borderLeft: "3px solid var(--orange)",
              borderRadius: "0 10px 10px 0",
            }}
          >
            <p
              style={{
                fontFamily: "'Syne', sans-serif",
                fontStyle: "italic",
                fontSize: "14px",
                color: "var(--cream)",
                lineHeight: "1.5",
              }}
            >
              "{review.body}"
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-3 pb-3">
          {rating > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                background: "rgba(232,168,48,0.12)",
                border: "1px solid rgba(232,168,48,0.2)",
                padding: "5px 10px",
                borderRadius: "20px",
              }}
            >
              <span>⭐</span>
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--gold)",
                  fontWeight: 600,
                }}
              >
                {rating.toFixed(1)} avg
              </span>
            </div>
          )}
          <Link
            href={`/reviews/${review.id}`}
            style={{
              marginLeft: "auto",
              background: "var(--orange)",
              color: "white",
              border: "none",
              borderRadius: "12px",
              padding: "8px 16px",
              fontFamily: "'Syne', sans-serif",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
              textDecoration: "none",
            }}
          >
            I want to go →
          </Link>
        </div>
      </div>
    </article>
  );
}
