import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", padding: "24px 20px 80px" }}>
      <Link href="/me" style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--muted)", textDecoration: "none", marginBottom: "24px", fontFamily: "'DM Sans', sans-serif" }}>
        ← Back
      </Link>
      <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "24px", color: "var(--cream)", marginBottom: "8px" }}>
        Privacy Policy
      </h1>
      <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "28px", fontFamily: "'DM Sans', sans-serif" }}>
        Last updated: May 2025
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px", fontSize: "14px", color: "var(--muted)", lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif" }}>
        <section>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>What we collect</h2>
          <p>We collect your name, email address, and the food reviews you post. Photos you upload are stored securely. We do not sell your data to any third party.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>How we use it</h2>
          <p>Your data is used solely to power the FoodCircle experience — showing your reviews to your circle and letting you discover what friends are eating.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Deleting your data</h2>
          <p>You can delete your account at any time from the Me tab. This permanently removes your profile and all your reviews from our systems.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Contact</h2>
          <p>Questions? Email us at privacy@foodcircle.app</p>
        </section>
      </div>
    </div>
  );
}
