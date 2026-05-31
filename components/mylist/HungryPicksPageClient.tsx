"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, PackageOpen, Star, Store } from "lucide-react";
import { reviewMediaItems } from "@/lib/review-media";
import type { Comment, Review } from "@/lib/types";

const PICK_CARD_IMAGE_WIDTH = 116;
const PICK_CARD_IMAGE_HEIGHT = 145;

type HungryPicksResponse = {
  reviews: Review[];
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  likedByMeMap: Record<string, boolean>;
  bookmarkedPostMap: Record<string, boolean>;
  profileMap: Record<string, string>;
  myName: string;
  error?: string;
};

function firstImageUrl(review: Review): string | null {
  return reviewMediaItems(review).find((item) => item.media_type === "image")?.public_url ?? null;
}

function ratingLabel(rating: number): string {
  if (!Number.isFinite(rating) || rating <= 0) return "";
  return Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
}

function DishRating({ rating }: { rating: number }) {
  const label = ratingLabel(rating);
  if (!label) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, background: "rgba(232,168,48,0.15)", border: "1px solid rgba(232,168,48,0.25)", borderRadius: 5, padding: "1px 5px", color: "var(--gold)", flexShrink: 0 }}>
      <Star size={8} strokeWidth={0} fill="currentColor" />
      <span style={{ fontSize: 10, fontWeight: 700, lineHeight: 1 }}>{label}</span>
    </span>
  );
}

function HungryPickCard({
  review,
  onRemove,
}: {
  review: Review;
  onRemove: (postId: string) => void;
}) {
  const imageUrl = firstImageUrl(review);
  const dishes = review.items.filter((item) => item.name).slice(0, 3);
  const location = review.area || review.restaurant_address || "";
  const caption = review.body?.trim() ?? "";

  return (
    <Link
      href={`/reviews/${encodeURIComponent(review.id)}`}
      style={{
        textDecoration: "none",
        display: "grid",
        gridTemplateColumns: `${PICK_CARD_IMAGE_WIDTH}px 1fr`,
        minHeight: PICK_CARD_IMAGE_HEIGHT,
        color: "inherit",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        overflow: "hidden",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          background: imageUrl ? undefined : "linear-gradient(135deg, rgba(240,96,48,0.18), rgba(232,168,48,0.10))",
          backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          minHeight: PICK_CARD_IMAGE_HEIGHT,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!imageUrl && <Store size={24} strokeWidth={2.1} color="var(--orange)" />}
      </div>

      <div style={{ padding: 14, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 17, fontWeight: 700, color: "var(--cream)", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {review.restaurant_name}
            </div>
            {location && (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.72)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {location}
              </div>
            )}
            {caption && (
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.78)", lineHeight: 1.35, margin: "7px 0 0", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                {caption}
              </p>
            )}
          </div>
        </div>

        {dishes.length > 0 && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 9 }}>
            {dishes.map((dish) => (
              <span
                key={dish.name}
                style={{
                  fontSize: 10,
                  color: "var(--cream)",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: "3px 8px",
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dish.name}</span>
                <DishRating rating={dish.rating} />
              </span>
            ))}
          </div>
        )}

        <div style={{ marginTop: "auto", paddingTop: 9, borderTop: "1px solid rgba(255,255,255,0.16)", display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove(review.id);
            }}
            style={{ alignSelf: "flex-start", border: "1px solid rgba(34,197,94,0.35)", background: "rgba(34,197,94,0.12)", color: "#4ADE80", borderRadius: 999, padding: "7px 11px", fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 800, cursor: "pointer" }}
          >
            Tried it
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove(review.id);
            }}
            style={{ alignSelf: "flex-start", border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.10)", color: "#EF4444", borderRadius: 999, padding: "7px 11px", fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 800, cursor: "pointer" }}
          >
            Remove
          </button>
        </div>
      </div>
    </Link>
  );
}

export default function HungryPicksPageClient() {
  const router = useRouter();
  const [picks, setPicks] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/hungry/picks", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as HungryPicksResponse : null)
      .then((data) => {
        setPicks(data?.reviews ?? []);
      })
      .catch(() => {
        setPicks([]);
      })
      .finally(() => setLoading(false));
  }, []);

  function markTried(postId: string) {
    setPicks((current) => current.filter((review) => review.id !== postId));
    fetch("/api/hungry/picks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId }),
    }).catch(() => {});
  }

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: 100 }}>
      <div style={{ padding: "16px 20px 24px", display: "flex", alignItems: "center", gap: "12px" }}>
        <button
          onClick={() => router.push("/hungry")}
          aria-label="Back to hungry"
          style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
        >
          <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
        </button>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: "20px", color: "var(--cream)", margin: 0 }}>Lunch Box</h1>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", color: "var(--muted)", marginTop: 2 }}>Right-swiped picks</p>
        </div>
      </div>

      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {loading ? (
          [1, 2, 3, 4].map((item) => <div key={item} style={{ height: PICK_CARD_IMAGE_HEIGHT, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, opacity: 0.5 }} className="animate-pulse" />)
        ) : picks.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
            <PackageOpen size={34} strokeWidth={1.5} color="var(--muted)" />
            <p style={{ fontSize: "14px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>No right-swiped posts yet</p>
          </div>
        ) : (
          picks.map((pick) => (
            <HungryPickCard
              key={pick.id}
              review={pick}
              onRemove={markTried}
            />
          ))
        )}
      </div>
    </div>
  );
}
