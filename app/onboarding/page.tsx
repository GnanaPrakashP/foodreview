"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { DEFAULT_ACCOUNT_TYPE } from "@/lib/circle";

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pre-fill from Google user metadata
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const full = user.user_metadata?.full_name || user.user_metadata?.name || "";
      const parts = full.trim().split(" ");
      if (parts[0]) setFirstName(parts[0]);
      if (parts.length > 1) setLastName(parts.slice(1).join(" "));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced username availability check
  useEffect(() => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);

    const raw = username.trim();
    if (!raw) { setUsernameStatus("idle"); return; }
    if (!USERNAME_REGEX.test(raw)) { setUsernameStatus("invalid"); return; }

    setUsernameStatus("checking");
    checkTimerRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from("profiles" as never)
        .select("id")
        .eq("username", raw)
        .maybeSingle();
      setUsernameStatus(data ? "taken" : "available");
    }, 500);

    return () => {
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fn = firstName.trim();
    const ln = lastName.trim();
    const un = username.trim();

    if (!fn || !ln || !un) return;
    if (usernameStatus !== "available") return;

    setSubmitting(true);
    setErrorMsg("");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const fullName = `${fn} ${ln}`;

    // Insert profile row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: profileError } = await (supabase as any)
      .from("profiles")
      .insert({ id: user.id, first_name: fn, last_name: ln, username: un, account_type: DEFAULT_ACCOUNT_TYPE });

    if (profileError) {
      if (profileError.code === "23505") {
        setErrorMsg("That username was just taken. Try another.");
        setUsernameStatus("taken");
      } else {
        setErrorMsg(profileError.message);
      }
      setSubmitting(false);
      return;
    }

    // Save to user metadata so middleware / AuthSync can read it
    await supabase.auth.updateUser({
      data: { full_name: fullName, username: un, account_type: DEFAULT_ACCOUNT_TYPE, onboarding_complete: true },
    });

    // Also update localStorage immediately
    localStorage.setItem("fc_my_name", fullName);

    router.push("/");
    router.refresh();
  }

  const canSubmit =
    firstName.trim() &&
    lastName.trim() &&
    usernameStatus === "available" &&
    !submitting;

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
      {/* Wordmark */}
      <div style={{ textAlign: "center", marginBottom: "28px" }}>
        <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "28px", color: "var(--orange)" }}>
          CircleBites
        </p>
        <p style={{ fontSize: "13px", color: "var(--muted)", marginTop: "4px", fontFamily: "'DM Sans', sans-serif" }}>
          One last step
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
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "20px", color: "var(--cream)", marginBottom: "6px" }}>
          Set up your profile
        </h1>
        <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "24px", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5 }}>
          Your name and username let your friends find you.
        </p>

        <form onSubmit={handleSubmit}>
          {/* First + last name row */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
            <div style={fieldWrap}>
              <input
                type="text"
                placeholder="First name"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                required
                style={inputStyle}
              />
            </div>
            <div style={fieldWrap}>
              <input
                type="text"
                placeholder="Last name"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                required
                style={inputStyle}
              />
            </div>
          </div>

          {/* Username */}
          <div style={{
            ...fieldWrap,
            marginBottom: "6px",
            border: `1px solid ${
              usernameStatus === "available" ? "rgba(61,214,140,0.5)" :
              usernameStatus === "taken" || usernameStatus === "invalid" ? "#E84040" :
              "var(--border)"
            }`,
          }}>
            <span style={{ fontSize: "14px", color: "var(--muted)", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>@</span>
            <input
              type="text"
              placeholder="username"
              value={username}
              onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
              maxLength={20}
              required
              style={{ ...inputStyle, paddingLeft: "2px" }}
            />
            <span style={{ flexShrink: 0, fontSize: "16px" }}>
              {usernameStatus === "checking" && <span style={{ color: "var(--muted)" }}>⏳</span>}
              {usernameStatus === "available" && <span style={{ color: "#3DD68C" }}>✓</span>}
              {usernameStatus === "taken" && <span style={{ color: "#E84040" }}>✗</span>}
              {usernameStatus === "invalid" && <span style={{ color: "#E84040" }}>✗</span>}
            </span>
          </div>

          {/* Username hint */}
          <p style={{
            fontSize: "11px",
            marginBottom: "16px",
            fontFamily: "'DM Sans', sans-serif",
            color:
              usernameStatus === "available" ? "#3DD68C" :
              usernameStatus === "taken" ? "#E84040" :
              usernameStatus === "invalid" ? "#E84040" :
              "var(--muted)",
          }}>
            {usernameStatus === "available" && "✓ Username is available"}
            {usernameStatus === "taken" && "✗ Username is already taken"}
            {usernameStatus === "invalid" && "3–20 characters: lowercase letters, numbers, underscore only"}
            {(usernameStatus === "idle" || usernameStatus === "checking") &&
              "3–20 characters: lowercase letters, numbers, underscore"}
          </p>

          {errorMsg && (
            <p style={{ fontSize: "12px", color: "#E84040", marginBottom: "12px", fontFamily: "'DM Sans', sans-serif" }}>
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              width: "100%",
              background: canSubmit ? "var(--orange)" : "var(--surface)",
              color: canSubmit ? "#fff" : "var(--muted)",
              border: "none",
              borderRadius: "14px",
              padding: "14px",
              fontFamily: "'Syne', sans-serif",
              fontSize: "15px",
              fontWeight: 700,
              cursor: canSubmit ? "pointer" : "default",
              transition: "all 0.15s",
              boxShadow: canSubmit ? "0 4px 16px rgba(240,96,48,0.3)" : "none",
            }}
          >
            {submitting ? "Saving…" : "Let's go →"}
          </button>
        </form>
      </div>
    </div>
  );
}

const fieldWrap: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: "6px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "14px",
  padding: "12px 14px",
  transition: "border-color 0.15s",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  outline: "none",
  color: "var(--cream)",
  fontSize: "15px",
  fontFamily: "'DM Sans', sans-serif",
  minWidth: 0,
};
