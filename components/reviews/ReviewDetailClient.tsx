"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bookmark, Heart, MessageCircle, Send, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Comment, Review } from "@/lib/types";
import { avatarGradient, avatarInitials } from "@/lib/profile";
import { googleMapsUrl, restaurantLocationLabel } from "@/lib/location";

type Props = {
  review: Review;
  initialLikeCount: number;
  initialComments: Comment[];
  initialMyName: string;
  autoFocusComment?: boolean;
  backHref?: string;
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ReviewDetailClient({
  review,
  initialLikeCount,
  initialComments,
  initialMyName,
  autoFocusComment = false,
  backHref = "/",
}: Props) {
  const locationLabel = restaurantLocationLabel(review);
  const mapsUrl = googleMapsUrl(review);
  const [myName, setMyName] = useState(initialMyName);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkBounceKey, setBookmarkBounceKey] = useState(0);
  const [comments, setComments] = useState(initialComments);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const photos = review.photo_urls?.length ? review.photo_urls : review.photo_url ? [review.photo_url] : [];
  const initials = avatarInitials(review.reviewer_name);

  useEffect(() => {
    const name = localStorage.getItem("fc_my_name") || initialMyName;
    setMyName(name);
    if (!name) return;

    (async () => {
      const supabase = createClient();
      const [{ data: likeData }, { data: wishData }] = await Promise.all([
        (supabase as any).from("likes").select("id").eq("post_id", review.id).eq("user_name", name).maybeSingle(),
        (supabase as any).from("wishlist").select("id").eq("user_name", name).eq("restaurant_name", review.restaurant_name).maybeSingle(),
      ]);
      setLiked(Boolean(likeData));
      setBookmarked(Boolean(wishData));
    })();
  }, [initialMyName, review.id, review.restaurant_name]);

  useEffect(() => {
    if (!autoFocusComment) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 150);
    return () => window.clearTimeout(timer);
  }, [autoFocusComment]);

  const toggleLike = useCallback(async () => {
    if (!myName) return;
    const supabase = createClient();

    if (liked) {
      setLiked(false);
      setLikeCount((count) => Math.max(0, count - 1));
      await (supabase as any).from("likes").delete().eq("post_id", review.id).eq("user_name", myName);
      await fetch("/api/notifications/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "POST_UNLIKED", reviewId: review.id, actorName: myName }),
      }).catch(() => {});
      return;
    }

    setLiked(true);
    setLikeCount((count) => count + 1);
    await (supabase as any).from("likes").insert({ post_id: review.id, user_name: myName });
    await fetch("/api/notifications/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "POST_LIKED", reviewId: review.id, actorName: myName }),
    }).catch(() => {});
  }, [liked, myName, review.id]);

  const toggleBookmark = useCallback(async () => {
    if (!myName) return;
    setBookmarkBounceKey((key) => key + 1);
    const supabase = createClient();

    if (bookmarked) {
      setBookmarked(false);
      await (supabase as any).from("wishlist").delete().eq("user_name", myName).eq("restaurant_name", review.restaurant_name);
    } else {
      setBookmarked(true);
      await (supabase as any).from("wishlist").insert({ user_name: myName, restaurant_name: review.restaurant_name, post_id: review.id });
    }
  }, [bookmarked, myName, review.id, review.restaurant_name]);

  async function sendComment() {
    const content = text.trim();
    if (!content || !myName || sending) return;

    setSending(true);
    const tempId = `temp-${Date.now()}`;
    const temp: Comment = { id: tempId, post_id: review.id, user_name: myName, content, created_at: new Date().toISOString() };
    setComments((prev) => [...prev, temp]);
    setText("");

    const supabase = createClient();
    const { data, error } = await (supabase as any)
      .from("comments")
      .insert({ post_id: review.id, user_name: myName, content })
      .select()
      .single() as { data: Comment | null; error: Error | null };

    if (error) {
      setComments((prev) => prev.filter((comment) => comment.id !== tempId));
      setText(content);
      setSending(false);
      return;
    }

    if (data) {
      setComments((prev) => prev.map((comment) => comment.id === tempId ? data : comment));
      await fetch("/api/notifications/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "POST_COMMENTED", reviewId: review.id, commentId: data.id, actorName: myName }),
      }).catch(() => {});
    }
    setSending(false);
  }

  async function deleteComment(id: string) {
    setComments((prev) => prev.filter((comment) => comment.id !== id));
    setDeletingId(null);
    const supabase = createClient();
    await (supabase as any).from("comments").delete().eq("id", id).eq("user_name", myName);
    await fetch("/api/notifications/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "POST_COMMENT_DELETED", commentId: id, actorName: myName }),
    }).catch(() => {});
  }

  function startLongPress(commentId: string, owner: string) {
    if (owner !== myName) return;
    longPressTimer.current = setTimeout(() => setDeletingId(commentId), 600);
  }

  function endLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }

  function focusCommentInput() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", paddingBottom: "92px" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--bg)", borderBottom: "1px solid var(--border)", padding: "12px 16px", display: "flex", alignItems: "center", gap: "12px" }}>
        <Link href={backHref} style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none", flexShrink: 0 }}>
          <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
        </Link>
        <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "18px", fontWeight: 800, color: "var(--cream)" }}>Post</p>
      </div>

      <div style={{ padding: "14px 16px 0" }}>
        <article style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "22px", overflow: "hidden" }}>
          <div style={{ padding: "13px 14px 11px", display: "flex", alignItems: "center", gap: "10px" }}>
            <Link href={`/people/${encodeURIComponent(review.reviewer_name)}`} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
              <div style={{ width: "36px", height: "36px", borderRadius: "12px", background: avatarGradient(review.reviewer_name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, color: "white", flexShrink: 0 }}>
                {initials || "?"}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: "14px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif" }}>
                  <strong>{review.reviewer_name}</strong>
                  <span style={{ color: "var(--muted)", fontWeight: 400 }}> shared a spot</span>
                </p>
              </div>
            </Link>
            <span style={{ fontSize: "11px", color: "var(--muted)", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>
              {timeAgo(review.created_at)}
            </span>
          </div>

          {photos.length > 0 && (
            <div style={{ position: "relative" }}>
              <div
                ref={scrollRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const idx = Math.round(el.scrollLeft / el.clientWidth);
                  setPhotoIndex(idx);
                }}
                style={{ display: "flex", overflowX: "auto", scrollSnapType: "x mandatory", scrollbarWidth: "none", aspectRatio: "3/2" }}
                className="hide-scrollbar"
              >
                {photos.map((url) => (
                  <div key={url} style={{ position: "relative", flexShrink: 0, width: "100%", scrollSnapAlign: "start" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={review.restaurant_name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 50%)" }} />
                  </div>
                ))}
              </div>
              {photos.length > 1 && (
                <div style={{ position: "absolute", top: 10, right: 10, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", borderRadius: 20, padding: "3px 9px", fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: "white", pointerEvents: "none" }}>
                  {photoIndex + 1}/{photos.length}
                </div>
              )}
            </div>
          )}

          <div style={{ padding: "12px 14px 0" }}>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "17px", fontWeight: 700, color: "var(--cream)", lineHeight: 1.1, marginBottom: locationLabel ? "1px" : "6px" }}>
              {review.restaurant_name}
            </h1>
            {locationLabel && (
              <a
                href={mapsUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
                style={{ display: "inline-block", fontFamily: "'DM Sans', sans-serif", fontSize: "11px", lineHeight: 1.2, color: "var(--muted)", marginTop: 0, marginBottom: "8px", textDecoration: "none" }}
              >
                {locationLabel}
              </a>
            )}

            {review.body && (
              <div style={{ padding: "8px 10px", background: "var(--orange-dim)", borderLeft: "3px solid var(--orange)", borderRadius: "0 8px 8px 0", marginBottom: "10px" }}>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--cream)", lineHeight: 1.5 }}>
                  {review.body}
                </p>
              </div>
            )}

            {review.items.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                {review.items.map((item, i) => (
                  <span key={`${item.name}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", padding: "4px 8px", fontSize: "11px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif" }}>
                    {item.name}
                    {item.rating > 0 && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "2px", background: "rgba(232,168,48,0.15)", border: "1px solid rgba(232,168,48,0.25)", borderRadius: "5px", padding: "1px 5px" }}>
                        <Star size={8} strokeWidth={0} fill="#E8A830" />
                        <span style={{ fontSize: "10px", color: "var(--gold)", fontWeight: 700, lineHeight: 1 }}>{item.rating}</span>
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: "14px", paddingTop: "8px", borderTop: "1px solid var(--border)", marginBottom: "8px" }}>
              <button
                onClick={toggleLike}
                disabled={!myName}
                aria-label={liked ? "Unlike post" : "Like post"}
                style={{ background: "none", border: "none", cursor: myName ? "pointer" : "default", display: "flex", alignItems: "center", gap: "5px", padding: 0 }}
              >
                <Heart size={15} strokeWidth={2} fill={liked ? "#E84040" : "none"} color={liked ? "#E84040" : "var(--muted)"} style={{ transition: "color 0.15s", flexShrink: 0 }} />
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--muted)" }}>{likeCount}</span>
              </button>
              <button onClick={focusCommentInput} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: "5px" }}>
                <MessageCircle size={15} strokeWidth={2} color="var(--muted)" style={{ flexShrink: 0 }} />
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--muted)" }}>
                  {comments.length} comment{comments.length !== 1 ? "s" : ""}
                </span>
              </button>
              <button
                key={`bm-${bookmarkBounceKey}`}
                onClick={toggleBookmark}
                className={bookmarkBounceKey > 0 ? "like-pop" : ""}
                style={{ background: "none", border: "none", cursor: myName ? "pointer" : "default", padding: 0, color: bookmarked ? "var(--orange)" : "var(--muted)", lineHeight: 0, transition: "color 0.15s", marginLeft: "auto" }}
                aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
              >
                <Bookmark size={18} strokeWidth={2} fill={bookmarked ? "currentColor" : "none"} />
              </button>
            </div>
            <div style={{ height: "8px" }} />
          </div>
        </article>
      </div>

      <section style={{ padding: "18px 16px 0" }}>
        <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "15px", fontWeight: 800, color: "var(--cream)", marginBottom: "10px" }}>
          Comments
        </h2>
        {comments.length === 0 ? (
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "18px", textAlign: "center" }}>
            <p style={{ color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: "13px" }}>No comments yet</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {comments.map((comment) => (
              <div
                key={comment.id}
                onMouseDown={() => startLongPress(comment.id, comment.user_name)}
                onMouseUp={endLongPress}
                onMouseLeave={endLongPress}
                onTouchStart={() => startLongPress(comment.id, comment.user_name)}
                onTouchEnd={endLongPress}
                style={{ display: "flex", gap: "9px", alignItems: "flex-start", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "10px" }}
              >
                <div style={{ width: "30px", height: "30px", borderRadius: "10px", background: avatarGradient(comment.user_name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "white", flexShrink: 0 }}>
                  {avatarInitials(comment.user_name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--cream)", lineHeight: 1.4 }}>
                    <strong>{comment.user_name}</strong> {comment.content}
                  </p>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", color: "var(--muted)", marginTop: "3px" }}>
                    {timeAgo(comment.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: "512px", borderTop: "1px solid var(--border)", background: "var(--card)", padding: "10px 14px", paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))", display: "flex", alignItems: "center", gap: "10px", zIndex: 20 }}>
        {myName && (
          <div style={{ width: "32px", height: "32px", borderRadius: "10px", background: avatarGradient(myName), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "white", flexShrink: 0 }}>
            {avatarInitials(myName)}
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          placeholder={myName ? "Add a comment..." : "Set your name to comment"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && !event.shiftKey && sendComment()}
          disabled={!myName}
          maxLength={500}
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: "13px", minWidth: 0 }}
        />
        <button
          onClick={sendComment}
          disabled={!text.trim() || !myName || sending}
          aria-label="Send comment"
          style={{ width: 38, height: 38, borderRadius: "12px", border: "none", background: text.trim() && myName ? "var(--orange)" : "var(--muted)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", cursor: text.trim() && myName ? "pointer" : "default", flexShrink: 0 }}
        >
          <Send size={16} strokeWidth={2.2} />
        </button>
      </div>

      {deletingId && (
        <div onClick={() => setDeletingId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 30, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "16px" }}>
          <div onClick={(event) => event.stopPropagation()} style={{ width: "100%", maxWidth: 480, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "16px", padding: "8px" }}>
            <button onClick={() => deleteComment(deletingId)} style={{ width: "100%", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "12px", padding: "14px", color: "#EF4444", fontSize: "14px", fontWeight: 800, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
              Delete comment
            </button>
            <button onClick={() => setDeletingId(null)} style={{ width: "100%", background: "none", border: "none", padding: "11px", color: "var(--muted)", fontSize: "13px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
