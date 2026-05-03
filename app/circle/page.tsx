import { createClient } from "@/lib/supabase/server";
import ReviewCard from "@/components/reviews/ReviewCard";
import type { Review } from "@/lib/types";
import Link from "next/link";

export const revalidate = 60;

export default async function CirclePage() {
  const supabase = await createClient();

  const { data: reviews, error } = await supabase
    .from("reviews")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<Review[]>();

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      {/* Header */}
      <div className="px-5 pt-6 pb-4">
        <p
          style={{
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "2px",
            textTransform: "uppercase",
            color: "var(--orange)",
          }}
        >
          Your Circle
        </p>
        <h1
          style={{
            fontFamily: "'Instrument Serif', serif",
            fontSize: "26px",
            color: "var(--cream)",
            marginTop: "4px",
            lineHeight: "1.2",
          }}
        >
          What everyone's been eating
        </h1>
      </div>

      {/* Feed */}
      <div className="px-4 flex flex-col gap-4">
        {error && (
          <p style={{ color: "#EF4444", textAlign: "center", padding: "40px 0", fontSize: "14px" }}>
            Failed to load. Please try again.
          </p>
        )}

        {!error && (!reviews || reviews.length === 0) && (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <span style={{ fontSize: "52px" }}>👥</span>
            <p style={{ color: "var(--muted)", fontSize: "14px" }}>
              Your circle is quiet right now.
            </p>
            <Link href="/reviews/new">
              <button
                style={{
                  background: "var(--orange)",
                  color: "white",
                  border: "none",
                  borderRadius: "14px",
                  padding: "12px 24px",
                  fontFamily: "'Syne', sans-serif",
                  fontSize: "14px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Share first →
              </button>
            </Link>
          </div>
        )}

        {reviews?.map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </div>
    </div>
  );
}
