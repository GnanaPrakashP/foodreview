"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { Review, Comment } from "@/lib/types";
import CircleFeedCard from "@/components/reviews/CircleFeedCard";

type EngagementMaps = {
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  likedByMeMap: Record<string, boolean>;
  bookmarkedPostMap: Record<string, boolean>;
};
import { avatarGradient, avatarInitials, restaurantGradient } from "@/lib/profile";
import { restaurantLocationLabel } from "@/lib/location";
import { Settings } from "lucide-react";
import { cachedCircleStatus } from "@/lib/browser-circle-status";
import { resolveActorName, resolveDisplayName } from "@/lib/browser-actor";

type MeTab = "timeline" | "reviews";

function StatSkeleton() {
  return (
    <div className="animate-pulse" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px 10px", textAlign: "center" }}>
      <div style={{ height: "28px", background: "var(--surface)", borderRadius: "6px", width: "36px", margin: "0 auto 8px" }} />
      <div style={{ height: "11px", background: "var(--surface)", borderRadius: "4px", width: "48px", margin: "0 auto" }} />
    </div>
  );
}


function uniqueDishesFor(reviews: Review[]): number {
  const pairs = new Set<string>();
  for (const review of reviews) {
    for (const item of review.items) {
      if (item.name.trim()) pairs.add(`${item.name.trim().toLowerCase()}\x00${review.restaurant_name.toLowerCase()}`);
    }
  }
  return pairs.size;
}

function demoReview(
  restaurantName: string,
  area: string,
  body: string,
  itemName: string,
  rating: number,
  createdAt = "2024-05-19T12:00:00.000Z"
): Review {
  return {
    id: `demo-${restaurantName}`,
    reviewer_name: "demo",
    restaurant_id: null,
    restaurant_name: restaurantName,
    area,
    restaurant_address: null,
    restaurant_lat: null,
    restaurant_lng: null,
    items: [{ name: itemName, rating }],
    body,
    photo_url: null,
    photo_urls: [],
    visibility: "public",
    deleted_at: null,
    hidden_at: null,
    reported_at: null,
    status: "active",
    created_at: createdAt,
  };
}

function timelineDateParts(value: string): { day: string; month: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { day: "--", month: "" };
  return {
    day: new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(date),
    month: new Intl.DateTimeFormat("en-US", { month: "short" }).format(date),
  };
}

function timelineLocationLabel(review: Review): string {
  const label = (restaurantLocationLabel(review) ?? "Location not added").replace(/\s+/g, " ").trim();
  if (label.length <= 30) return label;

  const firstPart = label.split(",")[0]?.trim();
  if (firstPart && firstPart.length <= 30) return firstPart;

  return `${label.slice(0, 28).trimEnd()}...`;
}


