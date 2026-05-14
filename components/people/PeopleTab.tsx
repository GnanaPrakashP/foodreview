"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { CircleMember } from "@/lib/people-page-data";
import type { Review } from "@/lib/types";
import {
  addName,
  isAcceptedCircleResponse,
  isOneWayCircleResponse,
  personStatusFor,
  removeName,
  type PersonStatus,
} from "@/lib/people-circle-state";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { Check, X } from "lucide-react";
import { cachedCircleStatus, invalidateCircleStatusCache } from "@/lib/browser-circle-status";
import { invalidateCachedJson } from "@/lib/browser-api-cache";
import { profileDisplayName } from "@/lib/profile-names";
import { getStoredActorName, setStoredActorName } from "@/lib/browser-actor";

/* ─── Types ─────────────────────────────────────── */

interface SearchResult {
  name: string;
  displayName: string;
  totalPlaces: number;
}

type ProfileSearchRow = {
  username: string;
  first_name: string;
  last_name: string;
};

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

function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const parts = name.split(/[\s_]+/).filter(Boolean);
  const initials = parts.length >= 2
    ? (parts[0][0]! + parts[1][0]!).toUpperCase()
    : (parts[0]?.[0] ?? "?").toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "14px",
        background: avatarColor(name),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: size * 0.34,
        color: "white",
        flexShrink: 0,
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {initials || "?"}
    </div>
  );
}

function toHandle(username: string): string {
  return "@" + username;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        padding: "0 20px 10px",
        fontSize: "10px",
        fontWeight: 600,
        color: "var(--muted)",
        textTransform: "uppercase",
        letterSpacing: "1.5px",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {children}
    </p>
  );
}

function Divider() {
  return <div style={{ height: "1px", background: "var(--border)", margin: "0 16px 14px" }} />;
}

/* ─── Person card ────────────────────────────────── */

