"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { restaurantGradient } from "@/lib/profile";
import type { Review } from "@/lib/types";

interface MyComment {
  id: string;
  post_id: string;
  content: string;
  created_at: string;
  reviews: Review | Review[] | null;
}

function nestedReview(value: Review | Review[] | null): Review | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function commentDate(value: string): string {
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function MyCommentsPage() {
  const router = useRouter();
  const [items, setItems] = useState<MyComment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const myName = localStorage.getItem("fc_my_name") ?? "";
    if (!myName) { setLoading(false); return; }

    const supabase = createClient();

    async function loadComments() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("comments")
        .select("id, post_id, content, created_at, reviews(*)")
        .eq("user_name", myName)
        .order("created_at", { ascending: false });

      const comments = (data ?? []) as MyComment[];
      setItems(comments);
      setLoading(false);
    }

    loadComments();
  }, []);

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: 100 }}>
      <div style={{ padding: "16px 20px 24px", display: "flex", alignItems: "center", gap: "12px" }}>
        <button onClick={() => router.push("/me/settings")} style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
        </button>
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "20px", color: "var(--cream)" }}>My Comments</h1>
      </div>

      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        {loading ? (
          [1,2,3].map(i => <div key={i} style={{ height: 118, background: "var(--card)", borderRadius: 16, opacity: 0.5 }} className="animate-pulse" />)
        ) : items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
            <MessageCircle size={32} strokeWidth={1.5} color="var(--muted)" />
            <p style={{ fontSize: "14px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>No comments yet</p>
          </div>
        ) : items.map((c) => {
          const review = nestedReview(c.reviews);
          const restaurantName = review?.restaurant_name ?? "Unknown";
          return (
            <button
              key={c.id}
              onClick={() => review && router.push(`/reviews/${review.id}`)}
              disabled={!review}
              style={{
                width: "100%",
                textAlign: "left",
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "16px",
                padding: "14px",
                cursor: review ? "pointer" : "default",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "10px" }}>
                <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 800, color: "var(--cream)" }}>Your comment</p>
                <p style={{ fontSize: "10px", color: "var(--muted)", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>{commentDate(c.created_at)}</p>
              </div>

              <div style={{ background: "var(--surface)", borderLeft: "3px solid var(--orange)", borderRadius: "0 10px 10px 0", padding: "10px 12px", marginBottom: "11px" }}>
                <p style={{ fontSize: "14px", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.45 }}>
                  &ldquo;{c.content}&rdquo;
                </p>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                <div style={{ width: 26, height: 26, background: restaurantGradient(restaurantName), borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "white", fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
                  {restaurantName[0]?.toUpperCase() ?? "?"}
                </div>
                <p style={{ flex: 1, minWidth: 0, fontSize: "12px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  On {restaurantName}{review ? ` by ${review.reviewer_name}` : ""}
                </p>
                {review && <span style={{ fontSize: "11px", color: "var(--orange)", fontFamily: "'DM Sans', sans-serif", fontWeight: 700, flexShrink: 0 }}>View post</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