function MeTabs({ activeTab, onChange }: { activeTab: MeTab; onChange: (tab: MeTab) => void }) {
  const tabs: Array<{ id: MeTab; label: string }> = [
    { id: "reviews", label: "Posts" },
    { id: "timeline", label: "Timeline" },
  ];

  return (
    <div style={{ display: "flex", padding: "0 16px 16px" }}>
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              flex: 1,
              padding: "10px 0 9px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              color: active ? "var(--orange)" : "var(--muted)",
              background: "none",
              border: "none",
              borderBottom: `2px solid ${active ? "var(--orange)" : "var(--border)"}`,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function TimelineTab({ reviews }: { reviews: Review[] }) {
  const entries = reviews.length > 0
    ? [...reviews]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 12)
    : [];
  const demoEntries = entries.length > 0 ? entries : [
    demoReview("Paradise", "Hyderabad", "The classic never disappoints.", "Chicken Biryani", 4.8, "2024-05-23T12:00:00.000Z"),
    demoReview("Third Wave Coffee", "Gachibowli", "Perfect start to the day.", "Third Wave Coffee", 4.5, "2024-01-12T12:00:00.000Z"),
    demoReview("Midnight Shawarma", "Madhapur", "Late night cravings hit different.", "Midnight Shawarma", 4.7, "2023-12-30T12:00:00.000Z"),
  ];

  return (
    <div style={{ padding: "0 20px 110px" }}>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 12, paddingLeft: 8 }}>
        <div style={{ position: "absolute", left: 10.5, top: 10, bottom: 10, width: 1, background: "linear-gradient(180deg, rgba(240,96,48,0.55), rgba(255,255,255,0.08))" }} />
        {demoEntries.map((entry, index) => {
          const date = timelineDateParts(entry.created_at);
          const location = timelineLocationLabel(entry);
          return (
            <div key={`${entry.restaurant_name}-${entry.created_at}-${index}`} style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 6, height: 6, borderRadius: 999, background: "var(--orange)", boxShadow: "0 0 0 4px var(--bg)", flexShrink: 0, position: "relative", zIndex: 1 }} />
              <div style={{ flex: 1, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "11px 13px", display: "grid", gridTemplateColumns: "38px 1px minmax(0, 1fr)", alignItems: "center", gap: 12 }}>
                <div style={{ color: "var(--orange)", fontFamily: "'DM Sans', sans-serif", fontWeight: 800, lineHeight: 1, textAlign: "center" }}>
                  <span style={{ display: "block", fontSize: 14 }}>{date.day}</span>
                  <span style={{ display: "block", marginTop: 3, fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>{date.month}</span>
                </div>
                <div style={{ alignSelf: "stretch", background: "rgba(255,255,255,0.18)" }} />
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 15, color: "var(--cream)", margin: 0, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {entry.restaurant_name}
                  </h3>
                  <p style={{ color: "var(--muted)", fontSize: 12, margin: "4px 0 0", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {location}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReviewsTab({ reviews, engagement, myName }: { reviews: Review[]; engagement: EngagementMaps; myName: string }) {
  const sorted = [...reviews].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (sorted.length === 0) {
    return (
      <div style={{ padding: "60px 20px 110px", textAlign: "center" }}>
        <p style={{ color: "var(--muted)", fontSize: 14, fontFamily: "'DM Sans', sans-serif" }}>No reviews yet</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 16px 110px", display: "flex", flexDirection: "column", gap: 0 }}>
      {sorted.map((review) => (
        <CircleFeedCard
          key={review.id}
          review={review}
          initialLikeCount={engagement.likeCountMap[review.id] ?? 0}
          initialCommentCount={engagement.commentMap[review.id]?.count ?? 0}
          initialLiked={engagement.likedByMeMap[review.id] ?? false}
          initialBookmarked={engagement.bookmarkedPostMap[review.id] ?? false}
          initialMyName={myName}
        />
      ))}
    </div>
  );
}

export default function MeClient({
  allReviews,
  initialMyName = "",
  initialDisplayName = "",
  initialBio = "",
  joinedAt = "",
  initialCircle = [],
  likeCountMap = {},
  commentMap = {},
  likedByMeMap = {},
  bookmarkedPostMap = {},
}: {
  allReviews: Review[];
  initialMyName?: string;
  initialDisplayName?: string;
  initialBio?: string;
  joinedAt?: string;
  initialCircle?: string[];
  likeCountMap?: Record<string, number>;
  commentMap?: Record<string, { count: number; top: Comment }>;
  likedByMeMap?: Record<string, boolean>;
  bookmarkedPostMap?: Record<string, boolean>;
}) {
  const [mounted, setMounted] = useState(Boolean(initialMyName));
  const [myName, setMyName] = useState(initialMyName);
  const [displayName, setDisplayName] = useState(initialDisplayName || initialMyName);
  const [bio, setBio] = useState(initialBio);
  const [circle, setCircle] = useState<string[]>(initialCircle);
  const [activeTab, setActiveTab] = useState<MeTab>("reviews");

  const myReviews = useMemo(() => allReviews.filter(r => r.reviewer_name === myName), [allReviews, myName]);
  const uniquePlaces = useMemo(() => new Set(myReviews.map(r => r.restaurant_name)).size, [myReviews]);
  const uniqueDishes = useMemo(() => uniqueDishesFor(myReviews), [myReviews]);
  const totalVisits = useMemo(() => myReviews.length, [myReviews]);

  useEffect(() => {
    const name = resolveActorName(initialMyName);
    const dName = resolveDisplayName(initialDisplayName, name);
    setMyName(name);
    setDisplayName(dName || name);
    setBio(initialBio.trim());
    setMounted(true);
    if (name) {
      cachedCircleStatus(name)
        .then((data) => setCircle(data.displayMembers ?? data.members ?? []))
        .catch(() => {});
    }
  }, [initialMyName, initialDisplayName, initialBio]);

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

  const tabContent =
    activeTab === "timeline" ? <TimelineTab reviews={myReviews} /> :
    <ReviewsTab reviews={myReviews} engagement={{ likeCountMap, commentMap, likedByMeMap, bookmarkedPostMap }} myName={myName} />;

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>
      <div style={{ padding: "20px 20px 16px", position: "relative" }}>
        <div style={{ position: "absolute", top: "20px", right: "20px", display: "flex", gap: "8px" }}>
          <Link href="/me/settings" style={{ textDecoration: "none" }}>
            <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Settings size={15} strokeWidth={2} color="var(--muted)" />
            </div>
          </Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ width: "72px", height: "72px", borderRadius: "22px", background: myName ? avatarGradient(myName) : "var(--card)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", fontWeight: 700, color: "white", fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
            {myName ? avatarInitials(displayName || myName) : "?"}
          </div>
          <div>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "20px", fontWeight: 700, color: "var(--cream)" }}>
              {displayName || myName || "Set your name"}
            </p>
            <p style={{ fontSize: "13px", color: "var(--cream)", marginTop: "3px", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, opacity: 0.6 }}>@{myName || "you"}</p>
            <p style={{ fontSize: "13px", color: "var(--cream)", marginTop: "3px", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, opacity: 0.6 }}>{totalVisits} visit{totalVisits !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <p style={{ fontSize: "13px", color: "var(--cream)", marginTop: "12px", lineHeight: 1.5, fontFamily: "'DM Sans', sans-serif", fontWeight: 500, opacity: 0.85 }}>
          {bio || "Food explorer, sharing my culinary adventures one review at a time. Always on the hunt for the next delicious discovery!"}
        </p>
        {joinedAt && (
          <p style={{ fontSize: "12px", color: "var(--muted)", marginTop: "12px", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>
            Joined {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(joinedAt))}
          </p>
        )}
      </div>

      <div style={{ padding: "0 20px 16px" }}>
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
          {/* Circle */}
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

      <MeTabs activeTab={activeTab} onChange={setActiveTab} />
      {tabContent}
    </div>
  );
}
