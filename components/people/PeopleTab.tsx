"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import type { CircleMember } from "@/app/people/page";

/* ─── Constants ──────────────────────────────────── */

const APP_URL = "https://foodcircle.app";

/* ─── Types ─────────────────────────────────────── */

interface SearchResult {
  name: string;
  totalPlaces: number;
  inCircle: boolean;
}

/* ─── Helpers ────────────────────────────────────── */

function avatarColor(name: string): string {
  const gradients = [
    "linear-gradient(135deg,#F06030,#C04020)",
    "linear-gradient(135deg,#6366F1,#4F46E5)",
    "linear-gradient(135deg,#3DD68C,#22C55E)",
    "linear-gradient(135deg,#E8A830,#D4821A)",
    "linear-gradient(135deg,#EC4899,#BE185D)",
    "linear-gradient(135deg,#14B8A6,#0F766E)",
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return gradients[hash % gradients.length];
}

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: avatarColor(name),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: size * 0.35,
        color: "white",
        flexShrink: 0,
      }}
    >
      {initials || "?"}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: "10px",
        fontWeight: 600,
        color: "var(--muted)",
        textTransform: "uppercase",
        letterSpacing: "1.5px",
        marginBottom: "10px",
      }}
    >
      {children}
    </p>
  );
}

function PillButton({
  children,
  onClick,
  active,
  danger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: danger
          ? "rgba(239,68,68,0.12)"
          : active
          ? "var(--orange)"
          : "var(--card)",
        border: `1px solid ${
          danger ? "rgba(239,68,68,0.3)" : active ? "var(--orange)" : "var(--border)"
        }`,
        borderRadius: "20px",
        padding: "6px 14px",
        color: danger ? "#EF4444" : active ? "white" : "var(--muted)",
        fontSize: "12px",
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

/* ─── Invite Section ─────────────────────────────── */

function InviteSection() {
  const [myName, setMyName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("fc_my_name") ?? "";
    setMyName(saved);
    setNameInput(saved);
  }, []);

  const inviteUrl = myName
    ? `${APP_URL}/join/${encodeURIComponent(myName)}`
    : "";

  function saveName() {
    const name = nameInput.trim();
    if (!name) return;
    setMyName(name);
    localStorage.setItem("fc_my_name", name);
  }

  function copyLink() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  /* Name not set yet — show prompt */
  if (!myName) {
    return (
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "18px",
          padding: "20px",
        }}
      >
        <span style={{ fontSize: "36px", display: "block", marginBottom: "10px" }}>🔗</span>
        <p
          style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: "15px",
            fontWeight: 700,
            color: "var(--cream)",
            marginBottom: "6px",
          }}
        >
          Create your invite link
        </p>
        <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "16px", lineHeight: 1.5 }}>
          Enter your name to generate a personal link you can share with friends.
        </p>
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "12px",
          }}
        >
          <input
            type="text"
            placeholder="Your name…"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveName()}
            autoComplete="off"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--cream)",
              fontSize: "15px",
            }}
          />
        </div>
        <button
          onClick={saveName}
          disabled={!nameInput.trim()}
          style={{
            width: "100%",
            background: nameInput.trim() ? "var(--orange)" : "var(--surface)",
            color: nameInput.trim() ? "white" : "var(--muted)",
            border: "none",
            borderRadius: "14px",
            padding: "14px",
            fontFamily: "'Syne', sans-serif",
            fontSize: "14px",
            fontWeight: 700,
            cursor: nameInput.trim() ? "pointer" : "default",
            transition: "all 0.15s",
          }}
        >
          Generate My Link →
        </button>
      </div>
    );
  }

  /* Link + copy UI */
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "14px",
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: "10px",
      }}
    >
      <span
        style={{
          flex: 1,
          fontSize: "12px",
          color: "var(--muted)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontFamily: "monospace",
        }}
      >
        {inviteUrl}
      </span>
      <button
        onClick={copyLink}
        style={{
          background: copied ? "rgba(61,214,140,0.15)" : "var(--orange-dim)",
          border: `1px solid ${copied ? "rgba(61,214,140,0.3)" : "var(--orange)"}`,
          borderRadius: "10px",
          padding: "6px 14px",
          color: copied ? "var(--green)" : "var(--orange)",
          fontSize: "12px",
          fontWeight: 700,
          cursor: "pointer",
          flexShrink: 0,
          transition: "all 0.15s",
        }}
      >
        {copied ? "✓ Copied" : "Copy"}
      </button>
    </div>
  );
}

