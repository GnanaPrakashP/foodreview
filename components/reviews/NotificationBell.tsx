"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Notification } from "@/lib/types";

function timeAgo(d: string): string {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationBell() {
  const [myName, setMyName] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const name = localStorage.getItem("fc_my_name") ?? "";
    setMyName(name);
    setMounted(true);
    if (!name) return;
    fetchNotifs(name);
  }, []);

  async function fetchNotifs(name: string) {
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("notifications")
      .select("*")
      .eq("recipient_name", name)
      .order("created_at", { ascending: false })
      .limit(20) as { data: Notification[] | null };

    const notifs = data ?? [];

    // For circle_request notifications, only keep them if the request is still pending
    const circleReqNotifs = notifs.filter(n => n.type === "circle_request");
    if (circleReqNotifs.length > 0) {
      const senderNames = circleReqNotifs.map(n => n.actor_name);
      const { data: pending, error: pendingErr } = await supabase
        .from("circle_requests")
        .select("sender_name")
        .in("sender_name", senderNames)
        .eq("receiver_name", name)
        .eq("status", "pending");
      if (pendingErr) {
        // Can't verify — show all notifications as-is rather than hiding everything
        setNotifications(notifs);
        return;
      }
      const stillPending = new Set((pending ?? []).map((r: { sender_name: string }) => r.sender_name));
      setNotifications(notifs.filter(n => n.type !== "circle_request" || stillPending.has(n.actor_name)));
    } else {
      setNotifications(notifs);
    }
  }

  async function openSheet() {
    setOpen(true);
    if (!myName) return;
    const unread = notifications.filter(n => !n.read);
    if (unread.length === 0) return;
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("notifications").update({ read: true }).eq("recipient_name", myName).eq("read", false);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }

  if (!mounted || !myName) return null;

  const unread = notifications.filter(n => !n.read).length;

  function notifText(n: Notification): string {
    if (n.type === "like") return `liked your post${n.restaurant_name ? ` at ${n.restaurant_name}` : ""}`;
    if (n.type === "comment") return `commented on your ${n.restaurant_name ?? "post"}`;
    if (n.type === "also_commented") return `also commented — ${n.content ?? ""}`;
    if (n.type === "circle_request") return "wants to join your circle";
    if (n.type === "circle_accepted") return "accepted your circle request";
    if (n.type === "circle_added") return "joined your circle";
    if (n.type === "circle_post") return `posted a new review${n.restaurant_name ? ` at ${n.restaurant_name}` : ""}`;
    return "";
  }

  return (
    <>
      <button
        onClick={openSheet}
        style={{ position: "relative", background: "none", border: "none", cursor: "pointer", padding: "4px", lineHeight: 1 }}
        aria-label="Notifications"
      >
        <span style={{ fontSize: "20px" }}>🔔</span>
        {unread > 0 && (
          <span style={{ position: "absolute", top: 0, right: 0, background: "#E84040", color: "white", borderRadius: "50%", minWidth: "16px", height: "16px", fontSize: "9px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 2px" }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 60 }} />
          <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: "512px", maxHeight: "70vh", background: "var(--surface)", borderRadius: "20px 20px 0 0", zIndex: 61, display: "flex", flexDirection: "column", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
              <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: "var(--border)" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 20px 14px" }}>
              <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: "16px", color: "var(--cream)" }}>Notifications</p>
              <button onClick={() => setOpen(false)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "6px 14px", fontSize: "13px", color: "var(--muted)", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Done</button>
            </div>
            <div style={{ overflowY: "auto", flex: 1, padding: "0 20px 20px" }}>
              {notifications.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 0" }}>
                  <p style={{ fontSize: "13px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>No notifications yet</p>
                </div>
              ) : notifications.map(n => (
                <div key={n.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: "10px", opacity: n.read ? 0.6 : 1 }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--cream)", lineHeight: 1.4 }}>
                      <strong>{n.actor_name}</strong> {notifText(n)}
                    </p>
                    <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", color: "var(--muted)", marginTop: "3px" }}>
                      {timeAgo(n.created_at)}
                    </p>
                  </div>
                  {!n.read && <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#E84040", flexShrink: 0, marginTop: "4px" }} />}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
