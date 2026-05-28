"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bookmark } from "lucide-react";
import { restaurantGradient } from "@/lib/profile";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";
import type { Comment, Review } from "@/lib/types";
import { cachedCircleStatus, invalidateCircleStatusCache } from "@/lib/browser-circle-status";
import { invalidateCachedJson } from "@/lib/browser-api-cache";
import { addName, isAcceptedCircleResponse, isOneWayCircleResponse, personStatusFor, removeName } from "@/lib/people-circle-state";

interface WishlistItem {
  id: string;
  restaurant_name: string;
}

type SavedPostsResponse = {
  reviews: Review[];
  placeItems: WishlistItem[];
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  likedByMeMap: Record<string, boolean>;
  bookmarkedPostMap: Record<string, boolean>;
  profileMap: Record<string, string>;
  myName: string;
};

export default function SavedPlacesPage() {
  const router = useRouter();
  const [postItems, setPostItems] = useState<Review[]>([]);
  const [placeItems, setPlaceItems] = useState<WishlistItem[]>([]);
  const [likeCountMap, setLikeCountMap] = useState<Record<string, number>>({});
  const [commentMap, setCommentMap] = useState<Record<string, { count: number; top: Comment }>>({});
  const [likedByMeMap, setLikedByMeMap] = useState<Record<string, boolean>>({});
  const [bookmarkedPostMap, setBookmarkedPostMap] = useState<Record<string, boolean>>({});
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [myName, setMyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [circleMembers, setCircleMembers] = useState<Set<string>>(new Set());
  const [pendingSent, setPendingSent] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function loadSavedPosts() {
      try {
        const response = await fetch("/api/me/saved", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as SavedPostsResponse;
        setPostItems(data.reviews ?? []);
        setPlaceItems(data.placeItems ?? []);
        setLikeCountMap(data.likeCountMap ?? {});
        setCommentMap(data.commentMap ?? {});
        setLikedByMeMap(data.likedByMeMap ?? {});
        setBookmarkedPostMap(data.bookmarkedPostMap ?? {});
        setProfileMap(data.profileMap ?? {});
        setMyName(data.myName ?? "");
      } finally {
        setLoading(false);
      }
    }

    loadSavedPosts();
  }, []);

  useEffect(() => {
    if (!myName) return;
    let cancelled = false;
    cachedCircleStatus(myName)
      .then((data) => {
        if (cancelled) return;
        setCircleMembers(new Set(data.members ?? []));
        setPendingSent(new Set(data.pendingSent ?? []));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [myName]);

  function requestStatusFor(name: string) {
    const status = personStatusFor(name, { circleMembers, pendingSent });
    return status === "one_way" ? "joined" : status === "sent" ? "pending" : "idle";
  }

  async function requestCircleAccess(receiverName: string) {
    if (!myName || myName === receiverName || personStatusFor(receiverName, { circleMembers, pendingSent }) !== "none") return;
    setPendingSent((prev) => addName(prev, receiverName));
    const res = await fetch("/api/circle/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderName: myName, receiverName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPendingSent((prev) => removeName(prev, receiverName));
      return;
    }
    invalidateCircleStatusCache(myName);
    invalidateCircleStatusCache(receiverName);
    invalidateCachedJson("/api/feed/circle");
    invalidateCachedJson("/api/people");
    if (isAcceptedCircleResponse(data) || isOneWayCircleResponse(data)) {
      setPendingSent((prev) => removeName(prev, receiverName));
      setCircleMembers((prev) => addName(prev, receiverName));
    }
  }

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: 100 }}>
      <div style={{ padding: "16px 20px 24px", display: "flex", alignItems: "center", gap: "12px" }}>
        <button onClick={() => router.push("/me/settings")} style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
        </button>
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: "20px", color: "var(--cream)" }}>Saved Posts</h1>
      </div>

      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: "16px" }}>
        {loading ? (
          [1,2,3].map(i => <div key={i} style={{ height: 220, background: "var(--card)", borderRadius: 22, opacity: 0.5 }} className="animate-pulse" />)
        ) : postItems.length === 0 && placeItems.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
            <Bookmark size={32} strokeWidth={1.5} color="var(--muted)" />
            <p style={{ fontSize: "14px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>No saved posts yet</p>
          </div>
        ) : (
          <>
            {postItems.map((review) => (
              <CircleFeedCard
                key={review.id}
                review={review}
                initialLikeCount={likeCountMap[review.id] ?? 0}
                initialCommentCount={commentMap[review.id]?.count ?? 0}
                initialLiked={likedByMeMap[review.id] ?? false}
                initialBookmarked={bookmarkedPostMap[review.id] ?? true}
                initialMyName={myName}
                profileMap={profileMap}
                requestStatus={requestStatusFor(review.reviewer_name)}
                onRequestClick={() => requestCircleAccess(review.reviewer_name)}
              />
            ))}
            {placeItems.map((item) => (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "12px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "12px 14px" }}>
                <div style={{ width: 40, height: 40, background: restaurantGradient(item.restaurant_name), borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: 700, color: "white", fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }}>
                  {item.restaurant_name[0]?.toUpperCase() ?? "?"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.restaurant_name}</p>
                  <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginTop: "1px" }}>Saved before posts were attached</p>
                </div>
                <Bookmark size={14} strokeWidth={2} color="var(--gold)" fill="var(--gold)" style={{ flexShrink: 0 }} />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
