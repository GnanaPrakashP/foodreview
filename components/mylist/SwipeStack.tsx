"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Comment, Review } from "@/lib/types";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";

function BoxedPostCard({
  review,
  likeCountMap,
  commentMap,
  likedMap,
  bookmarkedMap,
  profileMap,
  myName,
  priority,
}: {
  review: Review;
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  likedMap: Record<string, boolean>;
  bookmarkedMap: Record<string, boolean>;
  profileMap: Record<string, string>;
  myName: string;
  priority: boolean;
}) {
  const engagement = commentMap[review.id];

  return (
    <div
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        borderRadius: 22,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        scrollbarWidth: "none",
        touchAction: "pan-y",
      }}
      className="hide-scrollbar card-slide-up"
    >
      <CircleFeedCard
        review={review}
        initialLikeCount={likeCountMap[review.id] ?? 0}
        initialCommentCount={engagement?.count ?? 0}
        initialLiked={likedMap[review.id] ?? false}
        initialBookmarked={bookmarkedMap[review.id] ?? false}
        initialMyName={myName}
        profileMap={profileMap}
        priorityImage={priority}
        noBorder
      />
    </div>
  );
}

export default function SwipeStack({
  posts,
  loading,
  onSavePost,
  onNeedMore,
  likeCountMap,
  commentMap,
  likedMap,
  bookmarkedMap,
  profileMap,
  myName,
}: {
  posts: Review[];
  loading: boolean;
  onSavePost: (post: Review) => void;
  onNeedMore?: () => void;
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  likedMap: Record<string, boolean>;
  bookmarkedMap: Record<string, boolean>;
  profileMap: Record<string, string>;
  myName: string;
}) {
  const [stack, setStack] = useState<Review[]>(posts);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dismissDir, setDismissDir] = useState<"left" | "right" | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const draggedRef = useRef(false);

  useEffect(() => {
    setStack((current) => {
      const currentIds = new Set(current.map((post) => post.id));
      const fresh = posts.filter((post) => !currentIds.has(post.id) && !seenIds.has(post.id));
      return fresh.length ? [...current, ...fresh] : current;
    });
  }, [posts, seenIds]);

  useEffect(() => {
    if (stack.length <= 3) onNeedMore?.();
  }, [onNeedMore, stack.length]);

  const current = stack[0];

  function dismiss(dir: "left" | "right") {
    if (dismissDir || !current) return;
    if (dir === "right") onSavePost(current);
    setDismissDir(dir);
    setIsDragging(false);
    setSeenIds((prev) => new Set(prev).add(current.id));
    setTimeout(() => {
      setStack((prev) => prev.slice(1));
      setDismissDir(null);
      setDragX(0);
    }, 330);
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (dismissDir || !current) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    draggedRef.current = false;
    setIsDragging(true);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!isDragging || dismissDir) return;
    const nextDragX = e.clientX - startXRef.current;
    const dragY = e.clientY - startYRef.current;
    if (Math.abs(nextDragX) > 8 && Math.abs(nextDragX) > Math.abs(dragY)) {
      draggedRef.current = true;
      e.preventDefault();
    }
    setDragX(nextDragX);
  }

  function handlePointerUp() {
    if (!isDragging) return;
    setIsDragging(false);
    if (Math.abs(dragX) >= 80) {
      dismiss(dragX > 0 ? "right" : "left");
    } else {
      setDragX(0);
    }
  }

  const cardTransform =
    dismissDir === "right" ? "translateX(150%) rotate(22deg)" :
    dismissDir === "left"  ? "translateX(-150%) rotate(-22deg)" :
    `translateX(${dragX}px) rotate(${dragX * 0.045}deg)`;

  const cardTransition = isDragging ? "none" : "transform 0.33s ease";

  const emptyCopy = useMemo(() => {
    if (loading) return "Finding posts worth swiping...";
    return "You have seen all the current picks.";
  }, [loading]);

  if (!current) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", boxSizing: "border-box" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: "40px", marginBottom: "10px" }}>🔍</p>
          <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 800, color: "var(--cream)", marginBottom: "6px" }}>
            {emptyCopy}
          </p>
          <p style={{ fontSize: "13px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>
            Check back soon for more public food posts.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", minHeight: 0, padding: "16px", boxSizing: "border-box", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div
          key={current.id}
          style={{
            position: "relative",
            flex: "0 0 auto",
            width: "100%",
            maxHeight: "100%",
            display: "flex",
            flexDirection: "column",
            transform: cardTransform,
            transition: cardTransition,
            touchAction: "pan-y",
            userSelect: "none",
            cursor: isDragging ? "grabbing" : "grab",
          }}
          onClickCapture={(event) => {
            if (draggedRef.current) {
              event.preventDefault();
              event.stopPropagation();
              draggedRef.current = false;
            }
          }}
          onPointerDownCapture={handlePointerDown}
          onPointerMoveCapture={handlePointerMove}
          onPointerUpCapture={handlePointerUp}
          onPointerCancelCapture={handlePointerUp}
        >
          <BoxedPostCard
            review={current}
            likeCountMap={likeCountMap}
            commentMap={commentMap}
            likedMap={likedMap}
            bookmarkedMap={bookmarkedMap}
            profileMap={profileMap}
            myName={myName}
            priority
          />

          {dragX > 30 && !dismissDir && (
            <div style={{ position: "absolute", top: 22, right: 18, background: "rgba(34,197,94,0.94)", borderRadius: 12, padding: "7px 14px", transform: "rotate(-10deg)", zIndex: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "white", fontFamily: "'Syne', sans-serif" }}>Save</span>
            </div>
          )}
          {dragX < -30 && !dismissDir && (
            <div style={{ position: "absolute", top: 22, left: 18, background: "rgba(239,68,68,0.94)", borderRadius: 12, padding: "7px 14px", transform: "rotate(10deg)", zIndex: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "white", fontFamily: "'Syne', sans-serif" }}>Skip</span>
            </div>
          )}
      </div>
    </div>
  );
}
