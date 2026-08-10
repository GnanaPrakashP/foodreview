"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { DEFAULT_ACCOUNT_TYPE } from "@/lib/circle";
import { syncStoredActor } from "@/lib/browser-actor";
import { USERNAME_REGEX } from "@/lib/username";

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";

export default function OnboardingPage() {
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkGenerationRef = useRef(0);

  // Pre-fill from Google user metadata
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const full = user.user_metadata?.full_name || user.user_metadata?.name || "";
      const parts = full.trim().split(" ");
      if (parts[0]) setFirstName(parts[0]);
      if (parts.length > 1) setLastName(parts.slice(1).join(" "));
    });
  }, []);

  // Debounced username availability check
  useEffect(() => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);

    const raw = username.trim();
    if (!raw) { setUsernameStatus("idle"); return; }
    if (!USERNAME_REGEX.test(raw)) { setUsernameStatus("invalid"); return; }

    setUsernameStatus("checking");
    const generation = ++checkGenerationRef.current;
    checkTimerRef.current = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("profiles" as never)
        .select("id")
        .eq("username", raw)
        .maybeSingle();
      if (generation === checkGenerationRef.current) {
        setUsernameStatus(data ? "taken" : "available");
      }
    }, 500);

    return () => {
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    };
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

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const fullName = `${fn} ${ln}`;

    // The database derives ownership from auth.uid() and accepts only Name and
    // Username; clients never receive direct profile-table write privileges.
    const { error: profileError } = await supabase.rpc("complete_current_profile", {
      p_name: fullName,
      p_username: un.toLowerCase()
    } as never);

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

    // Also update browser actor state immediately
    syncStoredActor({ name: un, displayName: fullName });

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
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: "28px", color: "var(--orange)" }}>
          Witoh
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
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: "20px", color: "var(--cream)", marginBottom: "6px" }}>
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
              onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ""))}
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
            {usernameStatus === "invalid" && "3–20 chars · start/end with a letter or number · only _ and . allowed · no double specials"}
            {(usernameStatus === "idle" || usernameStatus === "checking") &&
              "3–20 chars · letters, numbers, _ and . · starts and ends with a letter or number"}
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
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px",
              fontWeight: 700,
              cursor: canSubmit ? "pointer" : "default",
              transition: "all 0.15s",
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
