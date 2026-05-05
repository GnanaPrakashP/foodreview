"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountType, Review } from "@/lib/types";
import { avatarGradient, avatarInitials, restaurantGradient } from "@/lib/profile";
import { createClient } from "@/lib/supabase/client";
import { LogOut, Trash2, FileText, Shield, ChevronRight, Settings, Sun, Moon, Monitor, Heart, Bookmark, MessageCircle } from "lucide-react";
import { useTheme } from "@/lib/useTheme";
import type { ThemeMode } from "@/lib/useTheme";
import type { WishlistItem, MyComment } from "@/app/me/page";

/* ─── helpers ────────────────────────────────────── */

const RANK_COLORS: Record<number, string> = {
  1: "#E8A830",
  2: "#9CA3AF",
  3: "#CD7C2F",
};

interface RankedPlace {
  name: string;
  score10: number;
  visitCount: number;
  dishCount: number;
  isRegular: boolean;
}

function buildRankedPlaces(reviews: Review[]): RankedPlace[] {
  const map = new Map<string, { totalRating: number; ratingCount: number; visitCount: number; dishes: Set<string> }>();
  for (const r of reviews) {
    const existing = map.get(r.restaurant_name);
    const rated = r.items.filter(it => it.rating > 0);
    const sum = rated.reduce((s, it) => s + it.rating, 0);
    if (existing) {
      existing.visitCount++;
      existing.totalRating += sum;
      existing.ratingCount += rated.length;
      for (const it of r.items) if (it.name.trim()) existing.dishes.add(it.name.trim().toLowerCase());
    } else {
      const dishes = new Set<string>();
      for (const it of r.items) if (it.name.trim()) dishes.add(it.name.trim().toLowerCase());
      map.set(r.restaurant_name, { totalRating: sum, ratingCount: rated.length, visitCount: 1, dishes });
    }
  }
  return [...map.entries()]
    .map(([name, d]) => ({
      name,
      score10: d.ratingCount > 0 ? Math.round((d.totalRating / d.ratingCount) * 2 * 10) / 10 : 0,
      visitCount: d.visitCount,
      dishCount: d.dishes.size,
      isRegular: d.visitCount >= 5,
    }))
    .sort((a, b) => b.score10 - a.score10);
}

/* ─── skeleton ────────────────────────────────────── */

function StatSkeleton() {
  return (
    <div className="animate-pulse" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px 10px", textAlign: "center" }}>
      <div style={{ height: "28px", background: "var(--surface)", borderRadius: "6px", width: "36px", margin: "0 auto 8px" }} />
      <div style={{ height: "11px", background: "var(--surface)", borderRadius: "4px", width: "48px", margin: "0 auto" }} />
    </div>
  );
}

/* ─── circle bottom sheet ─────────────────────────── */

