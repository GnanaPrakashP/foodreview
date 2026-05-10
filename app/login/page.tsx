"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

type View   = "sign_in" | "sign_up" | "forgot";
type Status = "idle" | "loading" | "success" | "error";

/* ─────────────────────────────────────────────────── */
/*  Page                                               */
/* ─────────────────────────────────────────────────── */

export default function LoginPage() {
  const router   = useRouter();

  const [view,            setView]            = useState<View>("sign_in");
  const [email,           setEmail]           = useState("");
  const [password,        setPassword]        = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwd,         setShowPwd]         = useState(false);
  const [status,          setStatus]          = useState<Status>("idle");
  const [errorMsg,        setErrorMsg]        = useState("");
  const [googleLoading,   setGoogleLoading]   = useState(false);

  function reset(nextView: View) {
    setView(nextView);
    setStatus("idle");
    setErrorMsg("");
    setPassword("");
    setConfirmPassword("");
  }

  /* ── Google ── */
  async function handleGoogle() {
    setGoogleLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) { setErrorMsg(error.message); setGoogleLoading(false); }
  }

  /* ── Sign In ── */
  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading"); setErrorMsg("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setErrorMsg(error.message); setStatus("error"); }
    else        { router.push("/"); router.refresh(); }
  }

  /* ── Sign Up ── */
  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) { setErrorMsg("Passwords don't match."); setStatus("error"); return; }
    if (password.length < 8)          { setErrorMsg("Password must be at least 8 characters."); setStatus("error"); return; }
    setStatus("loading"); setErrorMsg("");
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error)          { setErrorMsg(error.message); setStatus("error"); }
    else if (data.session) { router.push("/onboarding"); router.refresh(); }
    else                   { setStatus("success"); }
  }

  /* ── Forgot ── */
  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading"); setErrorMsg("");
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
    });
    if (error) { setErrorMsg(error.message); setStatus("error"); }
    else        { setStatus("success"); }
  }

  /* ── Success screens ── */
  if ((view === "sign_up" || view === "forgot") && status === "success") {
    const isSignUp = view === "sign_up";
    return (
      <Shell>
        <Card style={{ textAlign: "center", padding: "40px 28px" }}>
          <div style={iconBox("#3DD68C", "rgba(61,214,140,0.15)")}>
            <span style={{ fontSize: "28px" }}>📬</span>
          </div>
          <h2 style={h2}>
            {isSignUp ? "Confirm your email" : "Check your inbox"}
          </h2>
          <p style={mutedText}>
            We sent a {isSignUp ? "confirmation link" : "password reset link"} to{" "}
            <span style={{ color: "var(--cream)", fontWeight: 600 }}>{email}</span>.
            {isSignUp && " Click it to activate your account, then sign in."}
          </p>
          <GhostBtn onClick={() => reset("sign_in")} style={{ marginTop: 20 }}>
            ← Back to Sign In
          </GhostBtn>
        </Card>
      </Shell>
    );
  }

  /* ── Forgot form ── */
  if (view === "forgot") {
    return (
      <Shell>
        <Hero />
        <Card>
          <button onClick={() => reset("sign_in")} style={backBtn}>
            ← Back to Sign In
          </button>
          <h2 style={h2}>Reset password</h2>
          <p style={{ ...mutedText, marginBottom: 20 }}>
            Enter your email and we&apos;ll send a reset link.
          </p>
          <form onSubmit={handleForgot}>
            <EmailField value={email} onChange={setEmail} hasError={status === "error"}
              onFocus={() => status === "error" && setStatus("idle")} />
            {status === "error" && <ErrMsg>{errorMsg}</ErrMsg>}
            <OrangeBtn disabled={status === "loading" || !email.trim()}>
              {status === "loading" ? "Sending…" : "Send reset link →"}
            </OrangeBtn>
          </form>
        </Card>
      </Shell>
    );
  }

  /* ── Main form ── */
  return (
    <Shell>
      <Hero />

      <Card>
        {/* Tab switcher */}
        <div style={tabBar}>
          {(["sign_in", "sign_up"] as View[]).map(v => (
            <button key={v} onClick={() => reset(v)} style={tabBtn(view === v)}>
              {v === "sign_in" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>

        {/* Google */}
        <GoogleBtn onClick={handleGoogle} loading={googleLoading} />

        {/* Divider */}
        <Divider />

        {/* Email form */}
        <form onSubmit={view === "sign_in" ? handleSignIn : handleSignUp}>
          <EmailField value={email} onChange={setEmail} hasError={status === "error"}
            onFocus={() => status === "error" && setStatus("idle")} />

          <PwdField value={password} onChange={setPassword} show={showPwd}
            onToggle={() => setShowPwd(v => !v)}
            placeholder={view === "sign_in" ? "Password" : "Password (min. 8 chars)"}
            hasError={status === "error"}
            onFocus={() => status === "error" && setStatus("idle")} />

          {view === "sign_up" && (
            <PwdField value={confirmPassword} onChange={setConfirmPassword} show={showPwd}
              onToggle={() => setShowPwd(v => !v)}
              placeholder="Confirm password"
              hasError={status === "error"}
              onFocus={() => status === "error" && setStatus("idle")} />
          )}

          {status === "error" && <ErrMsg>{errorMsg}</ErrMsg>}

          {view === "sign_in" && (
            <div style={{ textAlign: "right", marginBottom: 14, marginTop: -2 }}>
              <button type="button" onClick={() => { setView("forgot"); setStatus("idle"); setErrorMsg(""); }}
                style={forgotLink}>
                Forgot password?
              </button>
            </div>
          )}

          <OrangeBtn disabled={status === "loading" || !email.trim() || !password.trim()}>
            {status === "loading"
              ? (view === "sign_in" ? "Signing in…" : "Creating account…")
              : (view === "sign_in" ? "Sign In →" : "Create Account →")}
          </OrangeBtn>
        </form>

        {view === "sign_up" && (
          <p style={{ ...mutedText, fontSize: 11, textAlign: "center", marginTop: 16 }}>
            By signing up you agree to our Terms of Service.
          </p>
        )}
      </Card>
    </Shell>
  );
}

/* ─────────────────────────────────────────────────── */
/*  Layout atoms                                       */
/* ─────────────────────────────────────────────────── */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: `
        radial-gradient(ellipse 120% 45% at 50% 0%, var(--orange-dim) 0%, transparent 65%),
        var(--bg)
      `,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "32px 20px 56px",
      gap: "24px",
    }}>
      {children}
    </div>
  );
}

