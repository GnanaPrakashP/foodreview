"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, X } from "lucide-react";
import type { Json, Notification } from "@/lib/types";
import { avatarGradient, avatarInitials } from "@/lib/profile";
import { invalidateCachedJson, primeCachedJson, readCachedJson, refreshCachedJson } from "@/lib/browser-api-cache";
import { getStoredActorName } from "@/lib/browser-actor";
import { invalidateCircleStatusCache } from "@/lib/browser-circle-status";

const NOTIFICATIONS_API_URL = "/api/notifications";
const NOTIFICATIONS_TTL_MS = 60 * 1000;

type NotificationsPayload = {
  notifications?: Notification[];
  profileMap?: Record<string, string>;
};

function effectiveDate(notification: Notification): string {
  return notification.updated_at || notification.created_at;
}

function timeAgo(d: string): string {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function groupLabel(dateStr: string): "Today" | "Yesterday" | "This Week" | "Older" {
  const now = new Date();
  const date = new Date(dateStr);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86_400_000;
  const t = date.getTime();
  if (t >= startToday) return "Today";
  if (t >= startYesterday) return "Yesterday";
  if (Date.now() - t < 7 * 86_400_000) return "This Week";
  return "Older";
}

function metadataOf(notification: Notification): Record<string, Json | undefined> {
  return notification.metadata && typeof notification.metadata === "object" && !Array.isArray(notification.metadata)
    ? notification.metadata as Record<string, Json | undefined>
    : {};
}

function notificationMessage(notification: Notification, profileMap: Record<string, string>): string {
  const username = notification.actor_name ?? "";
  const actor = (username && profileMap[username]) || username || "Someone";
  const storedMessage = typeof notification.message === "string" ? notification.message.trim() : "";

  if (storedMessage && username && !profileMap[username]) return storedMessage;

  if (notification.type === "POST_LIKED" || notification.type === "like") return `${actor} liked your post`;
  if (notification.type === "POST_COMMENTED" || notification.type === "comment") return `${actor} commented on your post`;
  if (notification.type === "THREAD_REPLY" || notification.type === "also_commented") return `${actor} replied in a discussion you joined`;
  if (notification.type === "CIRCLE_REQUEST_RECEIVED" || notification.type === "circle_request") return `${actor} requested to join your circle`;
  if (notification.type === "CIRCLE_REQUEST_ACCEPTED" || notification.type === "circle_accepted") return `${actor} accepted your circle request`;
  if (notification.type === "ADDED_TO_CIRCLE" || notification.type === "MUTUAL_CIRCLE_CREATED" || notification.type === "circle_added") return `${actor} joined your circle`;
  if (notification.type === "CIRCLE_POST_CREATED" || notification.type === "circle_post") return `${actor} posted about ${notification.restaurant_name ?? "a restaurant"}`;
  if (notification.type === "TABLE_MEMORY_INVITE") return storedMessage || `${actor} invited you to a table memory`;
  if (storedMessage) return storedMessage;
  return "You have a new notification";
}

function notificationHref(notification: Notification): string {
  const metadata = metadataOf(notification);
  if (notification.entity_type === "POST" || notification.post_id) {
    const id = notification.post_id ?? notification.entity_id;
    return id ? `/reviews/${encodeURIComponent(id)}` : "/notifications";
  }
  if (notification.entity_type === "USER" && notification.actor_name) {
    return `/people/${encodeURIComponent(notification.actor_name)}`;
  }
  if (notification.entity_type === "RESTAURANT") {
    const restaurantName = typeof metadata.restaurantName === "string" ? metadata.restaurantName : notification.restaurant_name;
    return restaurantName ? `/trending/${encodeURIComponent(restaurantName)}` : "/explore";
  }
  if (notification.entity_type === "TABLE_MEMORY") {
    return "/notifications";
  }
  if (notification.actor_name) return `/people/${encodeURIComponent(notification.actor_name)}`;
  return "/notifications";
}

function isUnread(notification: Notification): boolean {
  return !(notification.is_read || notification.read);
}

export default function NotificationsClient() {
  const router = useRouter();
  const [myName, setMyName] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);

  function cacheNotifications(nextNotifications: Notification[], nextProfileMap = profileMap) {
    primeCachedJson<NotificationsPayload>(NOTIFICATIONS_API_URL, {
      notifications: nextNotifications,
      profileMap: nextProfileMap,
    }, NOTIFICATIONS_TTL_MS);
  }

  useEffect(() => {
    mountedRef.current = true;
    setMyName(getStoredActorName());
    loadNotifications();

    const onFocus = () => loadNotifications();
    window.addEventListener("focus", onFocus);
    return () => {
      mountedRef.current = false;
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  async function loadNotifications() {
    const cached = readCachedJson<NotificationsPayload>(NOTIFICATIONS_API_URL, { allowStale: true });
    if (cached) {
      if (!mountedRef.current) return;
      setNotifications(cached.notifications ?? []);
      setProfileMap(cached.profileMap ?? {});
      setLoading(false);
    } else {
      if (!mountedRef.current) return;
      setLoading(true);
    }
    try {
      const data = await refreshCachedJson<NotificationsPayload>(NOTIFICATIONS_API_URL, NOTIFICATIONS_TTL_MS);
      if (data && mountedRef.current) {
        setNotifications(data.notifications ?? []);
        setProfileMap(data.profileMap ?? {});
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function markRead(id: string) {
    setNotifications((prev) => {
      const next = prev.map((n) => n.id === id ? { ...n, is_read: true, read: true } : n);
      cacheNotifications(next);
      return next;
    });
    await fetch(`/api/notifications/${id}/read`, { method: "PATCH" }).catch(() => {});
    invalidateCachedJson("/api/notifications/unread-count");
  }

  async function markAllRead() {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, is_read: true, read: true }));
      cacheNotifications(next);
      return next;
    });
    await fetch("/api/notifications/read-all", { method: "PATCH" }).catch(() => {});
    invalidateCachedJson("/api/notifications/unread-count");
  }

  function showToast(msg: string) {
    if (!mountedRef.current) return;
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setToast(null);
    }, 3000);
  }

  async function respondToCircle(notification: Notification, action: "accept" | "reject") {
    if (!myName || !notification.actor_name) return;
    setBusyId(notification.id);
    const requestId = metadataOf(notification).requestId;
    const res = typeof requestId === "string" && requestId
      ? await fetch(`/api/circle-requests/${encodeURIComponent(requestId)}/${action}`, { method: "POST" })
      : await fetch("/api/circle/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ myName, senderName: notification.actor_name, action }),
        });

    if (res.ok) {
      invalidateCircleStatusCache(myName);
      invalidateCircleStatusCache(notification.actor_name);
      invalidateCachedJson("/api/feed/circle");
      invalidateCachedJson("/api/people");
      invalidateCachedJson("/api/notifications/unread-count");
      if (mountedRef.current) setNotifications((prev) => {
        const next = prev.map((n) => n.id === notification.id ? {
          ...n,
          is_read: true,
          read: true,
          metadata: { ...metadataOf(n), status: action === "accept" ? "accepted" : "rejected" },
        } : n);
        cacheNotifications(next);
        return next;
      });
    } else if (res.status === 404 || res.status === 409) {
      // Request was cancelled or already acted on — reload to get fresh state
      showToast("This request is no longer available");
      await loadNotifications();
    }
    if (mountedRef.current) setBusyId(null);
  }

  async function openNotification(notification: Notification) {
    await markRead(notification.id);
    router.push(notificationHref(notification));
  }

  const groups = useMemo(() => {
    const result: Record<string, Notification[]> = { Today: [], Yesterday: [], "This Week": [], Older: [] };
    for (const notification of notifications) result[groupLabel(effectiveDate(notification))].push(notification);
    return result;
  }, [notifications]);

  const unreadCount = notifications.filter(isUnread).length;

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", paddingBottom: "100px" }}>
      {toast && (
        <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 100, background: "#1a1a1a", border: "1px solid var(--border)", color: "var(--cream)", borderRadius: "12px", padding: "10px 18px", fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 600 }}>
          {toast}
        </div>
      )}
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--bg)", borderBottom: "1px solid var(--border)", padding: "14px 20px 12px", display: "flex", alignItems: "center", gap: "12px" }}>
        <Link href="/" style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none", flexShrink: 0 }}>
          <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "20px", fontWeight: 800, color: "var(--cream)", lineHeight: 1 }}>Notifications</h1>
          <p style={{ marginTop: "3px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: "12px" }}>
            {unreadCount === 0 ? "All caught up" : `${unreadCount} unread`}
          </p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead} style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--cream)", borderRadius: "10px", padding: "8px 10px", fontFamily: "'DM Sans', sans-serif", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>
            Mark all
          </button>
        )}
      </div>

      <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: "18px" }}>
        {loading && (
          <div style={{ padding: "28px 0", textAlign: "center", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: "13px" }}>
            Loading notifications...
          </div>
        )}

        {!loading && notifications.length === 0 && (
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "28px 18px", textAlign: "center" }}>
            <p style={{ color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 800 }}>No notifications yet</p>
            <p style={{ color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: "13px", marginTop: "5px" }}>Circle requests, likes, comments, and circle posts will show here.</p>
          </div>
        )}

        {(["Today", "Yesterday", "This Week", "Older"] as const).map((label) => {
          const items = groups[label];
          if (items.length === 0) return null;
          return (
            <section key={label}>
              <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", marginBottom: "8px" }}>{label}</h2>
              <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", overflow: "hidden" }}>
                {items.map((notification) => {
                  const metadata = metadataOf(notification);
                  const thumbnailUrl = typeof metadata.thumbnailUrl === "string" ? metadata.thumbnailUrl : null;
                  const requestStatus = typeof metadata.status === "string" ? metadata.status : "pending";
                  const actionableCircleRequest = (notification.type === "CIRCLE_REQUEST_RECEIVED" || notification.type === "circle_request") && requestStatus === "pending";
                  const unread = isUnread(notification);

                  return (
                    <div key={notification.id} style={{ borderBottom: "1px solid var(--border)", padding: "12px", opacity: unread ? 1 : 0.68 }}>
                      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                        <button onClick={() => openNotification(notification)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", flex: 1, display: "flex", gap: "10px", textAlign: "left", minWidth: 0 }}>
                          <div style={{ width: 38, height: 38, borderRadius: "12px", background: avatarGradient((notification.actor_name && profileMap[notification.actor_name]) || notification.actor_name || "Witoh"), display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: "12px", fontWeight: 800, flexShrink: 0 }}>
                            {avatarInitials((notification.actor_name && profileMap[notification.actor_name]) || notification.actor_name || "CB")}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: "13px", lineHeight: 1.35, fontWeight: unread ? 800 : 600 }}>
                              {notificationMessage(notification, profileMap)}
                            </p>
                            {notification.content && (
                              <p style={{ color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: "12px", lineHeight: 1.35, marginTop: "4px", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                                {notification.content}
                              </p>
                            )}
                            <p suppressHydrationWarning style={{ color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: "11px", marginTop: "5px" }}>{timeAgo(effectiveDate(notification))}</p>
                          </div>
                          {thumbnailUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumbnailUrl} alt="" style={{ width: 44, height: 44, borderRadius: "10px", objectFit: "cover", flexShrink: 0 }} />
                          )}
                        </button>
                        {unread && (
                          <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#E84040" }} />
                          </div>
                        )}
                      </div>
                      {actionableCircleRequest && (
                        <div style={{ marginLeft: "48px", marginTop: "8px", display: "flex", gap: "8px" }}>
                          <button disabled={busyId === notification.id} onClick={() => respondToCircle(notification, "accept")} style={{ flex: 1, border: "none", background: "var(--orange)", color: "white", borderRadius: "10px", padding: "9px 10px", fontFamily: "'DM Sans', sans-serif", fontSize: "12px", fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px" }}>
                            <Check size={14} strokeWidth={2.4} /> Accept
                          </button>
                          <button disabled={busyId === notification.id} onClick={() => respondToCircle(notification, "reject")} style={{ flex: 1, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--muted)", borderRadius: "10px", padding: "9px 10px", fontFamily: "'DM Sans', sans-serif", fontSize: "12px", fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px" }}>
                            <X size={14} strokeWidth={2.4} /> Reject
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
