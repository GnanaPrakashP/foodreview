import Link from "next/link";

export default function SupportPage() {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", padding: "24px 20px 80px" }}>
      <h1 style={{ color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: "24px", fontWeight: 800 }}>CircleBites support</h1>
      <div style={{ color: "var(--muted)", display: "flex", flexDirection: "column", fontFamily: "'DM Sans', sans-serif", fontSize: "14px", gap: "16px", lineHeight: 1.7, marginTop: "20px" }}>
        <p>Email <a href="mailto:hello@circlebites.in">hello@circlebites.in</a> for account access, safety, copyright or deletion help. Never email passwords, authentication codes or unnecessary private content.</p>
        <p>For privacy questions, email <a href="mailto:privacy@circlebites.in">privacy@circlebites.in</a>.</p>
        <p><Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Service</Link> · <Link href="/delete-account">Account deletion</Link></p>
      </div>
    </div>
  );
}
