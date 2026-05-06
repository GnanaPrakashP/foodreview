"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export default function EditProfilePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(localStorage.getItem("fc_my_name") ?? "");
  }, []);

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    localStorage.setItem("fc_my_name", trimmed);
    router.push("/me/settings");
  }

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: 100 }}>
      <div style={{ padding: "16px 20px 28px", display: "flex", alignItems: "center", gap: "12px" }}>
        <button onClick={() => router.push("/me/settings")} style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
        </button>
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "20px", color: "var(--cream)" }}>Edit Profile</h1>
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
        <button
          onClick={save}
          disabled={!name.trim() || saving}
          style={{ width: "100%", background: "var(--orange)", border: "none", borderRadius: "14px", padding: "14px", color: "white", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: "14px", cursor: "pointer", opacity: !name.trim() ? 0.5 : 1 }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
