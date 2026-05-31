"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Comment, Review } from "@/lib/types";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";

type FeedRequestStatus = "idle" | "loading" | "pending" | "joined";

function BoxedPostCard({
  review,
  likeCountMap,
  commentMap,
  likedMap,
  bookmarkedMap,
  profileMap,
  myName,
  priority,
  requestStatus,
  onRequestClick,
}: {
  review: Review;
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  likedMap: Record<string, boolean>;
  bookmarkedMap: Record<string, boolean>;
  profileMap: Record<string, string>;
  myName: string;
  priority: boolean;
  requestStatus?: FeedRequestStatus;
  onRequestClick?: () => void;
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
        requestStatus={requestStatus}
        onRequestClick={onRequestClick}
        noBorder
      />
    </div>
  );
}

export default function SwipeStack({
  posts,
  loading,
  onPickPost,
  onSkipPost,
  onNeedMore,
  undoKey = 0,
  undoPost = null,
  likeCountMap,
  commentMap,
  likedMap,
  bookmarkedMap,
  profileMap,
  myName,
  requestStatusFor,
  onRequestPostAuthor,
}: {
  posts: Review[];
  loading: boolean;
  onPickPost: (post: Review) => void;
  onSkipPost?: (post: Review) => void;
  onNeedMore?: () => void;
  undoKey?: number;
  undoPost?: Review | null;
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  likedMap: Record<string, boolean>;
  bookmarkedMap: Record<string, boolean>;
  profileMap: Record<string, string>;
  myName: string;
  requestStatusFor?: (name: string) => FeedRequestStatus;
  onRequestPostAuthor?: (name: string) => void;
}) {
  const [stack, setStack] = useState<Review[]>(posts);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dismissDir, setDismissDir] = useState<"left" | "right" | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const dragXRef = useRef(0);
  const isDraggingRef = useRef(false);
  const draggedRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStack((current) => {
      const availablePosts = new Map(posts.map((post) => [post.id, post]));
      let changed = false;

      const reconciled = current.reduce<Review[]>((next, post, index) => {
        const freshVersion = availablePosts.get(post.id);
        if (freshVersion) {
          next.push(freshVersion);
          if (freshVersion !== post) changed = true;
          return next;
        }

        // Preserve the active card during an in-flight gesture so a background
        // refresh cannot yank it out from under the user's finger.
        if (index === 0 && (isDragging || dismissDir)) {
          next.push(post);
          return next;
        }

        changed = true;
        return next;
      }, []);

      const currentIds = new Set(reconciled.map((post) => post.id));
      const fresh = posts.filter((post) => !currentIds.has(post.id) && !seenIds.has(post.id));
      if (fresh.length) changed = true;
      return changed ? [...reconciled, ...fresh] : current;
    });
  }, [dismissDir, isDragging, posts, seenIds]);

  useEffect(() => {
    if (stack.length <= 3) onNeedMore?.();
  }, [onNeedMore, stack.length]);

  // React's synthetic onPointerMoveCapture cannot call preventDefault() reliably
  // because browsers make touchmove passive by default. A non-passive DOM listener
  // on the card wrapper intercepts horizontal gestures before the photo carousel's
  // overflow-x:auto can claim native scroll, while still allowing vertical pan.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (!e.touches.length) return;
      const deltaX = Math.abs(e.touches[0].clientX - startXRef.current);
      const deltaY = Math.abs(e.touches[0].clientY - startYRef.current);
      if (deltaX > 5 && deltaX > deltaY) {
        e.preventDefault();
      }
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, [stack[0]?.id]);

  const current = stack[0];

  // Undo: when undoKey increments, prepend undoPost to the front of the stack.
  useEffect(() => {
    if (undoKey === 0 || !undoPost) return;
    setStack(prev => {
      const filtered = prev.filter(p => p.id !== undoPost.id);
      return [undoPost, ...filtered];
    });
    setSeenIds(prev => {
      const next = new Set(prev);
      next.delete(undoPost.id);
      return next;
    });
  }, [undoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function dismiss(dir: "left" | "right") {
    if (dismissDir || !current) return;
    if (dir === "right") onPickPost(current);
    if (dir === "left") onSkipPost?.(current);
    setDismissDir(dir);
    setIsDragging(false);
    isDraggingRef.current = false;
    setSeenIds((prev) => new Set(prev).add(current.id));
    setTimeout(() => {
      setStack((prev) => prev.slice(1));
      setDismissDir(null);
      setDragX(0);
      dragXRef.current = 0;
    }, 330);
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (dismissDir || !current) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    dragXRef.current = 0;
    isDraggingRef.current = true;
    draggedRef.current = false;
    setIsDragging(true);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!isDraggingRef.current || dismissDir) return;
    const nextDragX = e.clientX - startXRef.current;
    const dragY = e.clientY - startYRef.current;
    if (Math.abs(nextDragX) > 8 && Math.abs(nextDragX) > Math.abs(dragY)) {
      draggedRef.current = true;
      e.preventDefault();
    }
    dragXRef.current = nextDragX;
    setDragX(nextDragX);
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!isDraggingRef.current) return;
    const pointerUpDragX = e.clientX - startXRef.current;
    setIsDragging(false);
    isDraggingRef.current = false;
    const finalDragX = Math.abs(dragXRef.current) > Math.abs(pointerUpDragX)
      ? dragXRef.current
      : pointerUpDragX;
    if (Math.abs(finalDragX) >= 80) {
      dismiss(finalDragX > 0 ? "right" : "left");
    } else {
      dragXRef.current = 0;
      setDragX(0);
    }
  }

  const cardTransform =
    dismissDir === "right" ? "translateX(150%) rotate(22deg)" :
    dismissDir === "left"  ? "translateX(-150%) rotate(-22deg)" :
    `translateX(${dragX}px) rotate(${dragX * 0.045}deg)`;

  const cardTransition = isDragging ? "none" : "transform 0.33s ease, box-shadow 0.25s ease";

  // Glow builds from 10 px drag → full at 70 px, matches dismiss threshold at 80 px.
  const glowIntensity = dismissDir ? 0 : Math.min(1, Math.max(0, (Math.abs(dragX) - 10) / 60));
  const glowGreen = `34,197,94`;
  const glowRed   = `239,68,68`;
  const glowRgb   = dragX >= 0 ? glowGreen : glowRed;
  const cardBoxShadow = glowIntensity > 0
    ? [
        `0 0 0 2px rgba(${glowRgb},${(glowIntensity * 0.85).toFixed(2)})`,
        `0 0 18px 4px rgba(${glowRgb},${(glowIntensity * 0.45).toFixed(2)})`,
        `0 0 48px 14px rgba(${glowRgb},${(glowIntensity * 0.18).toFixed(2)})`,
      ].join(", ")
    : "none";

  const emptyCopy = useMemo(() => {
    if (loading) return "Finding posts worth swiping...";
    return "You have seen all the current picks.";
  }, [loading]);

  if (!current) {
    if (loading) {
      return (
        <div style={{ height: "100%", padding: "16px", boxSizing: "border-box" }}>
          <div className="animate-pulse" style={{ height: "100%", borderRadius: 22, background: "var(--card)", border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ aspectRatio: "4/5", background: "var(--surface)" }} />
            <div style={{ padding: 16 }}>
              <div style={{ height: 18, width: "58%", borderRadius: 6, background: "var(--surface)", marginBottom: 10 }} />
              <div style={{ height: 12, width: "36%", borderRadius: 6, background: "var(--surface)" }} />
            </div>
          </div>
        </div>
      );
    }
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", boxSizing: "border-box" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: "40px", marginBottom: "10px" }}>🔍</p>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 800, color: "var(--cream)", marginBottom: "6px" }}>
            {emptyCopy}
          </p>
          <p style={{ fontSize: "13px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>
            Check back soon for more public food posts.
          </p>
        </div>
      </div>
    );
  }

  // Background tint for the whole swipe area — complements the card edge glow.
  const containerBg = glowIntensity > 0
    ? dragX > 0
      ? `rgba(${glowGreen},${(glowIntensity * 0.13).toFixed(2)})`
      : `rgba(${glowRed},${(glowIntensity * 0.13).toFixed(2)})`
    : "transparent";
  const containerTransition = isDragging ? "none" : "background 0.25s ease";

  return (
    // overflow visible so the card's box-shadow can spread into the background;
    // the parent wrapper in HungryPageClient already has overflow:hidden to clip
    // the card during its fly-off dismiss animation.
    <div style={{ height: "100%", minHeight: 0, padding: "16px", boxSizing: "border-box", display: "flex", flexDirection: "column", background: containerBg, transition: containerTransition }}>
      <div
          ref={cardRef}
          key={current.id}
          style={{
            position: "relative",
            flex: "0 0 auto",
            width: "100%",
            maxHeight: "100%",
            display: "flex",
            flexDirection: "column",
            borderRadius: 22,
            transform: cardTransform,
            transition: cardTransition,
            boxShadow: cardBoxShadow,
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
            requestStatus={requestStatusFor?.(current.reviewer_name)}
            onRequestClick={() => onRequestPostAuthor?.(current.reviewer_name)}
          />

          {/* Edge light wash — directional gradient that grows with drag distance */}
          {glowIntensity > 0 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 22,
                pointerEvents: "none",
                zIndex: 8,
                background: dragX > 0
                  ? `linear-gradient(to left, rgba(${glowGreen},${(glowIntensity * 0.28).toFixed(2)}) 0%, rgba(${glowGreen},${(glowIntensity * 0.06).toFixed(2)}) 45%, transparent 70%)`
                  : `linear-gradient(to right, rgba(${glowRed},${(glowIntensity * 0.28).toFixed(2)}) 0%, rgba(${glowRed},${(glowIntensity * 0.06).toFixed(2)}) 45%, transparent 70%)`,
              }}
            />
          )}
      </div>
    </div>
  );
}
