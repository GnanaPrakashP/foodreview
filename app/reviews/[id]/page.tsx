import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { formatDate } from "@/lib/utils";
import type { Review } from "@/lib/types";
import Link from "next/link";

interface Props {
  params: Promise<{ id: string }>;
}

function restaurantEmoji(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("idli") || n.includes("dosa") || n.includes("tiffin")) return "🥘";
  if (n.includes("ramen") || n.includes("noodle") || n.includes("chinese")) return "🍜";
  if (n.includes("pizza") || n.includes("italiano")) return "🍕";
  if (n.includes("burger") || n.includes("grill")) return "🍔";
  if (n.includes("sushi") || n.includes("japanese")) return "🍱";
  if (n.includes("biryani") || n.includes("mughal") || n.includes("dum")) return "🍛";
  if (n.includes("mess") || n.includes("mutton") || n.includes("chicken") || n.includes("madurai")) return "🍖";
  if (n.includes("cafe") || n.includes("coffee") || n.includes("brew")) return "☕";
  return "🍽️";
}

function avgRating(review: Review): number {
  if (!review.items.length) return 0;
  return review.items.reduce((s, it) => s + it.rating, 0) / review.items.length;
}

const STAR_LABELS: Record<number, string> = {
  1: "Bad",
  2: "Okay",
  3: "Good",
  4: "Great",
  5: "Amazing",
};

export default async function ReviewDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: review } = await supabase
    .from("reviews")
    .select("*")
    .eq("id", id)
    .single<Review>();

  if (!review) notFound();

  const rating = avgRating(review);

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      {/* Sender row */}
      <div className="px-4 pt-5 pb-3 flex items-center gap-3">
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
        <div className="flex-1">
          <p style={{ fontSize: "14px", fontWeight: 500, color: "var(--cream)" }}>
            {review.reviewer_name} sent you a spot 📍
          </p>
          <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "1px" }}>
            Thought you'd love this one
          </p>
        </div>
        <p style={{ fontSize: "11px", color: "var(--muted)" }}>
          {formatDate(review.created_at)}
        </p>
      </div>

      {/* Card */}
      <div
        style={{
          margin: "0 16px",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "20px",
          overflow: "hidden",
        }}
      >
        {/* Image / emoji hero */}
        <div
          style={{
            height: "200px",
            background: "linear-gradient(160deg, #2A1008 0%, #6B3318 50%, #A04020 100%)",
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {review.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={review.photo_url}
              alt={`Review at ${review.restaurant_name}`}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <span
              style={{
                fontSize: "72px",
                filter: "drop-shadow(0 4px 16px rgba(0,0,0,0.5))",
              }}
            >
              {restaurantEmoji(review.restaurant_name)}
            </span>
          )}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%)",
            }}
          />
          {review.items[0] && (
            <span
              style={{
                position: "absolute",
                bottom: "12px",
                left: "12px",
                background: "rgba(255,255,255,0.1)",
                backdropFilter: "blur(8px)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "white",
                fontSize: "11px",
                fontWeight: 500,
                padding: "4px 10px",
                borderRadius: "20px",
                zIndex: 1,
              }}
            >
              {review.items[0].name}
            </span>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: "14px 14px 0" }}>
          <h1
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: "22px",
              fontWeight: 800,
              color: "var(--cream)",
            }}
          >
            {review.restaurant_name}
          </h1>

          {/* Items */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "12px" }}>
            {review.items.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  background: "var(--surface)",
                  borderRadius: "12px",
                  padding: "10px 12px",
                }}
              >
                <span style={{ fontSize: "14px", color: "var(--cream)", fontWeight: 500 }}>
                  {item.name}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "13px" }}>
                    {"⭐".repeat(item.rating)}{"☆".repeat(5 - item.rating)}
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                    {STAR_LABELS[item.rating]}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Quote */}
          {review.body && (
            <div
              style={{
                marginTop: "12px",
                padding: "12px",
                background: "var(--surface)",
                borderLeft: "3px solid var(--orange)",
                borderRadius: "0 12px 12px 0",
              }}
            >
              <p
                style={{
                  fontFamily: "'Instrument Serif', serif",
                  fontStyle: "italic",
                  fontSize: "16px",
                  color: "var(--cream)",
                  lineHeight: "1.5",
                }}
              >
                "{review.body}"
              </p>
              <p style={{ fontSize: "10px", color: "var(--muted)", marginTop: "5px" }}>
                — {review.reviewer_name}'s honest take
              </p>
            </div>
          )}

          {/* Footer */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "12px" }}>
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
                <span>🏆</span>
                <span style={{ fontSize: "11px", color: "var(--gold)", fontWeight: 600 }}>
                  {rating.toFixed(1)} avg rating
                </span>
              </div>
            )}
            <div style={{ display: "flex", gap: "6px", marginLeft: "auto" }}>
              <Link href="/circle">
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "50%",
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "16px",
                    cursor: "pointer",
                  }}
                >
                  🔖
                </div>
              </Link>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div style={{ padding: "12px 14px 14px" }}>
          <Link href="/">
            <button
              style={{
                width: "100%",
                background: "var(--orange)",
                color: "white",
                border: "none",
                borderRadius: "14px",
                padding: "15px",
                fontFamily: "'Syne', sans-serif",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
            >
              I want to go here →
            </button>
          </Link>
        </div>
      </div>

      {/* Reactions placeholder */}
      <div style={{ padding: "14px 16px" }}>
        <p
          style={{
            fontSize: "10px",
            fontWeight: 600,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "1px",
            marginBottom: "8px",
          }}
        >
          React
        </p>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {["🔥", "🤤", "✅ Been here", "+"].map((r) => (
            <div
              key={r}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "20px",
                padding: "6px 12px",
                fontSize: "13px",
                cursor: "pointer",
                color: "var(--cream)",
              }}
            >
              {r}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
