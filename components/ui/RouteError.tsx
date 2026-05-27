"use client";

type RouteErrorProps = {
  title?: string;
  reset: () => void;
};

export default function RouteError({ title = "Something went wrong", reset }: RouteErrorProps) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--cream)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 360, textAlign: "center" }}>
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 22, fontWeight: 800, marginBottom: 8 }}>
          {title}
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.5, marginBottom: 18 }}>
          The page could not load cleanly.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            border: "none",
            borderRadius: 12,
            background: "var(--orange)",
            color: "white",
            cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 14,
            fontWeight: 700,
            padding: "11px 16px",
          }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
