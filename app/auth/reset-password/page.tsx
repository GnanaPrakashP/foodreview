"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      setStatus("error");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords don't match.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setErrorMsg("");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
    } else {
      setStatus("success");
      setTimeout(() => { router.push("/"); router.refresh(); }, 1500);
    }
  }

  if (status === "success") {
    return (
      <Page>
        <div style={{ textAlign: "center" }}>
          <span style={{ fontSize: "48px" }}>✅</span>
          <h2 style={headingStyle}>Password updated!</h2>
          <p style={{ fontSize: "13px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>
            Redirecting you to the app…
          </p>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <div style={{ textAlign: "center", marginBottom: "28px" }}>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: "28px", color: "var(--orange)" }}>
          CircleBites
        </p>
      </div>

      <div style={{
        width: "100%",
        maxWidth: "400px",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "24px",
        padding: "28px 24px",
      }}>
        <h1 style={headingStyle}>Set new password</h1>
        <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "20px", fontFamily: "'DM Sans', sans-serif" }}>
          Choose a strong password for your account.
        </p>

        <form onSubmit={handleSubmit}>
          <PasswordField
            value={password}
            onChange={setPassword}
            show={showPassword}
            onToggle={() => setShowPassword(v => !v)}
            placeholder="New password (min. 8 characters)"
            hasError={status === "error"}
            onFocus={() => { if (status === "error") { setStatus("idle"); setErrorMsg(""); } }}
          />
          <PasswordField
            value={confirmPassword}
            onChange={setConfirmPassword}
            show={showPassword}
            onToggle={() => setShowPassword(v => !v)}
            placeholder="Confirm new password"
            hasError={status === "error"}
            onFocus={() => { if (status === "error") { setStatus("idle"); setErrorMsg(""); } }}
          />

          {status === "error" && (
            <p style={{ fontSize: "12px", color: "#E84040", marginBottom: "10px", fontFamily: "'DM Sans', sans-serif" }}>
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={status === "loading" || !password || !confirmPassword}
            style={{
              width: "100%",
              background: password && confirmPassword ? "var(--orange)" : "var(--surface)",
              color: password && confirmPassword ? "#fff" : "var(--muted)",
              border: "none",
              borderRadius: "14px",
              padding: "14px",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px",
              fontWeight: 700,
              cursor: status === "loading" || !password || !confirmPassword ? "default" : "pointer",
              transition: "all 0.15s",
            }}
          >
            {status === "loading" ? "Saving…" : "Update password →"}
          </button>
        </form>
      </div>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px 20px 48px",
    }}>
      {children}
    </div>
  );
}

function PasswordField({ value, onChange, show, onToggle, placeholder, hasError, onFocus }: {
  value: string; onChange: (v: string) => void; show: boolean;
  onToggle: () => void; placeholder: string; hasError: boolean; onFocus: () => void;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "10px",
      background: "var(--surface)",
      border: `1px solid ${hasError ? "#E84040" : "var(--border)"}`,
      borderRadius: "14px",
      padding: "12px 14px",
      marginBottom: "10px",
      transition: "border-color 0.15s",
    }}>
      <span style={{ fontSize: "15px", flexShrink: 0 }}>🔒</span>
      <input
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={onFocus}
        required
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--cream)",
          fontSize: "15px",
          fontFamily: "'DM Sans', sans-serif",
        }}
      />
      <button
        type="button"
        onClick={onToggle}
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: "14px", flexShrink: 0 }}
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

const headingStyle: React.CSSProperties = {
  fontFamily: "'DM Sans', sans-serif",
  fontWeight: 800,
  fontSize: "20px",
  color: "var(--cream)",
  marginBottom: "8px",
  marginTop: "12px",
};
