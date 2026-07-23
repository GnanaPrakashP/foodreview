"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LogOut, Trash2, FileText, Shield, Settings, Sun, Moon, Monitor, ChevronRight, Heart, Bookmark, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTheme, type ThemeMode } from "@/lib/useTheme";
import { DEFAULT_ACCOUNT_TYPE } from "@/lib/circle";
import { invalidateCachedJson, invalidateViewerCaches } from "@/lib/browser-api-cache";
import { clearStoredActor } from "@/lib/browser-actor";

type AccountType = "private" | "public";

export default function SettingsPage() {
  const router = useRouter();
  const { mode: themeMode, setThemeMode, mounted: themeMounted } = useTheme();
  const [userId, setUserId] = useState("");
  const [accountType, setAccountType] = useState<AccountType>(DEFAULT_ACCOUNT_TYPE);
  const [typeLoaded, setTypeLoaded] = useState(false);
  const [pendingType, setPendingType] = useState<AccountType | null>(null);
  const [saving, setSaving] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setUserId(user.id);
      // Read from user metadata — always in sync with the authenticated session
      const stored = user.user_metadata?.account_type;
      setAccountType(stored === "private" ? "private" : DEFAULT_ACCOUNT_TYPE);
      setTypeLoaded(true);
    });
  }, []);

  async function confirmAccountType() {
    if (!pendingType || !userId) return;
    setSaving(true);
    const supabase = createClient();
    // Update user metadata (primary — always works for the current user)
    await supabase.auth.updateUser({ data: { account_type: pendingType } });
    // The database derives the profile owner and permits only this approved field.
    await supabase.rpc("update_current_account_type", { p_account_type: pendingType } as never);
    setAccountType(pendingType);
    setPendingType(null);
    setSaving(false);
    // Clear browser sessionStorage caches
    invalidateCachedJson("/api/me");
    invalidateCachedJson("/api/people");
    // Drop server-side getPrivateCached entries for this user (me-page, people-page).
    // Fire-and-forget: browser caches are already cleared above; the server cache TTL (5 min)
    // is the fallback if this call fails.
    void fetch("/api/me", { method: "POST" });
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    clearStoredActor();
    invalidateViewerCaches();
    router.push("/login");
  }

  async function handleDeleteAccount() {
    const supabase = createClient();
    await supabase.rpc("request_account_deletion");
    await supabase.auth.signOut();
    clearStoredActor();
    invalidateViewerCaches();
    router.push("/login");
  }

  function Row({ icon, label, right, onClick, danger }: {
    icon: React.ReactNode;
    label: string;
    right?: React.ReactNode;
    onClick?: () => void;
    danger?: boolean;
  }) {
    const color = danger ? "#EF4444" : "var(--cream)";
    const iconBg = danger ? "rgba(239,68,68,0.1)" : "var(--surface)";
    return (
      <button
        onClick={onClick}
        disabled={!onClick}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", padding: "15px 16px", background: "none", border: "none", cursor: onClick ? "pointer" : "default", textAlign: "left" }}
      >
        <div style={{ width: 34, height: 34, borderRadius: 10, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {icon}
        </div>
        <span style={{ flex: 1, fontSize: "14px", color, fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>{label}</span>
        {right ?? (onClick && !danger ? <ChevronRight size={16} strokeWidth={2} color="var(--muted)" /> : null)}
        {danger && onClick && <ChevronRight size={16} strokeWidth={2} color="#EF4444" />}
      </button>
    );
  }

  const confirmCopy = pendingType === "public"
    ? { title: "Make account public?", body: "People who request to join your circle will be added immediately. Your post audiences do not change." }
    : { title: "Make account private?", body: "People must wait for your approval before joining your circle. Your post audiences do not change." };

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: 100 }}>

      {/* Header */}
      <div style={{ padding: "16px 20px 20px", display: "flex", alignItems: "center", gap: "12px" }}>
        <button onClick={() => router.push("/me")} style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
        </button>
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: "20px", color: "var(--cream)" }}>Settings</h1>
      </div>

      {/* Profile actions */}
      <div style={{ margin: "0 16px 10px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "18px", overflow: "hidden" }}>
        <Row
          icon={<Settings size={16} strokeWidth={2} color="var(--muted)" />}
          label="Edit Profile"
          onClick={() => router.push("/me/settings/edit")}
        />
      </div>

      {/* Activity */}
      <div style={{ margin: "0 16px 10px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "18px", overflow: "hidden" }}>
        {([
          { label: "Liked Posts",  icon: <Heart size={16} strokeWidth={2} color="var(--muted)" />,         sheet: "liked" },
          { label: "Saved Posts",  icon: <Bookmark size={16} strokeWidth={2} color="var(--muted)" />,      sheet: "saved" },
          { label: "My Comments",  icon: <MessageCircle size={16} strokeWidth={2} color="var(--muted)" />, sheet: "comments" },
        ]).map(({ label, icon, sheet }, idx, arr) => (
          <div key={sheet} style={{ borderBottom: idx < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
            <Row icon={icon} label={label} onClick={() => router.push(`/me/settings/${sheet}`)} />
          </div>
        ))}
      </div>

      {/* Preferences */}
      <div style={{ margin: "0 16px 10px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "18px", overflow: "hidden" }}>

        {/* Account type */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "15px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Shield size={16} strokeWidth={2} color="var(--muted)" />
          </div>
          <span style={{ flex: 1, fontSize: "14px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>Account Type</span>
          <div style={{ display: "flex", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "3px", gap: "2px" }}>
            {(["private", "public"] as AccountType[]).map((type) => {
              const active = typeLoaded && accountType === type;
              return (
                <button
                  key={type}
                  onClick={() => { if (typeLoaded && type !== accountType) setPendingType(type); }}
                  style={{ background: active ? "var(--orange)" : "none", border: "none", borderRadius: 7, padding: "5px 9px", color: active ? "white" : "var(--muted)", cursor: typeLoaded && type !== accountType ? "pointer" : "default", fontSize: "11px", fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}
                >
                  {type === "private" ? "Private" : "Public"}
                </button>
              );
            })}
          </div>
        </div>

        {/* Appearance */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "15px 16px" }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {themeMode === "light" ? <Sun size={16} strokeWidth={2} color="var(--muted)" /> : themeMode === "dark" ? <Moon size={16} strokeWidth={2} color="var(--muted)" /> : <Monitor size={16} strokeWidth={2} color="var(--muted)" />}
          </div>
          <span style={{ flex: 1, fontSize: "14px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>Appearance</span>
          <div style={{ display: "flex", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "3px", gap: "2px" }}>
            {(["system", "light", "dark"] as ThemeMode[]).map((opt) => {
              const active = themeMounted && themeMode === opt;
              return (
                <button key={opt} onClick={() => setThemeMode(opt)} style={{ background: active ? "var(--orange)" : "none", border: "none", borderRadius: 7, padding: "5px 9px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label={opt}>
                  {opt === "system" && <Monitor size={13} strokeWidth={2} color={active ? "white" : "var(--muted)"} />}
                  {opt === "light"  && <Sun     size={13} strokeWidth={2} color={active ? "white" : "var(--muted)"} />}
                  {opt === "dark"   && <Moon    size={13} strokeWidth={2} color={active ? "white" : "var(--muted)"} />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Account actions */}
      <div style={{ margin: "0 16px 10px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "18px", overflow: "hidden" }}>
        <div style={{ borderBottom: "1px solid var(--border)" }}>
          <Row icon={<LogOut size={16} strokeWidth={2} color="var(--muted)" />} label="Log out" onClick={() => setShowLogoutConfirm(true)} />
        </div>
        <Link href="/privacy" style={{ textDecoration: "none", display: "block", borderBottom: "1px solid var(--border)" }}>
          <Row icon={<Shield size={16} strokeWidth={2} color="var(--muted)" />} label="Privacy Policy" />
        </Link>
        <Link href="/terms" style={{ textDecoration: "none", display: "block", borderBottom: "1px solid var(--border)" }}>
          <Row icon={<FileText size={16} strokeWidth={2} color="var(--muted)" />} label="Terms of Service" />
        </Link>
        <Row icon={<Trash2 size={16} strokeWidth={2} color="#EF4444" />} label="Delete account" onClick={() => setShowDeleteConfirm(true)} danger />
      </div>

      {/* Account type confirm */}
      {pendingType && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ background: "var(--card)", borderRadius: "20px", padding: "24px", width: "100%", maxWidth: "320px", border: "1px solid var(--border)" }}>
            <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 800, color: "var(--cream)", marginBottom: "8px" }}>{confirmCopy.title}</h2>
            <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6, marginBottom: "20px", fontFamily: "'DM Sans', sans-serif" }}>{confirmCopy.body}</p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setPendingType(null)} disabled={saving} style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "12px", color: "var(--cream)", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
              <button onClick={confirmAccountType} disabled={saving} style={{ flex: 1, background: "var(--orange)", border: "none", borderRadius: "12px", padding: "12px", color: "white", fontSize: "14px", fontWeight: 700, cursor: saving ? "default" : "pointer", fontFamily: "'DM Sans', sans-serif", opacity: saving ? 0.6 : 1 }}>
                {saving ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout confirm */}
      {showLogoutConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ background: "var(--card)", borderRadius: "20px", padding: "24px", width: "100%", maxWidth: "320px", border: "1px solid var(--border)" }}>
            <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 800, color: "var(--cream)", marginBottom: "8px" }}>Log out?</h2>
            <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.5, marginBottom: "20px", fontFamily: "'DM Sans', sans-serif" }}>You can sign back in anytime with your account.</p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setShowLogoutConfirm(false)} style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "12px", color: "var(--cream)", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
              <button onClick={handleLogout} style={{ flex: 1, background: "var(--orange)", border: "none", borderRadius: "12px", padding: "12px", color: "white", fontSize: "14px", fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Log out</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {showDeleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ background: "var(--card)", borderRadius: "20px", padding: "24px", width: "100%", maxWidth: "320px", border: "1px solid var(--border)" }}>
            <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 800, color: "var(--cream)", marginBottom: "8px" }}>Delete account?</h2>
            <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.5, marginBottom: "20px", fontFamily: "'DM Sans', sans-serif" }}>This will permanently delete your profile and all your reviews. This cannot be undone.</p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setShowDeleteConfirm(false)} style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "12px", color: "var(--cream)", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
              <button onClick={handleDeleteAccount} style={{ flex: 1, background: "#EF4444", border: "none", borderRadius: "12px", padding: "12px", color: "white", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
