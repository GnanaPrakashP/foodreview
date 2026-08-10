"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Stage = "email" | "code";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,189}$/;
const INSTALL_KEY = "circlebites.web.install-id.v1";

function browserInstallId() {
  const current = window.localStorage.getItem(INSTALL_KEY);
  if (current) return current;
  const created = window.crypto.randomUUID();
  window.localStorage.setItem(INSTALL_KEY, created);
  return created;
}

export default function LoginPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function continueWithGoogle() {
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` }
    });
    if (oauthError) {
      setError("We couldn't continue with Google. Please try again.");
      setBusy(false);
    }
  }

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/mobile/auth/email-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Witoh-Install-Id": browserInstallId()
        },
        body: JSON.stringify({ email: normalized })
      });
      if (!response.ok) throw new Error("otp_request_failed");
      setEmail(normalized);
      setStage("code");
    } catch {
      setError("We couldn't send a code right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the six-digit code from your email.");
      return;
    }
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email"
    });
    if (verifyError || !data.session) {
      setError("That code is invalid or expired. Request a new code and try again.");
      setBusy(false);
      return;
    }

    const { data: complete, error: completenessError } = await supabase.rpc("is_profile_complete", {
      p_user_id: data.session.user.id
    } as never);
    if (completenessError) {
      await supabase.auth.signOut({ scope: "local" });
      setError("We couldn't finish signing you in. Please try again.");
      setBusy(false);
      return;
    }

    router.replace(complete ? "/" : "/onboarding");
    router.refresh();
  }

  return (
    <main style={styles.shell}>
      <section style={styles.panel} aria-labelledby="login-heading">
        <div style={styles.brand}>Witoh</div>
        <div style={styles.rule} />

        {stage === "email" ? (
          <>
            <button type="button" onClick={continueWithGoogle} disabled={busy} style={styles.secondaryButton}>
              Continue with Google
            </button>
            <div style={styles.divider}><span style={styles.dividerLine} /><span>or</span><span style={styles.dividerLine} /></div>
            <form onSubmit={sendCode}>
              <h1 id="login-heading" style={styles.heading}>What&apos;s your email?</h1>
              <p style={styles.subheading}>We&apos;ll send you a six-digit verification code.</p>
              <input
                aria-label="Email"
                autoComplete="email"
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                style={styles.input}
                value={email}
              />
              <button disabled={busy || !email.trim()} style={styles.primaryButton}>
                {busy ? "Sending…" : "Send code"}
              </button>
            </form>
          </>
        ) : (
          <form onSubmit={verifyCode}>
            <button type="button" onClick={() => { setStage("email"); setCode(""); setError(""); }} style={styles.backButton}>
              ←
            </button>
            <h1 id="login-heading" style={styles.heading}>Enter verification code</h1>
            <p style={styles.subheading}>Sent to {email}</p>
            <input
              aria-label="Verification code"
              autoComplete="one-time-code"
              autoFocus
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              style={{ ...styles.input, letterSpacing: 12, textAlign: "center" }}
              value={code}
            />
            <button disabled={busy || code.length !== 6} style={styles.primaryButton}>
              {busy ? "Verifying…" : "Verify and continue"}
            </button>
            <button type="button" disabled={busy} onClick={sendCode} style={styles.resendButton}>Resend code</button>
          </form>
        )}

        {error ? <p role="alert" style={styles.error}>{error}</p> : null}
        <p style={styles.legal}>
          By continuing, you agree to our <Link href="/terms">Terms of Service</Link> and acknowledge our <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: { alignItems: "center", background: "var(--bg)", display: "flex", justifyContent: "center", minHeight: "100vh", padding: "24px" },
  panel: { maxWidth: 400, width: "100%" },
  brand: { color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: 34, fontWeight: 800, textAlign: "center" },
  rule: { background: "var(--orange)", borderRadius: 2, height: 3, margin: "12px auto 54px", width: 54 },
  heading: { color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: 22, margin: "0 0 6px" },
  subheading: { color: "var(--muted)", fontSize: 14, lineHeight: 1.5, margin: "0 0 24px" },
  input: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, boxSizing: "border-box", color: "var(--cream)", fontSize: 15, marginBottom: 10, outline: "none", padding: "15px 16px", width: "100%" },
  primaryButton: { background: "var(--orange)", border: 0, borderRadius: 14, color: "white", cursor: "pointer", fontSize: 14, fontWeight: 700, minHeight: 50, width: "100%" },
  secondaryButton: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, color: "var(--cream)", cursor: "pointer", fontSize: 14, fontWeight: 700, minHeight: 50, width: "100%" },
  divider: { alignItems: "center", color: "var(--muted)", display: "flex", fontSize: 12, gap: 12, margin: "18px 0 28px" },
  dividerLine: { background: "var(--border)", flex: 1, height: 1 },
  backButton: { background: "transparent", border: 0, color: "var(--cream)", cursor: "pointer", fontSize: 26, margin: "0 0 32px", padding: 0 },
  resendButton: { background: "transparent", border: 0, color: "var(--orange)", cursor: "pointer", display: "block", fontSize: 13, margin: "18px auto 0" },
  error: { color: "#ff8b8b", fontSize: 13, lineHeight: 1.45, margin: "14px 0 0", textAlign: "center" },
  legal: { color: "var(--muted)", fontSize: 11, lineHeight: 1.55, margin: "44px auto 0", maxWidth: 330, textAlign: "center" }
};
