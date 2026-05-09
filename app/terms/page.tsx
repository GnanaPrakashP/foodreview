import Link from "next/link";

export default function TermsPage() {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", padding: "24px 20px 80px" }}>
      <Link href="/me" style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--muted)", textDecoration: "none", marginBottom: "24px", fontFamily: "'DM Sans', sans-serif" }}>
        ← Back
      </Link>
      <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "24px", color: "var(--cream)", marginBottom: "8px" }}>
        Terms of Service
      </h1>
      <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "28px", fontFamily: "'DM Sans', sans-serif" }}>
        Last updated: May 2025
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px", fontSize: "14px", color: "var(--muted)", lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif" }}>
        <section>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Using CircleBites</h2>
          <p>CircleBites is a private food journal for you and your friends. You must be 13 or older to use the app. You are responsible for the content you post.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Your content</h2>
          <p>You own what you post. By sharing a review you grant CircleBites a licence to display it to your circle. We will never use your content for advertising without your consent.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Acceptable use</h2>
          <p>Don&apos;t post spam, false information, or content that harms others. We reserve the right to remove content or suspend accounts that violate these terms.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Contact</h2>
          <p>Questions? Email us at hello@foodcircle.app</p>
        </section>
      </div>
    </div>
  );
}
