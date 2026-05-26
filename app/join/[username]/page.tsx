import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

function avatarColor(name: string): string {
  const gradients = [
    "linear-gradient(135deg,#F06030,#C04020)",
    "linear-gradient(135deg,#6366F1,#4F46E5)",
    "linear-gradient(135deg,#3DD68C,#22C55E)",
    "linear-gradient(135deg,#E8A830,#D4821A)",
    "linear-gradient(135deg,#EC4899,#BE185D)",
    "linear-gradient(135deg,#14B8A6,#0F766E)",
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return gradients[hash % gradients.length];
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const inviterName = decodeURIComponent(username);

  const supabase = await createClient();

  const { count } = await supabase
    .from("reviews")
    .select("id", { count: "exact", head: true })
    .eq("reviewer_name", inviterName);

  const places = count ?? 0;

  const initials = inviterName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      style={{
        background: "var(--bg)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        textAlign: "center",
      }}
    >
      {/* Logo wordmark */}
      <p
        style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: "13px",
          fontWeight: 800,
          color: "var(--orange)",
          letterSpacing: "2px",
          textTransform: "uppercase",
          marginBottom: "40px",
        }}
      >
        CircleBites
      </p>

      {/* Avatar */}
      <div
        style={{
          width: "80px",
          height: "80px",
          borderRadius: "50%",
          background: avatarColor(inviterName),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "28px",
          fontWeight: 800,
          color: "white",
          marginBottom: "20px",
        }}
      >
        {initials || "?"}
      </div>

      {/* Headline */}
      <h1
        style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: "26px",
          color: "var(--cream)",
          lineHeight: 1.3,
          marginBottom: "8px",
          maxWidth: "320px",
        }}
      >
        <span style={{ fontStyle: "italic", color: "var(--orange)" }}>{inviterName}</span>
        {" "}invited you to their food circle
      </h1>

      {/* Subtitle */}
      {places > 0 ? (
        <p style={{ fontSize: "14px", color: "var(--muted)", marginBottom: "36px", lineHeight: 1.5 }}>
          {inviterName.split(" ")[0]} has tried{" "}
          <strong style={{ color: "var(--cream)" }}>{places}</strong>{" "}
          {places === 1 ? "place" : "places"} — see their picks when you join.
        </p>
      ) : (
        <p style={{ fontSize: "14px", color: "var(--muted)", marginBottom: "36px", lineHeight: 1.5 }}>
          Join CircleBites to see what your friends are eating.
        </p>
      )}

      {/* Feature pills */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
          justifyContent: "center",
          marginBottom: "36px",
          maxWidth: "320px",
        }}
      >
        {["📍 Track your spots", "👥 See friends' picks", "🔥 Discover trending"].map((f) => (
          <span
            key={f}
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "20px",
              padding: "6px 12px",
              fontSize: "12px",
              color: "var(--muted)",
              fontWeight: 500,
            }}
          >
            {f}
          </span>
        ))}
      </div>

      {/* CTA */}
      <Link href="/reviews/new" style={{ width: "100%", maxWidth: "320px", display: "block" }}>
        <button
          style={{
            width: "100%",
            background: "var(--orange)",
            color: "white",
            border: "none",
            borderRadius: "16px",
            padding: "16px",
            fontFamily: "'Syne', sans-serif",
            fontSize: "16px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Join CircleBites →
        </button>
      </Link>

      <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "14px" }}>
        Free · No account needed · Just log your food
      </p>
    </div>
  );
}
