import Link from "next/link";

export default function DeleteAccountPage() {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", padding: "24px 20px 80px" }}>
      <h1 style={{ color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: "24px", fontWeight: 800 }}>Delete your CircleBites account</h1>
      <div style={{ color: "var(--muted)", display: "flex", flexDirection: "column", fontFamily: "'DM Sans', sans-serif", fontSize: "14px", gap: "16px", lineHeight: 1.7, marginTop: "20px" }}>
        <p>In the mobile app, open Profile &gt; Settings &gt; Security &amp; Account &gt; Delete account. Review the warning and confirm the request. The app signs out after the server accepts it.</p>
        <p>A retryable background process removes account-owned database records and media. Some safety records and encrypted provider backups may remain for their documented retention period. If the request remains pending or you cannot sign in, contact <a href="mailto:hello@circlebites.in">hello@circlebites.in</a> from the account email.</p>
        <p><Link href="/privacy">Read the Privacy Policy</Link> for the complete retention description.</p>
      </div>
    </div>
  );
}