function PersonCard({
  name,
  displayName,
  sub,
  status,
  onAdd,
  onInCircleClick,
  highlightRequest = false,
}: {
  name: string;
  displayName?: string;
  sub: string;
  status: PersonStatus;
  onAdd?: () => void;
  onInCircleClick?: () => void;
  highlightRequest?: boolean;
}) {
  const shownName = displayName || name;
  return (
    <div
      style={{
        margin: "0 16px 10px",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "16px",
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
      }}
    >
      <Link
        href={`/people/${encodeURIComponent(name)}`}
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "12px", textDecoration: "none" }}
      >
        <Avatar name={shownName} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--cream)", marginBottom: "2px", fontFamily: "'DM Sans', sans-serif" }}>
            {shownName}
          </p>
          <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>
            {sub}
          </p>
        </div>
      </Link>
      {status === "one_way" ? (
        <button
          onClick={onInCircleClick}
          title={onInCircleClick ? "Tap to leave this circle" : undefined}
          style={{
            background: "rgba(61,214,140,0.12)",
            border: "1.5px solid rgba(61,214,140,0.35)",
            color: "var(--green)",
            fontSize: "11px",
            fontWeight: 600,
            padding: "6px 12px",
            borderRadius: "100px",
            cursor: onInCircleClick ? "pointer" : "default",
            whiteSpace: "nowrap",
            flexShrink: 0,
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          In Circle
        </button>
      ) : status === "sent" ? (
        <button
          onClick={onAdd}
          title="Tap to cancel request"
          style={{
            background: "rgba(240,96,48,0.12)",
            border: "1.5px solid rgba(240,96,48,0.35)",
            color: "var(--orange)",
            fontSize: "11px",
            fontWeight: 600,
            padding: "6px 12px",
            borderRadius: "100px",
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          Requested
        </button>
      ) : (
        <button
          onClick={onAdd}
          style={{
            background: "rgba(240,96,48,0.12)",
            border: "1.5px solid rgba(240,96,48,0.35)",
            color: "var(--orange)",
            fontSize: "11px",
            fontWeight: 600,
            padding: "6px 12px",
            borderRadius: "100px",
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
            fontFamily: "'DM Sans', sans-serif",
            transition: "all 0.15s",
          }}
        >
          Request
        </button>
      )}
    </div>
  );
}

/* ─── Request card (incoming) ────────────────────── */

function RequestCard({
  name,
  displayName,
  onAccept,
  onReject,
}: {
  name: string;
  displayName?: string;
  onAccept: () => void;
  onReject: () => void;
}) {
  const shownName = displayName || name;
  return (
    <div
      style={{
        margin: "0 16px 10px",
        background: "var(--card)",
        border: "1px solid rgba(240,96,48,0.25)",
        borderRadius: "16px",
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
      }}
    >
      <Link
        href={`/people/${encodeURIComponent(name)}`}
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "12px", textDecoration: "none" }}
      >
        <Avatar name={shownName} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--cream)", marginBottom: "2px", fontFamily: "'DM Sans', sans-serif" }}>
            {shownName}
          </p>
          <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>
            wants to join your circle
          </p>
        </div>
      </Link>
      <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
        <button
          onClick={onReject}
          style={{
            width: "32px",
            height: "32px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "100px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <X size={14} strokeWidth={2.5} color="var(--muted)" />
        </button>
        <button
          onClick={onAccept}
          style={{
            width: "32px",
            height: "32px",
            background: "var(--orange)",
            border: "none",
            borderRadius: "100px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Check size={14} strokeWidth={2.5} color="white" />
        </button>
      </div>
    </div>
  );
}

/* ─── Invite Section ─────────────────────────────── */

function InviteSection() {
  const [myName, setMyName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  useEffect(() => {
    const saved = getStoredActorName();
    setMyName(saved);
    setNameInput(saved);
  }, []);

  const inviteUrl = myName && origin ? origin : "";

  function saveName() {
    const name = nameInput.trim();
    if (!name) return;
    setMyName(name);
    setStoredActorName(name);
  }

  function copyLink() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function shareOn(platform: "whatsapp" | "x") {
    if (!inviteUrl) return;
    const text = encodeURIComponent(`Join me on CircleBites — see what I'm eating! ${inviteUrl}`);
    const url =
      platform === "whatsapp"
        ? `https://wa.me/?text=${text}`
        : `https://x.com/intent/tweet?text=${text}`;
    window.open(url, "_blank", "noopener");
  }

  if (!myName) {
    return (
      <div
        style={{
          margin: "0 16px",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "18px",
          padding: "20px",
        }}
      >
        <span style={{ fontSize: "36px", display: "block", marginBottom: "10px" }}>🔗</span>
        <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "15px", fontWeight: 700, color: "var(--cream)", marginBottom: "6px" }}>
          Create your invite link
        </p>
        <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "16px", lineHeight: 1.5, fontFamily: "'DM Sans', sans-serif" }}>
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
              fontFamily: "'DM Sans', sans-serif",
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

  return (
    <>
      <div
        style={{
          margin: "0 16px",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "16px",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: "11px",
            color: "var(--cream)",
            lineHeight: 1.4,
            letterSpacing: "0.3px",
            wordBreak: "break-all",
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          {inviteUrl}
        </span>
        <button
          onClick={copyLink}
          style={{
            background: "transparent",
            border: `1.5px solid ${copied ? "rgba(61,214,140,0.4)" : "var(--orange)"}`,
            borderRadius: "10px",
            padding: "7px 13px",
            color: copied ? "var(--green)" : "var(--orange)",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            flexShrink: 0,
            transition: "all 0.15s",
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>

      <div style={{ display: "flex", gap: "8px", padding: "8px 16px 0" }}>
        <button
          onClick={() => shareOn("whatsapp")}
          style={{
            flex: 1,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            padding: "10px",
            textAlign: "center",
            fontSize: "12px",
            color: "var(--cream)",
            cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          Share on WhatsApp
        </button>
        <button
          onClick={() => shareOn("x")}
          style={{
            flex: 1,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            padding: "10px",
            textAlign: "center",
            fontSize: "12px",
            color: "var(--cream)",
            cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          Share on X
        </button>
      </div>
    </>
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
  const [myName, setMyName] = useState("");

  // Circle state from API
  const [circleMembers, setCircleMembers] = useState<Set<string>>(new Set());
  const [pendingSent, setPendingSent] = useState<Set<string>>(new Set());
  const [pendingIncoming, setPendingIncoming] = useState<string[]>([]);
  const [keptSuggestions, setKeptSuggestions] = useState<Set<string>>(new Set());
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [confirmCancelName, setConfirmCancelName] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [confirmLeaveName, setConfirmLeaveName] = useState<string | null>(null);
  const [leaveBusy, setLeaveBusy] = useState(false);

  /* ── Load circle status from API ── */

  const loadCircleStatus = useCallback(async (name: string) => {
    if (!name) {
      setStatusLoaded(true);
      return;
    }
    const data = await cachedCircleStatus(name);
    setCircleMembers(new Set(data.members ?? []));
    setPendingSent(new Set(data.pendingSent ?? []));
    setPendingIncoming(data.pendingIncoming ?? []);
    setStatusLoaded(true);
  }, []);

  useEffect(() => {
    const me = getStoredActorName();
    setMyName(me);
    loadCircleStatus(me);
  }, [loadCircleStatus]);

  /* ── Send request ── */

  async function sendRequest(receiverName: string) {
    if (!myName || myName === receiverName) return;

    const isPublicAccount = initialCircle.find((m) => m.name === receiverName)?.accountType === "public";

    setKeptSuggestions((prev) => addName(prev, receiverName));
    if (isPublicAccount) {
      // Public account: skip "Requested", go straight to "In Circle" optimistically
      setCircleMembers((prev) => addName(prev, receiverName));
    } else {
      setPendingSent((prev) => addName(prev, receiverName));
    }

    const res = await fetch("/api/circle/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderName: myName, receiverName }),
    });
    const data = await res.json();

    if (!res.ok) {
      // Roll back optimistic update on failure
      if (isPublicAccount) {
        setCircleMembers((prev) => removeName(prev, receiverName));
      } else {
        setPendingSent((prev) => removeName(prev, receiverName));
      }
      setKeptSuggestions((prev) => removeName(prev, receiverName));
      return;
    }

    invalidateCircleStatusCache(myName);
    invalidateCircleStatusCache(receiverName);
    invalidateCachedJson("/api/feed/circle");
    invalidateCachedJson("/api/people");

    if (!isPublicAccount && (isAcceptedCircleResponse(data) || isOneWayCircleResponse(data))) {
      // Private account that got auto-accepted (e.g. they were already in our circle)
      setPendingSent((prev) => removeName(prev, receiverName));
      setCircleMembers((prev) => addName(prev, receiverName));
    }
  }

  /* ── Respond to incoming request ── */

  async function respondToRequest(senderName: string, action: "accept" | "reject") {
    if (!myName) return;
    // Optimistic update
    setPendingIncoming((prev) => prev.filter((n) => n !== senderName));
    if (action === "accept") {
      setCircleMembers((prev) => addName(prev, senderName));
    }
    const res = await fetch("/api/circle/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ myName, senderName, action }),
    });
    if (!res.ok) {
      // Roll back
      setPendingIncoming((prev) => [...prev, senderName]);
      if (action === "accept") {
        setCircleMembers((prev) => removeName(prev, senderName));
      }
      return;
    }
    invalidateCircleStatusCache(myName);
    invalidateCircleStatusCache(senderName);
    invalidateCachedJson("/api/feed/circle");
    invalidateCachedJson("/api/people");
  }

  /* ── Cancel sent request ── */

  async function cancelRequest(receiverName: string) {
    if (!myName || cancelBusy) return;
    setCancelBusy(true);
    // Optimistic update
    setPendingSent((prev) => removeName(prev, receiverName));
    try {
      const res = await fetch("/api/circle/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderName: myName, receiverName }),
      });
      if (!res.ok) {
        setPendingSent((prev) => addName(prev, receiverName));
        return;
      }
      invalidateCircleStatusCache(myName);
      invalidateCircleStatusCache(receiverName);
      invalidateCachedJson("/api/feed/circle");
      invalidateCachedJson("/api/people");
    } finally {
      setCancelBusy(false);
    }
  }

  async function leaveCircle(otherName: string) {
    if (!myName || leaveBusy) return;
    setLeaveBusy(true);
    setCircleMembers((prev) => removeName(prev, otherName));
    try {
      const res = await fetch("/api/circle/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ myName, otherName }),
      });
      if (!res.ok) {
        setCircleMembers((prev) => addName(prev, otherName));
        return;
      }
      invalidateCircleStatusCache(myName);
      invalidateCircleStatusCache(otherName);
      invalidateCachedJson("/api/feed/circle");
      invalidateCachedJson("/api/people");
    } finally {
      setLeaveBusy(false);
    }
  }

  /* ── Search (reviews + profiles) ── */

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    const supabase = createClient();
    const trimmed = q.trim();

    const [{ data: reviewData }, { data: profileData }] = await Promise.all([
      supabase
        .from("reviews")
        .select("reviewer_name")
        .eq("visibility", "public")
        .ilike("reviewer_name", `%${trimmed}%`)
        .returns<Pick<Review, "reviewer_name">[]>(),
      supabase.from("profiles").select("username, first_name, last_name").or(
        `username.ilike.%${trimmed}%,first_name.ilike.%${trimmed}%,last_name.ilike.%${trimmed}%`
      ).returns<ProfileSearchRow[]>(),
    ]);

    const displayNameByUsername = new Map<string, string>();
    for (const p of profileData ?? []) {
      if (p.username) {
        displayNameByUsername.set(p.username, profileDisplayName(p, p.username));
      }
    }

    const map = new Map<string, number>();
    for (const r of reviewData ?? []) {
      if (r.reviewer_name) map.set(r.reviewer_name, (map.get(r.reviewer_name) ?? 0) + 1);
    }
    for (const p of profileData ?? []) {
      if (p.username && !map.has(p.username)) map.set(p.username, 0);
    }

    setSearchResults(
      Array.from(map.entries())
        .filter(([name]) => name !== myName)
        .map(([name, totalPlaces]) => ({
          name,
          displayName: displayNameByUsername.get(name) || name,
          totalPlaces,
        }))
    );
    setSearching(false);
  }, [myName]);

  useEffect(() => {
    const t = setTimeout(() => search(searchQuery), 350);
    return () => clearTimeout(t);
  }, [searchQuery, search]);

  /* ── Derived ── */

  // People shown because the user just acted on them (stay visible with updated button)
  const keptCards = statusLoaded
    ? initialCircle.filter(
        (m) => keptSuggestions.has(m.name) && m.accountType === "public" && m.name !== myName
      )
    : [];
  // Fresh suggestions: public, not yet in circle, not pending, not incoming, not already kept
  const freshSuggested = statusLoaded
    ? initialCircle.filter(
        (m) =>
          m.accountType === "public" &&
          !circleMembers.has(m.name) &&
          !pendingSent.has(m.name) &&
          !pendingIncoming.includes(m.name) &&
          !keptSuggestions.has(m.name) &&
          m.name !== myName
      ).slice(0, 3)
    : [];
  const suggested = [...keptCards, ...freshSuggested.slice(0, Math.max(0, 3 - keptCards.length))];

  function suggestionSub(member: CircleMember): string {
    if (member.commonRestaurantCount > 0) {
      const places = member.commonRestaurantCount === 1 ? "place" : "places";
      return `${member.commonRestaurantCount} ${places} in common`;
    }
    return `${toHandle(member.name)} · ${member.totalPlaces} place${member.totalPlaces !== 1 ? "s" : ""}`;
  }

  function personStatus(name: string): PersonStatus {
    return personStatusFor(name, { circleMembers, pendingSent });
  }

  /* ── Render ── */

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>

      {/* Header */}
      <div style={{ padding: "16px 20px 14px" }}>
        <p style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "2px", textTransform: "uppercase", color: "var(--orange)", marginBottom: "4px", fontFamily: "'DM Sans', sans-serif" }}>
          People
        </p>
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "22px", color: "var(--cream)" }}>
          Build your food circle
        </h1>
      </div>

      {/* Search bar */}
      <div
        style={{
          margin: "0 16px 16px",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "16px",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}
      >
        <span style={{ fontSize: "16px", flexShrink: 0 }}>🔍</span>
        <input
          type="text"
          placeholder="Search by name or @username…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoComplete="off"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--cream)",
            fontSize: "14px",
            fontFamily: "'DM Sans', sans-serif",
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "16px", lineHeight: 1, flexShrink: 0 }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Search results */}
      {searchQuery.trim() !== "" && (
        <div style={{ marginBottom: "8px" }}>
          {searching && (
            <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {[1, 2].map((i) => (
                <div key={i} style={{ height: "64px", background: "var(--card)", borderRadius: "16px", opacity: 0.5 }} className="animate-pulse" />
              ))}
            </div>
          )}
          {!searching && searchResults.length === 0 && (
            <p style={{ fontSize: "13px", color: "var(--muted)", textAlign: "center", padding: "24px 0", fontFamily: "'DM Sans', sans-serif" }}>
              No one found for &ldquo;{searchQuery}&rdquo;
            </p>
          )}
          {!searching && searchResults.map((result) => (
            <PersonCard
              key={result.name}
              name={result.name}
              displayName={result.displayName}
              sub={`${toHandle(result.name)} · ${result.totalPlaces} place${result.totalPlaces !== 1 ? "s" : ""}`}
              status={personStatus(result.name)}
              onInCircleClick={personStatus(result.name) === "one_way" ? () => setConfirmLeaveName(result.name) : undefined}
              onAdd={personStatus(result.name) === "sent" ? () => setConfirmCancelName(result.name) : () => sendRequest(result.name)}
            />
          ))}
        </div>
      )}

      {/* Incoming requests */}
      {pendingIncoming.length > 0 && (
        <>
          <Divider />
          <SectionLabel>Circle Requests · {pendingIncoming.length}</SectionLabel>
          {pendingIncoming.map((name) => {
            const member = initialCircle.find((m) => m.name === name);
            return (
              <RequestCard
                key={name}
                name={name}
                displayName={member?.displayName}
                onAccept={() => respondToRequest(name, "accept")}
                onReject={() => respondToRequest(name, "reject")}
              />
            );
          })}
        </>
      )}

      <Divider />

      {/* Invite link */}
      <SectionLabel>Your Invite Link</SectionLabel>
      <InviteSection />

      {/* Suggested Circle */}
      {suggested.length > 0 && (
        <>
          <div style={{ height: "20px" }} />
          <Divider />
          <SectionLabel>Suggested Circle</SectionLabel>
          {suggested.map((member) => (
            <PersonCard
              key={member.name}
              name={member.name}
              displayName={member.displayName}
              sub={suggestionSub(member)}
              status={personStatus(member.name)}
              highlightRequest
              onInCircleClick={personStatus(member.name) === "one_way" ? () => setConfirmLeaveName(member.name) : undefined}
              onAdd={personStatus(member.name) === "sent" ? () => setConfirmCancelName(member.name) : () => sendRequest(member.name)}
            />
          ))}
        </>
      )}

      <ConfirmModal
        open={Boolean(confirmCancelName)}
        title="Cancel request?"
        message={confirmCancelName ? `Cancel request to join ${initialCircle.find(m => m.name === confirmCancelName)?.displayName || confirmCancelName}'s circle?` : ""}
        confirmText="Cancel request"
        disabled={cancelBusy}
        onCancel={() => setConfirmCancelName(null)}
        onConfirm={async () => {
          const target = confirmCancelName;
          if (!target) return;
          setConfirmCancelName(null);
          await cancelRequest(target);
        }}
      />
      <ConfirmModal
        open={Boolean(confirmLeaveName)}
        title="Leave circle?"
        message={confirmLeaveName ? `Do you no longer want to be in ${initialCircle.find(m => m.name === confirmLeaveName)?.displayName || confirmLeaveName}'s circle?` : ""}
        confirmText="Leave"
        confirmVariant="danger"
        disabled={leaveBusy}
        onCancel={() => setConfirmLeaveName(null)}
        onConfirm={async () => {
          const target = confirmLeaveName;
          if (!target) return;
          setConfirmLeaveName(null);
          await leaveCircle(target);
        }}
      />

      <div style={{ height: "100px" }} />
    </div>
  );
}
