import Link from "next/link";

export default function NotFound() {
  return (
    <div
      className="flex flex-col items-center gap-4 py-20 text-center px-5"
      style={{ background: "var(--bg)", minHeight: "100vh" }}
    >
      <span style={{ fontSize: "56px" }}>🍕</span>
      <h2
        style={{
          fontFamily: "'Syne', sans-serif",
          fontSize: "20px",
          fontWeight: 800,
          color: "var(--cream)",
        }}
      >
        Page not found
      </h2>
      <p style={{ fontSize: "14px", color: "var(--muted)" }}>
        This page doesn&apos;t exist or was removed.
      </p>
      <Link href="/">
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
          Back home →
        </button>
      </Link>
    </div>
  );
}
