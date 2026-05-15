"use client";

import { useEffect, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import type { Review } from "@/lib/types";

interface Props {
  review: Review;
  reviewerDisplayName: string;
}

export default function PostShareButton({ review }: Props) {
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [downloadStatus, setDownloadStatus] = useState<"idle" | "downloading" | "downloaded" | "error">("idle");
  const menuRef = useRef<HTMLDivElement>(null);

  const visibility = review.visibility;
  const isPublic = visibility === "public";
  const isMe = visibility === "me";

  function getCopyText() {
    return `Discover food reviews from people you trust and find the best bites near you. Join CircleBites: ${window.location.origin}`;
  }

  function getImageUrl(options?: { download?: boolean }) {
    const url = new URL(`/api/posts/${encodeURIComponent(review.id)}/share-image`, window.location.origin);
    const card = menuRef.current?.closest("article");
    const width = card instanceof HTMLElement ? Math.round(card.getBoundingClientRect().width) : 0;
    const exportWidth = options?.download ? Math.max(width, 560) : width;
    if (exportWidth > 0) url.searchParams.set("w", String(exportWidth));
    if (options?.download) {
      url.searchParams.set("dpr", "3");
      url.searchParams.set("download", "1");
    }
    return url.toString();
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(getCopyText());
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 2000);
    } catch {
      setCopyStatus("error");
      setTimeout(() => setCopyStatus("idle"), 2000);
    }
  }

  async function handleDownloadImage() {
    if (!isPublic || downloadStatus === "downloading") return;
    setDownloadStatus("downloading");
    try {
      const res = await fetch(getImageUrl({ download: true }));
      if (!res.ok) {
        setDownloadStatus("error");
        setTimeout(() => setDownloadStatus("idle"), 2000);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `circlebites-${review.restaurant_name.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").toLowerCase()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloadStatus("downloaded");
    } catch {
      setDownloadStatus("error");
      setTimeout(() => setDownloadStatus("idle"), 2000);
    }
  }

  function close() {
    setOpen(false);
    setCopyStatus("idle");
    setDownloadStatus("idle");
  }

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && menuRef.current && !menuRef.current.contains(target)) {
        close();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div ref={menuRef} style={{ position: "relative", flexShrink: 0, lineHeight: 0 }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((current) => !current);
          setCopyStatus("idle");
          setDownloadStatus("idle");
        }}
        aria-label="Share post"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          color: "var(--muted)",
          lineHeight: 0,
          flexShrink: 0,
        }}
      >
        <Share2 size={18} strokeWidth={2} />
      </button>

      {open && (
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            position: "absolute",
            right: 0,
            bottom: "calc(100% + 8px)",
            minWidth: "176px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            padding: "6px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            zIndex: 15,
          }}
        >
          {!isMe ? (
            <button
              onClick={handleCopyLink}
              style={{
                width: "100%",
                background: copyStatus === "copied" ? "rgba(61,214,140,0.12)" : "var(--card)",
                border: copyStatus === "copied"
                  ? "1px solid rgba(61,214,140,0.35)"
                  : copyStatus === "error"
                    ? "1px solid rgba(239,68,68,0.35)"
                    : "1px solid var(--border)",
                borderRadius: "9px",
                padding: "9px 10px",
                color: copyStatus === "copied"
                  ? "#3DD68C"
                  : copyStatus === "error"
                    ? "#EF4444"
                    : "var(--cream)",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif",
                textAlign: "left",
                lineHeight: 1.2,
              }}
            >
              {copyStatus === "copied"
                ? "Link copied!"
                : copyStatus === "error"
                  ? "Copy failed"
                  : "Copy link"}
            </button>
          ) : (
            <p style={{ color: "var(--muted)", fontSize: "12px", margin: 0, padding: "8px 6px", fontFamily: "'DM Sans', sans-serif", textAlign: "center", lineHeight: 1.3 }}>
              No actions
            </p>
          )}

          {isPublic && (
            <button
              onClick={handleDownloadImage}
              disabled={downloadStatus === "downloading"}
              style={{
                width: "100%",
                background: downloadStatus === "downloaded" ? "rgba(61,214,140,0.12)" : "var(--card)",
                border: downloadStatus === "downloaded"
                  ? "1px solid rgba(61,214,140,0.35)"
                  : downloadStatus === "error"
                    ? "1px solid rgba(239,68,68,0.35)"
                    : "1px solid var(--border)",
                borderRadius: "9px",
                padding: "9px 10px",
                color: downloadStatus === "downloaded"
                  ? "#3DD68C"
                  : downloadStatus === "error"
                    ? "#EF4444"
                    : "var(--cream)",
                fontSize: "13px",
                fontWeight: 700,
                cursor: downloadStatus === "downloading" ? "default" : "pointer",
                fontFamily: "'DM Sans', sans-serif",
                textAlign: "left",
                lineHeight: 1.2,
                marginTop: !isMe ? "6px" : 0,
                opacity: downloadStatus === "downloading" ? 0.75 : 1,
              }}
            >
              {downloadStatus === "downloading"
                ? "Downloading..."
                : downloadStatus === "downloaded"
                  ? "Downloaded"
                  : downloadStatus === "error"
                    ? "Download failed"
                    : "Download card"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
