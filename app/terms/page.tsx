import Link from "next/link";

export default function TermsPage() {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", padding: "24px 20px 80px" }}>
      <Link href="/me" style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--muted)", textDecoration: "none", marginBottom: "24px", fontFamily: "'DM Sans', sans-serif" }}>
        ← Back
      </Link>
      <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: "24px", color: "var(--cream)", marginBottom: "8px" }}>
        Terms of Service
      </h1>
      <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "28px", fontFamily: "'DM Sans', sans-serif" }}>
        Last updated: July 14, 2026
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px", fontSize: "14px", color: "var(--muted)", lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif" }}>
        <section>
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Using CircleBites</h2>
          <p>CircleBites lets people share food reviews and private Memories. You must be at least 13 and legally able to use the service. Keep your account secure and provide accurate registration information.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Your content</h2>
          <p>You retain rights you have in your content. You grant CircleBites a limited licence to host, process, reproduce and display it only as needed to operate, secure and improve the service according to the visibility you select. You must have permission to upload it.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Acceptable use</h2>
          <p>Do not upload unlawful, infringing, deceptive, abusive or unsafe content; impersonate others; scrape the service; bypass access controls; or misuse reports, notifications or private rooms. We may restrict content or accounts to enforce these rules and protect users.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Moderation and reporting</h2>
          <p>Users can report content and block accounts. Automated providers and authorised operators may review bounded content for safety. Decisions may be delayed, corrected or appealed through support where an appeal route is available.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Service availability</h2>
          <p>Features and third-party services may change or be unavailable. We do not promise uninterrupted operation or that recommendations, restaurant details or user content are accurate. Use your own judgment for allergies, health and safety decisions.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Ending use and complaints</h2>
          <p>You may stop using CircleBites or request account deletion in Settings. We may suspend access for serious or repeated violations. Send copyright, safety or policy complaints with enough information to investigate to hello@circlebites.in.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Contact</h2>
          <p>Questions and support: hello@circlebites.in. These terms require qualified legal review before store submission.</p>
        </section>
      </div>
    </div>
  );
}
