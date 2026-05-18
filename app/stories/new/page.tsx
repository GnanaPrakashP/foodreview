import Link from "next/link";
import StoryForm from "@/components/stories/StoryForm";

export default function NewStoryPage() {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <div className="px-5 pt-6 pb-4" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <div>
          <p style={{ color: "var(--muted)", fontSize: "13px", fontFamily: "'DM Sans', sans-serif" }}>24-hour update</p>
          <h1
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: "20px",
              fontWeight: 800,
              color: "var(--cream)",
            }}
          >
            Add story
          </h1>
        </div>
        <Link href="/reviews/new" style={{ color: "var(--orange)", fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 700, textDecoration: "none" }}>
          Post review
        </Link>
      </div>

      <StoryForm />
    </div>
  );
}
