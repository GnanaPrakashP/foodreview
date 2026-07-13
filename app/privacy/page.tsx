import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", padding: "24px 20px 80px" }}>
      <Link href="/me" style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--muted)", textDecoration: "none", marginBottom: "24px", fontFamily: "'DM Sans', sans-serif" }}>
        ← Back
      </Link>
      <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: "24px", color: "var(--cream)", marginBottom: "8px" }}>
        Privacy Policy
      </h1>
      <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "28px", fontFamily: "'DM Sans', sans-serif" }}>
        Last updated: July 14, 2026
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px", fontSize: "14px", color: "var(--muted)", lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif" }}>
        <section>
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>What we collect</h2>
          <p>CircleBites processes account and profile details, email, posts, photos, short videos, dish and restaurant selections, optional location, Circle relationships, blocks and reports, private Memory participants, messages, media and voice notes, notification preferences, push tokens, and privacy-filtered operational diagnostics.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>How we use it</h2>
          <p>We use this data to authenticate you, provide visibility-aware sharing and Memories, recommend food, deliver notifications, prevent abuse, moderate reports, provide support and operate the service. We do not sell personal data.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Permissions and local storage</h2>
          <p>Location, camera, photo-library, microphone and notification permissions are requested only when you choose related features. The app stores owner-scoped caches, pending uploads and drafts for offline use and recovery. These files use non-backed-up cache storage, Android app backup is disabled, and account-ending transitions clear the active owner data; operating-system caches and already issued short-lived links may remain briefly.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Sharing, processors and diagnostics</h2>
          <p>Circle and Just me media use access-controlled Storage, and Memories are limited to current participants subject to blocking and deletion rules. Supabase provides authentication, database and Storage services; Expo provides push and build services; Sentry receives privacy-filtered crash and performance diagnostics; restaurant, processing and moderation providers receive bounded requests when used. Telemetry excludes private content, media paths, signed URLs, push tokens and account identifiers.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Retention and moderation</h2>
          <p>Active content remains until deletion or moderation. Temporary uploads, operational records and local caches use bounded retention. Reports, security records and encrypted provider backups may remain for their documented period where needed for recovery, fraud prevention or legal obligations.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Deleting your data</h2>
          <p>Request deletion from Profile &gt; Settings &gt; Security &amp; Account. After acceptance, the app signs out and a retryable background process removes owned database records and media. Some safety records and encrypted backups may remain until their stated retention expires. Contact support if deletion remains pending.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Children and choices</h2>
          <p>CircleBites is not intended for children under 13. You may deny optional permissions, change notifications, remove content, leave Memories, block accounts and request deletion.</p>
        </section>
        <section>
          <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "15px", color: "var(--cream)", marginBottom: "8px" }}>Contact</h2>
          <p>Privacy: privacy@circlebites.in. Support and deletion help: hello@circlebites.in.</p>
        </section>
      </div>
    </div>
  );
}
