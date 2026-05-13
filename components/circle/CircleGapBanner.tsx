"use client";

import { useState, useEffect } from "react";
import type { Review } from "@/lib/types";
import { computeCircleGap } from "@/lib/discovery";
import { isWishlisted, addToWishlist } from "@/lib/wishlist";

const DISMISSED_KEY = "fc_dismissed_circle_gaps";

function getDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"); }
  catch { return []; }
}

function dismiss(name: string) {
  const list = getDismissed();
  if (!list.includes(name)) list.push(name);
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(list));
}

function avatarColor(name: string): string {
  const G = [
    "linear-gradient(135deg,#F06030,#C04020)",
    "linear-gradient(135deg,#6366F1,#4F46E5)",
    "linear-gradient(135deg,#3DD68C,#22C55E)",
    "linear-gradient(135deg,#E8A830,#D4821A)",
    "linear-gradient(135deg,#EC4899,#BE185D)",
  ];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return G[h % G.length];
}

function MiniAvatar({ name }: { name: string }) {
  const parts = name.split(/[\s_]+/).filter(Boolean);
  const initials = parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : (parts[0]?.[0] ?? "?").toUpperCase();
  return (
    <div
      style={{
        width: "26px",
        height: "26px",
        borderRadius: "50%",
        background: avatarColor(name),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "10px",
        fontWeight: 700,
        color: "white",
        border: "2px solid var(--bg)",
        flexShrink: 0,
      }}
    >
      {initials || "?"}
    </div>
  );
}

export default function CircleGapBanner({ allReviews }: { allReviews: Review[] }) {
  const [gap, setGap] = useState<ReturnType<typeof computeCircleGap>>(null);
  const [saved, setSaved] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const myName = localStorage.getItem("fc_my_name");
    if (!myName) return;

    const result = computeCircleGap(myName, allReviews);
    if (!result) return;

    const dismissed = getDismissed();
    if (dismissed.includes(result.restaurant_name)) return;

    setGap(result);
    setSaved(isWishlisted(`gap-place-${result.restaurant_name}`));
    setVisible(true);
  }, [allReviews]);

  if (!visible || !gap) return null;

  function handleWishlist() {
    if (!gap) return;
    addToWishlist({ id: `gap-place-${gap.restaurant_name}`, restaurant_name: gap.restaurant_name });
    setSaved(true);
  }

  function handleDismiss() {
    if (!gap) return;
    dismiss(gap.restaurant_name);
    setVisible(false);
  }

  const friendWord = gap.friendCount === 1 ? "friend" : "friends";
  const friendStr =
    gap.friendNames.length === 1
      ? gap.friendNames[0]
      : gap.friendNames.length === 2
      ? `${gap.friendNames[0]} & ${gap.friendNames[1]}`
      : `${gap.friendNames[0]}, ${gap.friendNames[1]} & ${gap.friendCount - 2} more`;

  return (
    <div
      style={{
        margin: "0 16px 16px",
        background: "linear-gradient(135deg, rgba(240,96,48,0.08) 0%, rgba(240,96,48,0.04) 100%)",
        border: "1px solid rgba(240,96,48,0.25)",
        borderRadius: "18px",
        padding: "14px",
        position: "relative",
      }}
    >
      {/* Dismiss */}
      <button
        onClick={handleDismiss}
        style={{
          position: "absolute",
          top: "10px",
          right: "12px",
          background: "none",
          border: "none",
          color: "var(--muted)",
          fontSize: "16px",
          cursor: "pointer",
          lineHeight: 1,
          padding: "2px",
        }}
      >
        ✕
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px", paddingRight: "20px" }}>
        {/* Avatar stack */}
        <div style={{ display: "flex" }}>
          {gap.friendNames.map((name, i) => (
            <div key={name} style={{ marginLeft: i === 0 ? 0 : "-8px", zIndex: gap.friendNames.length - i }}>
              <MiniAvatar name={name} />
            </div>
          ))}
        </div>

        <p style={{ fontSize: "13px", color: "var(--cream)", lineHeight: 1.4, fontWeight: 500 }}>
          <strong style={{ color: "var(--orange)" }}>{friendStr}</strong>
          {gap.friendCount > gap.friendNames.length ? "" : ` ${gap.friendCount === 1 ? "has" : "have"}`}{" "}
          tried <strong>{gap.restaurant_name}</strong>
          {" "}— you&apos;re the only one who hasn&apos;t
        </p>
      </div>

      <button
        onClick={handleWishlist}
        disabled={saved}
        style={{
          width: "100%",
          background: saved ? "rgba(232,168,48,0.12)" : "var(--orange)",
          color: saved ? "var(--gold)" : "white",
          border: saved ? "1px solid rgba(232,168,48,0.3)" : "none",
          borderRadius: "12px",
          padding: "10px",
          fontSize: "13px",
          fontWeight: 700,
          cursor: saved ? "default" : "pointer",
          fontFamily: "'Syne', sans-serif",
          transition: "all 0.15s",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
        }}
      >
        {saved ? "⭐ Added to wishlist" : `Add ${gap.restaurant_name} to wishlist →`}
      </button>

      {/* Context label */}
      <p style={{ fontSize: "10px", color: "var(--muted)", textAlign: "center", marginTop: "8px" }}>
        {gap.friendCount} {friendWord} have been here
      </p>
    </div>
  );
}