/* ─── Main Component ─────────────────────────────── */

export default function PeopleTab({
  initialCircle,
}: {
  initialCircle: CircleMember[];
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Circle managed in local state — starts from server data
  const [circle, setCircle] = useState<CircleMember[]>(initialCircle);
  const [removedNames, setRemovedNames] = useState<Set<string>>(new Set());

  /* ── Search ──────────────────────────────────── */

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("reviews")
      .select("reviewer_name")
      .ilike("reviewer_name", `%${q.trim()}%`);

    const map = new Map<string, number>();
    for (const r of data ?? []) {
      map.set(r.reviewer_name, (map.get(r.reviewer_name) ?? 0) + 1);
    }

    setSearchResults(
      Array.from(map.entries()).map(([name, count]) => ({
        name,
        totalPlaces: count,
        inCircle: circle.some((c) => c.name === name) && !removedNames.has(name),
      }))
    );
    setSearching(false);
  }, [circle, removedNames]);

  useEffect(() => {
    const t = setTimeout(() => search(searchQuery), 350);
    return () => clearTimeout(t);
  }, [searchQuery, search]);

  /* ── Circle helpers ──────────────────────────── */

  function addToCircle(name: string, totalPlaces: number, lastPlace?: string | null) {
    setRemovedNames((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
    setCircle((prev) =>
      prev.some((m) => m.name === name)
        ? prev
        : [...prev, { name, totalPlaces, lastPlace: lastPlace ?? null }]
    );
  }

  /* ── Render ──────────────────────────────────── */

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>

      {/* Header */}
      <div className="px-5 pt-6 pb-3">
        <p
          style={{
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "2px",
            textTransform: "uppercase",
            color: "var(--orange)",
          }}
        >
          People
        </p>
        <h1
          style={{
            fontFamily: "'Instrument Serif', serif",
            fontSize: "26px",
            color: "var(--cream)",
            marginTop: "4px",
            lineHeight: "1.2",
          }}
        >
          Build your food circle
        </h1>
      </div>

      {/* ── Section 1: Search ── */}
      <div className="px-5 pb-5">

        {/* Search input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "16px",
            padding: "12px 14px",
            marginBottom: "14px",
          }}
        >
          <span style={{ fontSize: "16px", flexShrink: 0 }}>🔍</span>
          <input
            type="text"
            placeholder="Search by name…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--cream)",
              fontSize: "15px",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              style={{
                background: "none",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                fontSize: "16px",
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Search results */}
        {searchQuery.trim() !== "" && (
          <>
            <SectionLabel>Results</SectionLabel>

            {searching && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    style={{ height: "64px", background: "var(--card)", borderRadius: "16px", opacity: 0.5 }}
                    className="animate-pulse"
                  />
                ))}
              </div>
            )}

            {!searching && searchResults.length === 0 && (
              <p style={{ fontSize: "13px", color: "var(--muted)", textAlign: "center", padding: "24px 0" }}>
                No one found for &ldquo;{searchQuery}&rdquo;
              </p>
            )}

            {!searching && searchResults.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {searchResults.map((result) => (
                  <div
                    key={result.name}
                    style={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: "16px",
                      padding: "12px 14px",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                    }}
                  >
                    <Avatar name={result.name} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)" }}>
                        {result.name}
                      </p>
                      <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                        {result.totalPlaces} place{result.totalPlaces !== 1 ? "s" : ""} tried
                      </p>
                    </div>
                    {result.inCircle ? (
                      <PillButton active>In circle ✓</PillButton>
                    ) : (
                      <PillButton onClick={() => addToCircle(result.name, result.totalPlaces, null)}>
                        Add to Circle
                      </PillButton>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Divider */}
      <div style={{ height: "1px", background: "var(--border)", margin: "0 20px 20px" }} />

      {/* ── Section 2: Invite Friends ── */}
      <div className="px-5 pb-5">
        <SectionLabel>Invite Friends</SectionLabel>
        <InviteSection />
      </div>

    </div>
  );
}
