import ReviewForm from "@/components/reviews/ReviewForm";

export const dynamic = "force-dynamic";

export default function NewReviewPage() {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      {/* Header */}
      <div className="px-5 pt-6 pb-4">
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
      </div>

      <ReviewForm />
    </div>
  );
}
