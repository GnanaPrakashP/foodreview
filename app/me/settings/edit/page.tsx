"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { invalidateCachedJson } from "@/lib/browser-api-cache";
import { getStoredDisplayName, setStoredDisplayName } from "@/lib/browser-actor";

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  bio: string | null;
};

export default function EditProfilePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [userId, setUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        setName(getStoredDisplayName());
        return;
      }
      setUserId(user.id);
      const { data: profile } = await supabase
        .from("profiles")
        .select("first_name, last_name, bio")
        .eq("id", user.id)
        .maybeSingle<ProfileRow>();
      const profileName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
      setName(
        profileName ||
        (user.user_metadata?.full_name as string) ||
        (user.user_metadata?.name as string) ||
        getStoredDisplayName()
      );
      setBio((profile?.bio as string | null) || (user.user_metadata?.bio as string) || "");
    });
  }, []);

  async function save() {
    const trimmed = name.trim();
    const trimmedBio = bio.trim();
    if (!trimmed || !userId || saving) return;
    setSaving(true);
    setError("");
    const supabase = createClient();
    const { error: profileError } = await supabase.rpc("update_current_profile_details", {
      p_bio: trimmedBio || null,
      p_name: trimmed
    } as never);
    if (profileError) {
      setError(profileError.message);
      setSaving(false);
      return;
    }
    await supabase.auth.updateUser({ data: { full_name: trimmed, bio: trimmedBio } });
    setStoredDisplayName(trimmed);
    invalidateCachedJson("/api/me");
    invalidateCachedJson("/api/people");
    // Drop server-side getPrivateCached entries (me-page, people-page, circle feed).
    void fetch("/api/me", { method: "POST" });
    router.push("/me/settings");
    router.refresh();
  }

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: 100 }}>
      <div style={{ padding: "16px 20px 28px", display: "flex", alignItems: "center", gap: "12px" }}>
        <button onClick={() => router.push("/me/settings")} style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
        </button>
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: "20px", color: "var(--cream)" }}>Edit Profile</h1>
      </div>

      <div style={{ padding: "0 20px" }}>
        <label style={{ fontSize: "10px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: "8px", fontFamily: "'DM Sans', sans-serif" }}>
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          style={{ width: "100%", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px", color: "var(--cream)", fontSize: "14px", outline: "none", marginBottom: "16px", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif" }}
        />
        <label style={{ fontSize: "10px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: "8px", fontFamily: "'DM Sans', sans-serif" }}>
          Bio
        </label>
        <textarea
          value={bio}
          onChange={e => setBio(e.target.value)}
          placeholder="Tell people what you love to eat"
          maxLength={160}
          rows={4}
          style={{ width: "100%", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px", color: "var(--cream)", fontSize: "14px", outline: "none", marginBottom: "8px", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif", resize: "vertical", lineHeight: 1.5 }}
        />
        <p style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "16px", textAlign: "right", fontFamily: "'DM Sans', sans-serif" }}>
          {bio.length}/160
        </p>
        {error && (
          <p style={{ fontSize: "12px", color: "#EF4444", marginBottom: "12px", fontFamily: "'DM Sans', sans-serif" }}>
            {error}
          </p>
        )}
        <button
          onClick={save}
          disabled={!name.trim() || !userId || saving}
          style={{ width: "100%", background: "var(--orange)", border: "none", borderRadius: "14px", padding: "14px", color: "white", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "14px", cursor: "pointer", opacity: !name.trim() || !userId ? 0.5 : 1 }}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