function CircleSheet({ circle, allReviews, onClose }: {
  circle: string[];
  allReviews: Review[];
  onClose: () => void;
}) {
  const members = useMemo(
    () => circle.map(name => ({
      name,
      places: new Set(allReviews.filter(r => r.reviewer_name === name).map(r => r.restaurant_name)).size,
    })),
    [circle, allReviews]
  );

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 60, display: "flex", alignItems: "flex-end" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "100%", maxWidth: "512px", margin: "0 auto" }}>
      <div style={{ background: "var(--surface)", borderRadius: "24px 24px 0 0", width: "100%", maxHeight: "70vh", display: "flex", flexDirection: "column", borderTop: "1px solid var(--border)" }}>
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
          <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: "var(--border)" }} />
        </div>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 20px 14px" }}>
          <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: "16px", color: "var(--cream)" }}>
            Your Circle · <span style={{ color: "var(--muted)" }}>{circle.length} people</span>
          </p>
          <button onClick={onClose} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "6px 14px", fontSize: "13px", color: "var(--muted)", cursor: "pointer" }}>
            Done
          </button>
        </div>
        {/* List */}
        <div style={{ overflowY: "auto", flex: 1, padding: "0 16px 32px" }}>
          {members.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "32px 0", gap: "14px" }}>
              <p style={{ fontSize: "13px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", margin: 0 }}>No one in your circle yet</p>
              <Link href="/people" onClick={onClose} style={{ textDecoration: "none" }}>
                <button style={{ background: "var(--orange)", color: "white", border: "none", borderRadius: "12px", padding: "12px 24px", fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
                  Find friends
                </button>
              </Link>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {members.map(({ name, places }) => (
                  <Link key={name} href={`/people/${encodeURIComponent(name)}`} onClick={onClose} style={{ textDecoration: "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: avatarGradient(name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 700, color: "white", flexShrink: 0, fontFamily: "'Syne', sans-serif" }}>
                        {avatarInitials(name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>{name}</p>
                        <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
                          {places} place{places !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <ChevronRight size={16} strokeWidth={2} color="var(--muted)" />
                    </div>
                  </Link>
                ))}
              </div>
              <Link href="/people" onClick={onClose} style={{ textDecoration: "none" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "18px 0 4px", gap: "6px", color: "var(--orange)", fontSize: "13px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
                  + Add more friends
                </div>
              </Link>
            </>
          )}
        </div>
      </div>
      </div>{/* end max-width wrapper */}
    </div>
  );
}

/* ─── main component ──────────────────────────────── */

type ActivitySheet = "liked" | "saved" | "comments" | null;

export default function MeClient({
  allReviews,
  likedReviews,
  wishlist,
  myComments,
}: {
  allReviews: Review[];
  likedReviews: Review[];
  wishlist: WishlistItem[];
  myComments: MyComment[];
}) {
  const router = useRouter();
  const { mode: themeMode, setThemeMode } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [myName, setMyName] = useState("");
  const [circle, setCircle] = useState<string[]>([]);
  const [accountType, setAccountType] = useState<AccountType>("private");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [activitySheet, setActivitySheet] = useState<ActivitySheet>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    localStorage.removeItem("fc_my_name");
    localStorage.removeItem("fc_my_circle");
    router.push("/login");
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError("");
    const res = await fetch("/api/delete-account", { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setDeleteError(body.error ?? "Something went wrong. Try again.");
      setDeleting(false);
      return;
    }
    localStorage.removeItem("fc_my_name");
    localStorage.removeItem("fc_my_circle");
    router.push("/login");
  }

  async function updateAccountType(nextType: AccountType) {
    setAccountType(nextType);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await (supabase as any)
      .from("profiles")
      .update({ account_type: nextType })
      .eq("id", user.id);

    await supabase.auth.updateUser({
      data: { account_type: nextType },
    });
  }

  // All derived — unconditional
  const myReviews = useMemo(
    () => allReviews.filter(r => r.reviewer_name === myName),
    [allReviews, myName]
  );

  const uniquePlaces = useMemo(
    () => new Set(myReviews.map(r => r.restaurant_name)).size,
    [myReviews]
  );

  const uniqueDishes = useMemo(() => {
    const pairs = new Set<string>();
    for (const r of myReviews)
      for (const it of r.items)
        if (it.name.trim())
          pairs.add(`${it.name.trim().toLowerCase()}\x00${r.restaurant_name.toLowerCase()}`);
    return pairs.size;
  }, [myReviews]);

  const totalVisits = useMemo(() => myReviews.length, [myReviews]);

  const rankedPlaces = useMemo(() => buildRankedPlaces(myReviews), [myReviews]);

  useEffect(() => {
    const name = localStorage.getItem("fc_my_name") ?? "";
    setMyName(name);
    setMounted(true);
    if (name) {
      fetch(`/api/circle/status?name=${encodeURIComponent(name)}`)
        .then((r) => r.json())
        .then((data) => {
          setCircle(data.displayMembers ?? data.members ?? []);
          setAccountType(data.accountType ?? "private");
        })
        .catch(() => {});
    }
  }, []);

  /* ── skeleton ── */
  if (!mounted) {
    return (
      <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>
        <div className="px-5 pt-6 pb-5" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div className="animate-pulse" style={{ width: "72px", height: "72px", borderRadius: "22px", background: "var(--card)", flexShrink: 0 }} />
          <div>
            <div className="animate-pulse" style={{ height: "20px", width: "120px", background: "var(--card)", borderRadius: "6px", marginBottom: "8px" }} />
            <div className="animate-pulse" style={{ height: "13px", width: "80px", background: "var(--card)", borderRadius: "4px" }} />
          </div>
        </div>
        <div className="px-5 pb-5">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
            <StatSkeleton /><StatSkeleton /><StatSkeleton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "24px", padding: "28px 24px", width: "100%", maxWidth: "360px" }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, background: "rgba(239,68,68,0.12)", border: "1.5px solid rgba(239,68,68,0.25)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "16px" }}>
              <Trash2 size={24} strokeWidth={1.8} color="#EF4444" />
            </div>
            <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "18px", color: "var(--cream)", marginBottom: "8px" }}>Delete account?</p>
            <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6, marginBottom: "24px", fontFamily: "'DM Sans', sans-serif" }}>
              This permanently deletes your profile and all your reviews. There&apos;s no going back.
            </p>
            {deleteError && (
              <p style={{ fontSize: "12px", color: "#EF4444", marginBottom: "12px", fontFamily: "'DM Sans', sans-serif" }}>{deleteError}</p>
            )}
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteError(""); }}
                disabled={deleting}
                style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "13px", color: "var(--cream)", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                style={{ flex: 1, background: "#EF4444", border: "none", borderRadius: "14px", padding: "13px", color: "white", fontSize: "14px", fontWeight: 700, cursor: deleting ? "default" : "pointer", fontFamily: "'Syne', sans-serif", opacity: deleting ? 0.6 : 1 }}
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit sheet */}
      {editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 50, display: "flex", alignItems: "flex-end" }}>
          <div style={{ width: "100%", maxWidth: "512px", margin: "0 auto" }}>
          <div style={{ background: "var(--surface)", borderRadius: "20px 20px 0 0", padding: "24px 20px", width: "100%", borderTop: "1px solid var(--border)" }}>
            <h3 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, color: "var(--cream)", fontSize: "17px", marginBottom: "20px" }}>Edit Profile</h3>
            <label style={{ fontSize: "10px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: "8px", fontFamily: "'DM Sans', sans-serif" }}>
              Name
            </label>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="Your name"
              style={{ width: "100%", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px", color: "var(--cream)", fontSize: "14px", outline: "none", marginBottom: "16px", boxSizing: "border-box" }}
            />
            <button
              onClick={() => {
                const n = editName.trim();
                if (n) { localStorage.setItem("fc_my_name", n); setMyName(n); }
                setEditing(false);
              }}
              style={{ width: "100%", background: "var(--orange)", border: "none", borderRadius: "14px", padding: "14px", color: "white", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}
            >
              Done
            </button>
          </div>
          </div>{/* end max-width wrapper */}
        </div>
      )}

      {/* Activity bottom sheets (Liked / Saved / Comments) */}
      {activitySheet && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 60, display: "flex", alignItems: "flex-end" }}
          onClick={e => { if (e.target === e.currentTarget) setActivitySheet(null); }}
        >
          <div style={{ width: "100%", maxWidth: "512px", margin: "0 auto" }}>
          <div style={{ background: "var(--surface)", borderRadius: "24px 24px 0 0", width: "100%", maxHeight: "75vh", display: "flex", flexDirection: "column", borderTop: "1px solid var(--border)" }}>
            {/* Handle */}
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
              <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: "var(--border)" }} />
            </div>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 20px 14px" }}>
              <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "17px", color: "var(--cream)" }}>
                {activitySheet === "liked" ? "Liked Posts" : activitySheet === "saved" ? "Saved Places" : "My Comments"}
              </p>
              <button onClick={() => setActivitySheet(null)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "6px 14px", fontSize: "13px", color: "var(--muted)", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
                Done
              </button>
            </div>
            {/* Content */}
            <div style={{ overflowY: "auto", flex: 1, padding: "0 16px 24px", display: "flex", flexDirection: "column", gap: "8px" }}>

              {/* Liked */}
              {activitySheet === "liked" && (
                likedReviews.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                    <Heart size={28} strokeWidth={1.6} color="var(--muted)" />
                    <p style={{ fontSize: "14px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>No liked posts yet</p>
                  </div>
                ) : likedReviews.map((r) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "12px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "12px 14px" }}>
                    <div style={{ width: 40, height: 40, background: restaurantGradient(r.restaurant_name), borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: 700, color: "white", fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
                      {r.restaurant_name[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.restaurant_name}</p>
                      <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginTop: "1px" }}>by {r.reviewer_name}</p>
                    </div>
                    <Heart size={14} strokeWidth={2} color="var(--orange)" fill="var(--orange)" style={{ flexShrink: 0 }} />
                  </div>
                ))
              )}

              {/* Saved */}
              {activitySheet === "saved" && (
                wishlist.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                    <Bookmark size={28} strokeWidth={1.6} color="var(--muted)" />
                    <p style={{ fontSize: "14px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>No saved places yet</p>
                  </div>
                ) : wishlist.map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "12px 14px" }}>
                    <div style={{ width: 40, height: 40, background: restaurantGradient(item.restaurant_name), borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: 700, color: "white", fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
                      {item.restaurant_name[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.restaurant_name}</p>
                      <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginTop: "1px" }}>On your wishlist</p>
                    </div>
                    <Bookmark size={14} strokeWidth={2} color="var(--gold)" fill="var(--gold)" style={{ flexShrink: 0 }} />
                  </div>
                ))
              )}

              {/* Comments */}
              {activitySheet === "comments" && (
                myComments.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                    <MessageCircle size={28} strokeWidth={1.6} color="var(--muted)" />
                    <p style={{ fontSize: "14px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>No comments yet</p>
                  </div>
                ) : myComments.map((c) => (
                  <div key={c.id} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                      <div style={{ width: 28, height: 28, background: restaurantGradient(c.restaurant_name), borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700, color: "white", fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
                        {c.restaurant_name[0]?.toUpperCase() ?? "?"}
                      </div>
                      <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "12px", fontWeight: 700, color: "var(--cream)", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {c.restaurant_name}
                      </p>
                      <p style={{ fontSize: "10px", color: "var(--muted)", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>
                        {new Date(c.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                    <p style={{ fontSize: "13px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5 }}>&ldquo;{c.content}&rdquo;</p>
                  </div>
                ))
              )}

            </div>
          </div>
          </div>{/* end max-width wrapper */}
        </div>
      )}

      {/* Settings bottom sheet */}
      {showSettings && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 60, display: "flex", alignItems: "flex-end" }}
          onClick={e => { if (e.target === e.currentTarget) setShowSettings(false); }}
        >
          <div style={{ width: "100%", maxWidth: "512px", margin: "0 auto" }}>
          <div style={{ background: "var(--surface)", borderRadius: "24px 24px 0 0", width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", borderTop: "1px solid var(--border)" }}>
            {/* Handle */}
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
              <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: "var(--border)" }} />
            </div>
            {/* Title */}
            <div style={{ padding: "12px 20px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "17px", color: "var(--cream)" }}>Settings</p>
              <button onClick={() => setShowSettings(false)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "6px 14px", fontSize: "13px", color: "var(--muted)", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
                Done
              </button>
            </div>
            {/* Scrollable content */}
            <div style={{ overflowY: "auto", flex: 1, padding: "0 0 32px" }}>

            {/* Edit Profile */}
            <div style={{ margin: "0 16px 10px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "18px", overflow: "hidden" }}>
              <button
                onClick={() => { setShowSettings(false); setEditName(myName); setEditing(true); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
              >
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Settings size={16} strokeWidth={2} color="var(--muted)" />
                </div>
                <span style={{ flex: 1, fontSize: "14px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>Edit Profile</span>
                <ChevronRight size={16} strokeWidth={2} color="var(--muted)" />
              </button>
            </div>

            {/* Activity rows */}
            <div style={{ margin: "0 16px 10px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "18px", overflow: "hidden" }}>
              {([
                { key: "liked",    label: "Liked Posts",   Icon: Heart,          count: likedReviews.length },
                { key: "saved",    label: "Saved Places",  Icon: Bookmark,       count: wishlist.length },
                { key: "comments", label: "My Comments",   Icon: MessageCircle,  count: myComments.length },
              ] as const).map(({ key, label, Icon, count }, idx, arr) => (
                <button
                  key={key}
                  onClick={() => { setShowSettings(false); setActivitySheet(key); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", background: "none", border: "none", borderBottom: idx < arr.length - 1 ? "1px solid var(--border)" : "none", cursor: "pointer", textAlign: "left" }}
                >
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon size={16} strokeWidth={2} color="var(--muted)" />
                  </div>
                  <span style={{ flex: 1, fontSize: "14px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>{label}</span>
                  {count > 0 && (
                    <span style={{ fontSize: "12px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginRight: "4px" }}>{count}</span>
                  )}
                  <ChevronRight size={16} strokeWidth={2} color="var(--muted)" />
                </button>
              ))}
            </div>

            {/* Items */}
            <div style={{ margin: "0 16px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "18px", overflow: "hidden" }}>

              {/* Account type */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "15px 16px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Shield size={16} strokeWidth={2} color="var(--muted)" />
                </div>
                <span style={{ flex: 1, fontSize: "14px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>Account Type</span>
                <div style={{ display: "flex", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "3px", gap: "2px" }}>
                  {(["private", "public"] as AccountType[]).map((type) => (
                    <button
                      key={type}
                      onClick={() => updateAccountType(type)}
                      style={{
                        background: accountType === type ? "var(--orange)" : "none",
                        border: "none",
                        borderRadius: 7,
                        padding: "5px 9px",
                        color: accountType === type ? "white" : "var(--muted)",
                        cursor: "pointer",
                        fontSize: "11px",
                        fontWeight: 700,
                        fontFamily: "'DM Sans', sans-serif",
                      }}
                    >
                      {type === "private" ? "Private" : "Public"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Appearance */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "15px 16px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {themeMode === "light"
                    ? <Sun size={16} strokeWidth={2} color="var(--muted)" />
                    : themeMode === "dark"
                    ? <Moon size={16} strokeWidth={2} color="var(--muted)" />
                    : <Monitor size={16} strokeWidth={2} color="var(--muted)" />}
                </div>
                <span style={{ flex: 1, fontSize: "14px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>Appearance</span>
                <div style={{ display: "flex", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "3px", gap: "2px" }}>
                  {(["system", "light", "dark"] as ThemeMode[]).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setThemeMode(opt)}
                      style={{
                        background: themeMode === opt ? "var(--orange)" : "none",
                        border: "none",
                        borderRadius: 7,
                        padding: "5px 9px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      aria-label={opt}
                    >
                      {opt === "system" && <Monitor size={13} strokeWidth={2} color={themeMode === opt ? "white" : "var(--muted)"} />}
                      {opt === "light"  && <Sun     size={13} strokeWidth={2} color={themeMode === opt ? "white" : "var(--muted)"} />}
                      {opt === "dark"   && <Moon    size={13} strokeWidth={2} color={themeMode === opt ? "white" : "var(--muted)"} />}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleLogout}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", padding: "15px 16px", background: "none", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer", textAlign: "left" }}
              >
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <LogOut size={16} strokeWidth={2} color="var(--muted)" />
                </div>
                <span style={{ flex: 1, fontSize: "14px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>Log out</span>
                <ChevronRight size={16} strokeWidth={2} color="var(--muted)" />
              </button>

              <Link href="/privacy" onClick={() => setShowSettings(false)} style={{ textDecoration: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "15px 16px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Shield size={16} strokeWidth={2} color="var(--muted)" />
                  </div>
                  <span style={{ flex: 1, fontSize: "14px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>Privacy Policy</span>
                  <ChevronRight size={16} strokeWidth={2} color="var(--muted)" />
                </div>
              </Link>

              <Link href="/terms" onClick={() => setShowSettings(false)} style={{ textDecoration: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "15px 16px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <FileText size={16} strokeWidth={2} color="var(--muted)" />
                  </div>
                  <span style={{ flex: 1, fontSize: "14px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>Terms of Service</span>
                  <ChevronRight size={16} strokeWidth={2} color="var(--muted)" />
                </div>
              </Link>

              <button
                onClick={() => { setShowSettings(false); setShowDeleteConfirm(true); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", padding: "15px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
              >
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(239,68,68,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Trash2 size={16} strokeWidth={2} color="#EF4444" />
                </div>
                <span style={{ flex: 1, fontSize: "14px", color: "#EF4444", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>Delete account</span>
                <ChevronRight size={16} strokeWidth={2} color="#EF4444" />
              </button>
            </div>

            </div>{/* end scrollable content */}
          </div>
          </div>{/* end max-width wrapper */}
        </div>
      )}

      {/* ── Section 1: Header ── */}
      <div style={{ padding: "20px", position: "relative" }}>
        <div style={{ position: "absolute", top: "20px", right: "20px", display: "flex", gap: "8px" }}>
          <button
            onClick={() => setShowSettings(true)}
            style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            aria-label="Settings"
          >
            <Settings size={15} strokeWidth={2} color="var(--muted)" />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ width: "72px", height: "72px", borderRadius: "22px", background: myName ? avatarGradient(myName) : "var(--card)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", fontWeight: 700, color: "white", flexShrink: 0, fontFamily: "'Syne', sans-serif" }}>
            {myName ? avatarInitials(myName) : "?"}
          </div>
          <div>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "20px", fontWeight: 700, color: "var(--cream)" }}>
              {myName || "Set your name"}
            </p>
            <p style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
              @{(myName || "you").toLowerCase().replace(/\s+/g, "_")}
            </p>
            <p style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
              {totalVisits} visit{totalVisits !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* ── Section 2: Stats Row ── */}
      <div style={{ padding: "0 20px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
          {/* Places */}
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px 10px", textAlign: "center" }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "28px", fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>
              {uniquePlaces}
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px", fontFamily: "'DM Sans', sans-serif" }}>
              Places
            </div>
          </div>
          {/* Dishes */}
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px 10px", textAlign: "center" }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "28px", fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>
              {uniqueDishes}
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px", fontFamily: "'DM Sans', sans-serif" }}>
              Dishes
            </div>
          </div>
          {/* Circle — links to /me/circle */}
          <Link href="/me/circle" style={{ textDecoration: "none" }}>
            <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px 10px", textAlign: "center", cursor: "pointer" }}>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "28px", fontWeight: 700, color: "var(--cream)", lineHeight: 1 }}>
                {circle.length}
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px", fontFamily: "'DM Sans', sans-serif" }}>
                Circle
              </div>
            </div>
          </Link>
        </div>
      </div>

      {/* ── Your List ── */}
      <div style={{ padding: "0 20px 8px" }}>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "10px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: "12px" }}>Your List</p>
        {rankedPlaces.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "48px 0", gap: "16px" }}>
              <p style={{ fontSize: "15px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", margin: 0 }}>
                You haven&apos;t logged any places yet
              </p>
              <Link href="/reviews/new" style={{ textDecoration: "none" }}>
                <button style={{ background: "var(--orange)", color: "white", border: "none", borderRadius: "14px", padding: "13px 28px", fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
                  Share your first meal
                </button>
              </Link>
            </div>
          ) : (
            <div>
              {rankedPlaces.map((place, i) => (
                <div key={place.name} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "13px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: "18px", fontWeight: 700, color: RANK_COLORS[i + 1] ?? "var(--border)", width: "24px", textAlign: "center", flexShrink: 0 }}>
                    {i + 1}
                  </div>
                  <div style={{ width: "44px", height: "44px", background: restaurantGradient(place.name), borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", fontWeight: 700, color: "white", fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
                    {place.name[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{place.name}</p>
                    <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
                      {place.visitCount} visit{place.visitCount !== 1 ? "s" : ""}
                      {place.dishCount > 0 && ` · ${place.dishCount} dish${place.dishCount !== 1 ? "es" : ""}`}
                      {place.isRegular && (
                        <span style={{ marginLeft: "8px", background: "var(--orange-dim)", border: "1px solid rgba(240,96,48,0.25)", borderRadius: "20px", padding: "1px 7px", fontSize: "9px", fontWeight: 700, color: "var(--orange)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          Regular
                        </span>
                      )}
                    </p>
                  </div>
                  {place.score10 > 0 && (
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--cream)" }}>{place.score10}</span>
                      <span style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>/10</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
