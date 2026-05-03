"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Review, Comment } from "@/lib/types";

function timeAgo(d: string): string {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function gradient(name: string): string {
  const G = [
    "linear-gradient(135deg,#F06030,#C04020)",
    "linear-gradient(135deg,#6366F1,#4F46E5)",
    "linear-gradient(135deg,#3DD68C,#22C55E)",
    "linear-gradient(135deg,#E8A830,#D4821A)",
    "linear-gradient(135deg,#EC4899,#BE185D)",
    "linear-gradient(135deg,#14B8A6,#0F766E)",
  ];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return G[h % G.length];
}

function initials(name: string): string {
  return name.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
}

function restaurantEmoji(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("idli") || n.includes("dosa") || n.includes("tiffin") || n.includes("murugan")) return "🥘";
  if (n.includes("biryani") || n.includes("mughal") || n.includes("dum")) return "🍛";
  if (n.includes("ramen") || n.includes("nagi") || n.includes("japanese") || n.includes("sushi")) return "🍜";
  if (n.includes("pizza") || n.includes("italiano") || n.includes("pasta")) return "🍕";
  if (n.includes("burger") || n.includes("grill")) return "🍔";
  if (n.includes("mess") || n.includes("madurai") || n.includes("mutton") || n.includes("chicken")) return "🍖";
  if (n.includes("cafe") || n.includes("coffee") || n.includes("brew")) return "☕";
  return "🍽️";
}

interface Props {
  review: Review;
  myName: string;
  liked: boolean;
  likeCount: number;
  onLike: () => void;
  onClose: () => void;
}