/* ── Hero ── */
function Hero() {
  return (
    <div style={{ textAlign: "center", width: "100%", maxWidth: 400 }}>
      {/* App icon */}
      <div style={{
        width: 86, height: 86, margin: "0 auto 18px",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <img
          src="/favicon.ico"
          alt="CircleBites logo"
          width={72}
          height={72}
          style={{ display: "block", borderRadius: 16 }}
        />
      </div>

      {/* Wordmark */}
      <h1 style={{
        fontFamily: "'Syne', sans-serif",
        fontWeight: 800,
        fontSize: 34,
        color: "var(--cream)",
        letterSpacing: "-0.5px",
        marginBottom: 6,
        lineHeight: 1,
      }}>
        CircleBites
      </h1>

      {/* Tagline */}
      <p style={{
        fontFamily: "'Syne', sans-serif",
        fontStyle: "italic",
        fontSize: 18,
        color: "var(--orange)",
        letterSpacing: "0.1px",
      }}>
        What&apos;s your circle eating?
      </p>
    </div>
  );
}

/* ── Card ── */
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      width: "100%",
      maxWidth: 400,
      background: "var(--auth-card)",
      border: "1px solid var(--auth-border)",
      borderRadius: 28,
      padding: "28px 24px",
      backdropFilter: "blur(24px)",
      WebkitBackdropFilter: "blur(24px)",
      boxShadow: "var(--auth-shadow)",
      ...style,
    }}>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────── */
/*  Form atoms                                         */
/* ─────────────────────────────────────────────────── */

function EmailField({ value, onChange, hasError, onFocus }: {
  value: string; onChange: (v: string) => void; hasError: boolean; onFocus: () => void;
}) {
  return (
    <label style={inputWrap(hasError)}>
      <MailIcon />
      <input type="email" placeholder="your@email.com" value={value}
        onChange={e => onChange(e.target.value)} onFocus={onFocus}
        autoComplete="email" required style={inputBase} />
    </label>
  );
}

function PwdField({ value, onChange, show, onToggle, placeholder, hasError, onFocus }: {
  value: string; onChange: (v: string) => void; show: boolean;
  onToggle: () => void; placeholder: string; hasError: boolean; onFocus: () => void;
}) {
  return (
    <label style={inputWrap(hasError)}>
      <LockIcon />
      <input type={show ? "text" : "password"} placeholder={placeholder}
        value={value} onChange={e => onChange(e.target.value)} onFocus={onFocus}
        autoComplete="current-password" required style={inputBase} />
      <button type="button" onClick={onToggle} style={toggleBtn}>
        {show ? "Hide" : "Show"}
      </button>
    </label>
  );
}

function GoogleBtn({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} type="button" style={{
      width: "100%",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
      background: loading ? "var(--oauth-disabled)" : "var(--oauth-bg)",
      border: "1px solid var(--auth-border)",
      borderRadius: 14,
      padding: "13px 16px",
      fontSize: 14,
      fontWeight: 700,
      color: "var(--oauth-text)",
      cursor: loading ? "default" : "pointer",
      opacity: loading ? 0.75 : 1,
      fontFamily: "'DM Sans', sans-serif",
      transition: "opacity 0.15s",
      boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
      marginBottom: 16,
      letterSpacing: "0.1px",
    }}>
      {loading ? <span style={{ fontSize: 16 }}>⏳</span> : <GoogleLogo />}
      {loading ? "Redirecting…" : "Continue with Google"}
    </button>
  );
}

