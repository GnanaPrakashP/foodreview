import ReviewForm from "@/components/reviews/ReviewForm";
import Link from "next/link";

export default function NewReviewPage() {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      {/* Header */}
      <div className="px-5 pt-6 pb-4" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <h1
          style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: "20px",
            fontWeight: 800,
            color: "var(--cream)",
          }}
        >
          Share a spot
        </h1>
        <Link href="/stories/new" style={{ color: "var(--orange)", fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 700, textDecoration: "none" }}>
          Add story
        </Link>
      </div>

      <ReviewForm />
    </div>
  );
}