export default function PostDetailSheet({ review, myName, liked, likeCount, onLike, onClose }: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("comments")
        .select("*")
        .eq("post_id", review.id)
        .order("created_at", { ascending: true }) as { data: Comment[] | null };
      setComments(data ?? []);
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 80);
    })();
  }, [review.id]);

  async function sendComment() {
    const content = text.trim();
    if (!content || !myName || sending) return;
    setSending(true);
    const tempId = `temp-${Date.now()}`;
    const temp: Comment = { id: tempId, post_id: review.id, user_name: myName, content, created_at: new Date().toISOString() };
    setComments(prev => [...prev, temp]);
    setText("");
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 50);

    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("comments")
      .insert({ post_id: review.id, user_name: myName, content })
      .select()
      .single() as { data: Comment | null };
    if (data) setComments(prev => prev.map(c => c.id === tempId ? data : c));

    // Notifications: post owner + other commenters
    const notifs: object[] = [];
    if (review.reviewer_name !== myName) {
      notifs.push({ recipient_name: review.reviewer_name, actor_name: myName, type: "comment", post_id: review.id, restaurant_name: review.restaurant_name, content: content.slice(0, 40) });
    }
    const otherCommenters = [...new Set(comments.map(c => c.user_name))].filter(n => n !== myName && n !== review.reviewer_name);
    for (const commenter of otherCommenters) {
      notifs.push({ recipient_name: commenter, actor_name: myName, type: "also_commented", post_id: review.id, restaurant_name: review.restaurant_name, content: content.slice(0, 40) });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (notifs.length > 0) await (supabase as any).from("notifications").insert(notifs);

    setSending(false);
  }

  async function deleteComment(id: string) {
    setComments(prev => prev.filter(c => c.id !== id));
    setDeletingId(null);
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("comments").delete().eq("id", id).eq("user_name", myName);
  }

  function startLongPress(commentId: string, owner: string) {
    if (owner !== myName) return;
    longPressTimer.current = setTimeout(() => setDeletingId(commentId), 600);
  }
  function endLongPress() { if (longPressTimer.current) clearTimeout(longPressTimer.current); }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 60 }} />
      <div
        style={{
          position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
          width: "100%", maxWidth: "512px", height: "95dvh",
          background: "#0E0B08", borderRadius: "20px 20px 0 0", zIndex: 61,
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Top bar */}
        <div style={{ flexShrink: 0, padding: "12px 20px 8px", display: "flex", alignItems: "center" }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: "13px", cursor: "pointer", padding: "4px", fontFamily: "'DM Sans', sans-serif" }}>
            ← Back
          </button>
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: "#2E2720" }} />
          </div>
          <div style={{ width: "52px" }} />
        </div>

        {/* Scrollable body */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", paddingBottom: "84px" }}>
          {/* Post summary */}
          <div style={{ padding: "0 16px 16px", borderBottom: "1px solid #2E2720" }}>
            <div style={{ height: "200px", borderRadius: "16px", overflow: "hidden", background: "linear-gradient(160deg,#2A1008 0%,#6B3318 50%,#A04020 100%)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "12px", position: "relative" }}>
              {review.photo_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={review.photo_url} alt={review.restaurant_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <span style={{ fontSize: "64px" }}>{restaurantEmoji(review.restaurant_name)}</span>
              }
              {review.items[0]?.name && (
                <span style={{ position: "absolute", bottom: "10px", left: "10px", background: "rgba(255,255,255,0.1)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.15)", color: "white", fontSize: "11px", fontWeight: 500, padding: "4px 10px", borderRadius: "20px" }}>
                  {review.items[0].name}
                </span>
              )}
            </div>

            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "18px", fontWeight: 800, color: "var(--cream)", marginBottom: "4px" }}>
              {review.restaurant_name}
            </h2>

            {review.body && (
              <div style={{ padding: "10px 12px", background: "var(--surface)", borderLeft: "3px solid var(--orange)", borderRadius: "0 10px 10px 0", marginBottom: "10px" }}>
                <p style={{ fontFamily: "'Instrument Serif', serif", fontStyle: "italic", fontSize: "15px", color: "var(--cream)", lineHeight: 1.5 }}>
                  &ldquo;{review.body}&rdquo;
                </p>
              </div>
            )}

            {review.items.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                {review.items.map((it, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "20px", padding: "4px 10px", fontSize: "11px", color: "var(--muted)" }}>
                    {it.name}{it.rating > 0 && <span style={{ fontSize: "10px", letterSpacing: "-1px" }}>{"⭐".repeat(it.rating)}</span>}
                  </span>
                ))}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <button onClick={onLike} disabled={!myName} style={{ background: "none", border: "none", cursor: myName ? "pointer" : "default", display: "flex", alignItems: "center", gap: "5px", padding: 0 }}>
                <span style={{ fontSize: "16px", color: liked ? "#E84040" : "#7A6E65", transition: "color 0.15s" }}>♥</span>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--muted)" }}>{likeCount}</span>
              </button>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--muted)" }}>
                💬 {comments.length} comment{comments.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Comments list */}
          <div style={{ padding: "0 16px" }}>
            {loading && (
              <div style={{ padding: "20px 0", display: "flex", flexDirection: "column", gap: "12px" }}>
                {[1, 2].map(i => (
                  <div key={i} style={{ display: "flex", gap: "10px" }}>
                    <div className="animate-pulse" style={{ width: "32px", height: "32px", borderRadius: "50%", background: "var(--card)", flexShrink: 0 }} />
                    <div className="animate-pulse" style={{ height: "40px", flex: 1, background: "var(--card)", borderRadius: "10px" }} />
                  </div>
                ))}
              </div>
            )}
            {!loading && comments.map(c => (
              <div
                key={c.id}
                onMouseDown={() => startLongPress(c.id, c.user_name)}
                onMouseUp={endLongPress}
                onMouseLeave={endLongPress}
                onTouchStart={() => startLongPress(c.id, c.user_name)}
                onTouchEnd={endLongPress}
                style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "12px 0", borderBottom: "1px solid #2E2720" }}
              >
                <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: gradient(c.user_name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "white", flexShrink: 0 }}>
                  {initials(c.user_name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--cream)", lineHeight: 1.4 }}>
                    <strong>{c.user_name}</strong> {c.content}
                  </p>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", color: "var(--muted)", marginTop: "3px" }}>
                    {timeAgo(c.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Comment input */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, borderTop: "1px solid #2E2720", background: "#211C17", padding: "10px 14px", paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))", display: "flex", alignItems: "center", gap: "10px" }}>
          {myName && (
            <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: gradient(myName), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "white", flexShrink: 0 }}>
              {initials(myName)}
            </div>
          )}
          <input
            type="text"
            placeholder={myName ? "Add a comment..." : "Set your name to comment"}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendComment()}
            disabled={!myName}
            maxLength={500}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: "13px" }}
          />
          <button
            onClick={sendComment}
            disabled={!text.trim() || !myName || sending}
            style={{ background: text.trim() && myName ? "var(--orange)" : "var(--muted)", border: "none", borderRadius: "10px", padding: "8px 14px", color: "white", fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 600, cursor: text.trim() && myName ? "pointer" : "default", flexShrink: 0, transition: "background 0.15s" }}
          >
            Send
          </button>
        </div>

        {/* Long-press delete confirmation */}
        {deletingId && (
          <>
            <div onClick={() => setDeletingId(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", borderRadius: "20px 20px 0 0", zIndex: 10 }} />
            <div style={{ position: "absolute", bottom: 90, left: 16, right: 16, background: "var(--surface)", borderRadius: "16px", padding: "8px", zIndex: 11 }}>
              <button onClick={() => deleteComment(deletingId)} style={{ width: "100%", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "12px", padding: "14px", color: "#EF4444", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
                Delete comment
              </button>
              <button onClick={() => setDeletingId(null)} style={{ width: "100%", background: "none", border: "none", padding: "10px", color: "var(--muted)", fontSize: "13px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
