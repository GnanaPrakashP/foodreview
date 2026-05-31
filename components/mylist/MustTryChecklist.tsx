"use client";

import Link from "next/link";
import { Bookmark, CheckCircle2, ExternalLink, MapPin, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cachedJson, primeCachedJson, readCachedJson } from "@/lib/browser-api-cache";

type UserLocation = { lat: number; lng: number; label: string };
type MustTryStatus = "not_tried" | "tried";

export type MustTryItem = {
  id: string;
  dishName: string;
  placeName: string;
  placeId: string | null;
  postId: string;
  imageUrl: string | null;
  distanceKm: number | null;
  reason: string;
  score: number;
  status: MustTryStatus;
  saved: boolean;
  triedAt: string | null;
};

type MustTryResponse = {
  items: MustTryItem[];
  myName: string | null;
  error?: string;
};

const MUST_TRY_TTL_MS = 2 * 60 * 1000;

function mustTryUrl(location: UserLocation | null) {
  const params = new URLSearchParams();
  if (location) {
    params.set("lat", String(location.lat));
    params.set("lng", String(location.lng));
  }
  const query = params.toString();
  return `/api/hungry/must-try${query ? `?${query}` : ""}`;
}

function distanceLabel(distanceKm: number | null) {
  if (distanceKm == null) return null;
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m away`;
  return `${distanceKm.toFixed(distanceKm >= 10 ? 0 : 1)} km away`;
}

function updateCachedItems(url: string, items: MustTryItem[]) {
  const cached = readCachedJson<MustTryResponse>(url, { allowStale: true });
  primeCachedJson<MustTryResponse>(url, { ...(cached ?? { myName: null }), items }, MUST_TRY_TTL_MS);
}

function SkeletonCards() {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {[0, 1, 2].map((item) => (
        <div key={item} className="animate-pulse" style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
          <div style={{ width: 84, aspectRatio: "1", borderRadius: 10, background: "var(--surface)" }} />
          <div style={{ minWidth: 0, paddingTop: 3 }}>
            <div style={{ height: 16, width: "70%", borderRadius: 6, background: "var(--surface)", marginBottom: 9 }} />
            <div style={{ height: 12, width: "48%", borderRadius: 6, background: "var(--surface)", marginBottom: 12 }} />
            <div style={{ height: 12, width: "82%", borderRadius: 6, background: "var(--surface)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: 260, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 8px" }}>
      <div style={{ textAlign: "center", maxWidth: 280 }}>
        <p style={{ margin: "0 0 6px", fontFamily: "'DM Sans', sans-serif", fontSize: 17, color: "var(--cream)", fontWeight: 850 }}>{title}</p>
        <p style={{ margin: "0 auto 14px", fontFamily: "'DM Sans', sans-serif", fontSize: 13, lineHeight: 1.45, color: "var(--muted)" }}>{body}</p>
        {action}
      </div>
    </div>
  );
}

function MustTryCard({
  item,
  pending,
  onToggleTried,
  onToggleSaved,
}: {
  item: MustTryItem;
  pending: boolean;
  onToggleTried: (item: MustTryItem) => void;
  onToggleSaved: (item: MustTryItem) => void;
}) {
  const tried = item.status === "tried";
  const distance = distanceLabel(item.distanceKm);

  return (
    <article style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 12, background: tried ? "rgba(34,197,94,0.08)" : "var(--card)", opacity: pending ? 0.7 : 1 }}>
      <div style={{ position: "relative", width: 84, aspectRatio: "1", borderRadius: 10, overflow: "hidden", background: "var(--surface)", border: "1px solid var(--border)" }}>
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: 24, fontWeight: 900 }}>
            {item.dishName.charAt(0).toUpperCase()}
          </div>
        )}
        {tried && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.36)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <CheckCircle2 size={28} strokeWidth={2.5} color="#86efac" />
          </div>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <button
            type="button"
            onClick={() => onToggleTried(item)}
            disabled={pending}
            aria-label={tried ? `Mark ${item.dishName} as not tried` : `Mark ${item.dishName} as tried`}
            title={tried ? "Mark not tried" : "Mark tried"}
            style={{ marginTop: 1, width: 22, height: 22, borderRadius: 6, border: tried ? "1px solid rgba(134,239,172,0.75)" : "1px solid var(--border)", background: tried ? "rgba(34,197,94,0.18)" : "var(--surface)", color: tried ? "#86efac" : "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", cursor: pending ? "default" : "pointer", flexShrink: 0 }}
          >
            {tried && <CheckCircle2 size={15} strokeWidth={2.5} />}
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0, color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: 15, lineHeight: 1.2, fontWeight: 850, overflowWrap: "anywhere" }}>{item.dishName}</h3>
            <p style={{ margin: "4px 0 0", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: 12.5, fontWeight: 700, overflowWrap: "anywhere" }}>{item.placeName}</p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px 10px", marginTop: 8 }}>
          {distance && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: 11.5 }}>
              <MapPin size={12} strokeWidth={2.2} />
              {distance}
            </span>
          )}
          <span style={{ color: "#f6c56d", fontFamily: "'DM Sans', sans-serif", fontSize: 11.5, fontWeight: 700 }}>{item.reason}</span>
        </div>

        {tried && (
          <p style={{ margin: "8px 0 0", color: "#86efac", fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 750 }}>
            Tried. Want to post a quick review?
          </p>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <button
            type="button"
            onClick={() => onToggleSaved(item)}
            disabled={pending}
            title={item.saved ? "Saved" : "Save"}
            aria-label={item.saved ? `Unsave ${item.dishName}` : `Save ${item.dishName}`}
            style={{ width: 34, height: 32, borderRadius: 8, border: "1px solid var(--border)", background: item.saved ? "rgba(249,115,22,0.14)" : "var(--surface)", color: item.saved ? "var(--orange)" : "var(--cream)", display: "flex", alignItems: "center", justifyContent: "center", cursor: pending ? "default" : "pointer" }}
          >
            <Bookmark size={15} strokeWidth={2.3} fill={item.saved ? "currentColor" : "none"} />
          </button>
          <Link
            href={`/reviews/${encodeURIComponent(item.postId)}`}
            title="Open details"
            aria-label={`Open details for ${item.dishName}`}
            style={{ width: 34, height: 32, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--cream)", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}
          >
            <ExternalLink size={15} strokeWidth={2.3} />
          </Link>
          {tried ? (
            <button
              type="button"
              onClick={() => onToggleTried(item)}
              disabled={pending}
              title="Undo tried"
              aria-label={`Undo tried for ${item.dishName}`}
              style={{ width: 34, height: 32, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--cream)", display: "flex", alignItems: "center", justifyContent: "center", cursor: pending ? "default" : "pointer" }}
            >
              <RotateCcw size={14} strokeWidth={2.3} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onToggleTried(item)}
              disabled={pending}
              style={{ minWidth: 96, height: 32, padding: "0 12px", borderRadius: 8, border: "1px solid rgba(34,197,94,0.38)", background: "rgba(34,197,94,0.12)", color: "#bbf7d0", fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 850, cursor: pending ? "default" : "pointer" }}
            >
              Mark Tried
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export default function MustTryChecklist({
  location,
  active,
  onChooseLocation,
}: {
  location: UserLocation | null;
  active: boolean;
  onChooseLocation: () => void;
}) {
  const url = useMemo(() => mustTryUrl(location), [location]);
  const [items, setItems] = useState<MustTryItem[]>(() => readCachedJson<MustTryResponse>(url)?.items ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [loadedUrl, setLoadedUrl] = useState("");

  const loadItems = useCallback(async (forceRefresh = false) => {
    if (!location) return;
    setLoading(true);
    setError("");
    try {
      const data = await cachedJson<MustTryResponse>(url, MUST_TRY_TTL_MS, { forceRefresh });
      if (data.error) throw new Error(data.error);
      setItems(data.items ?? []);
      setLoadedUrl(url);
    } catch {
      setError("Unable to load must-try items.");
    } finally {
      setLoading(false);
    }
  }, [location, url]);

  useEffect(() => {
    const cached = readCachedJson<MustTryResponse>(url);
    if (cached) {
      setItems(cached.items ?? []);
      setLoadedUrl(url);
    } else if (location) {
      setItems([]);
      setLoadedUrl("");
    }
  }, [location, url]);

  useEffect(() => {
    if (active && location && loadedUrl !== url && !loading && !error) {
      loadItems();
    }
  }, [active, error, loadItems, loadedUrl, loading, location, url]);

  const setPending = useCallback((id: string, pending: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const replaceItem = useCallback((id: string, updater: (item: MustTryItem) => MustTryItem) => {
    setItems((current) => {
      const next = current.map((item) => item.id === id ? updater(item) : item);
      updateCachedItems(url, next);
      return next;
    });
  }, [url]);

  const toggleTried = useCallback(async (item: MustTryItem) => {
    const nextTried = item.status !== "tried";
    setPending(item.id, true);
    replaceItem(item.id, (current) => ({ ...current, status: nextTried ? "tried" : "not_tried", triedAt: nextTried ? new Date().toISOString() : null }));
    try {
      const response = nextTried
        ? await fetch("/api/hungry/must-try", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ postId: item.postId, dishName: item.dishName, placeId: item.placeId }),
          })
        : await fetch(`/api/hungry/must-try?postId=${encodeURIComponent(item.postId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to update tried state");
      const data = await response.json();
      replaceItem(item.id, (current) => ({ ...current, status: data.status ?? current.status, triedAt: data.triedAt ?? (nextTried ? current.triedAt : null) }));
    } catch {
      replaceItem(item.id, (current) => ({ ...current, status: item.status, triedAt: item.triedAt }));
    } finally {
      setPending(item.id, false);
    }
  }, [replaceItem, setPending]);

  const toggleSaved = useCallback(async (item: MustTryItem) => {
    setPending(item.id, true);
    replaceItem(item.id, (current) => ({ ...current, saved: !current.saved }));
    try {
      const response = await fetch("/api/wishlist", {
        method: item.saved ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantName: item.placeName, postId: item.postId }),
      });
      if (!response.ok) throw new Error("Unable to update saved state");
    } catch {
      replaceItem(item.id, (current) => ({ ...current, saved: item.saved }));
    } finally {
      setPending(item.id, false);
    }
  }, [replaceItem, setPending]);

  const notTried = items.filter((item) => item.status !== "tried");
  const tried = items.filter((item) => item.status === "tried");

  if (!location) {
    return (
      <EmptyState
        title="Choose an area first"
        body="Set your location so CircleBites can build a nearby food bucket list."
        action={
          <button type="button" onClick={onChooseLocation} style={{ height: 36, padding: "0 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--orange)", color: "white", fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 850, cursor: "pointer" }}>
            Set location
          </button>
        }
      />
    );
  }

  return (
    <div className="hide-scrollbar" style={{ height: "100%", overflowY: "auto", overflowX: "hidden", padding: "12px 16px 18px", boxSizing: "border-box" }}>
      {loading && items.length === 0 ? (
        <SkeletonCards />
      ) : error ? (
        <EmptyState
          title="Could not load picks"
          body={error}
          action={
            <button type="button" onClick={() => loadItems(true)} style={{ height: 36, padding: "0 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 850, cursor: "pointer" }}>
              Retry
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState title="No must-try items yet" body="Explore more posts near you, then check back for a sharper list." />
      ) : notTried.length === 0 ? (
        <EmptyState title="You've tried everything nearby" body="More coming soon as your circle finds new dishes." />
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <section>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
              <h2 style={{ margin: 0, color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 900 }}>Must Try Near You</h2>
              {loading && <span style={{ color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: 11 }}>Refreshing...</span>}
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {notTried.map((item) => (
                <MustTryCard key={item.id} item={item} pending={pendingIds.has(item.id)} onToggleTried={toggleTried} onToggleSaved={toggleSaved} />
              ))}
            </div>
          </section>

          {tried.length > 0 && (
            <section>
              <h2 style={{ margin: "2px 0 10px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 850 }}>Already Tried</h2>
              <div style={{ display: "grid", gap: 10 }}>
                {tried.map((item) => (
                  <MustTryCard key={item.id} item={item} pending={pendingIds.has(item.id)} onToggleTried={toggleTried} onToggleSaved={toggleSaved} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