function OrangeBtn({ children, disabled, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="submit" disabled={disabled} style={{
      width: "100%",
      background: disabled ? "var(--surface)" : "linear-gradient(135deg, var(--orange) 0%, #D84E22 100%)",
      color: disabled ? "var(--muted)" : "#fff",
      border: disabled ? "1px solid var(--border)" : "none",
      borderRadius: 14,
      padding: "14px 16px",
      fontFamily: "'Syne', sans-serif",
      fontSize: 15,
      fontWeight: 700,
      cursor: disabled ? "default" : "pointer",
      transition: "all 0.15s",
      boxShadow: disabled ? "none" : "0 6px 20px rgba(240,96,48,0.35)",
      letterSpacing: "0.2px",
      marginTop: 4,
    }} {...rest}>
      {children}
    </button>
  );
}

function GhostBtn({ children, onClick, style }: { children: React.ReactNode; onClick?: () => void; style?: React.CSSProperties }) {
  return (
    <button onClick={onClick} type="button" style={{
      width: "100%",
      background: "transparent",
      border: "1.5px solid var(--auth-border)",
      borderRadius: 14,
      padding: "12px 16px",
      color: "var(--muted)",
      fontSize: 14,
      fontWeight: 600,
      cursor: "pointer",
      fontFamily: "'DM Sans', sans-serif",
      transition: "border-color 0.15s",
      ...style,
    }}>
      {children}
    </button>
  );
}

function Divider() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <div style={{ flex: 1, height: 1, background: "var(--auth-divider)" }} />
      <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", letterSpacing: "0.5px" }}>OR</span>
      <div style={{ flex: 1, height: 1, background: "var(--auth-divider)" }} />
    </div>
  );
}

function ErrMsg({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      background: "rgba(232,64,64,0.08)",
      border: "1px solid rgba(232,64,64,0.25)",
      borderRadius: 10,
      padding: "9px 12px",
      marginBottom: 10,
    }}>
      <span style={{ fontSize: 13, flexShrink: 0 }}>⚠️</span>
      <p style={{ fontSize: 12, color: "#E84040", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.4 }}>
        {children}
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────── */
/*  Small icon helpers                                 */
/* ─────────────────────────────────────────────────── */

function iconBox(color: string, bg: string): React.CSSProperties {
  return {
    width: 68, height: 68, margin: "0 auto 16px",
    background: bg, border: `1.5px solid ${color}40`,
    borderRadius: 20,
    display: "flex", alignItems: "center", justifyContent: "center",
  };
}

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908C16.658 14.013 17.64 11.705 17.64 9.2Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  );
}

/* ─────────────────────────────────────────────────── */
/*  Shared styles                                      */
/* ─────────────────────────────────────────────────── */

const h2: React.CSSProperties = {
  fontFamily: "'Syne', sans-serif",
  fontWeight: 800,
  fontSize: 20,
  color: "var(--cream)",
  marginBottom: 8,
  marginTop: 12,
};

const mutedText: React.CSSProperties = {
  fontSize: 13,
  color: "var(--muted)",
  lineHeight: 1.6,
  fontFamily: "'DM Sans', sans-serif",
};

const tabBar: React.CSSProperties = {
  display: "flex",
  background: "var(--auth-tab)",
  borderRadius: 12,
  padding: 4,
  gap: 4,
  marginBottom: 20,
  border: "1px solid var(--auth-border)",
};

function tabBtn(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "9px 0",
    borderRadius: 8,
    background: active ? "var(--card)" : "transparent",
    border: active ? "1px solid var(--auth-border)" : "1px solid transparent",
    color: active ? "var(--cream)" : "var(--muted)",
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s",
    letterSpacing: "0.2px",
  };
}

function inputWrap(hasError: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "var(--auth-field)",
    border: `1px solid ${hasError ? "rgba(232,64,64,0.6)" : "var(--auth-border)"}`,
    borderRadius: 14,
    padding: "13px 14px",
    marginBottom: 10,
    transition: "border-color 0.15s",
    cursor: "text",
  };
}

const inputBase: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  outline: "none",
  color: "var(--cream)",
  fontSize: 15,
  fontFamily: "'DM Sans', sans-serif",
  minWidth: 0,
};

const toggleBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--muted)",
  fontSize: 12,
  fontWeight: 600,
  flexShrink: 0,
  lineHeight: 1,
  fontFamily: "'DM Sans', sans-serif",
  letterSpacing: "0.3px",
};

const forgotLink: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--orange)",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "'DM Sans', sans-serif",
  fontWeight: 500,
  padding: 0,
};

const backBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--muted)",
  fontSize: 13,
  cursor: "pointer",
  padding: "0 0 14px",
  fontFamily: "'DM Sans', sans-serif",
  display: "block",
};
