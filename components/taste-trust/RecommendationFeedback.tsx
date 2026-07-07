"use client";

import { useEffect, useState } from "react";
import { Flame, ThumbsDown, type LucideIcon } from "lucide-react";
import { TASTE_TRUST_FEEDBACK_OPTIONS, type PostTasteTrustSummary } from "@/lib/taste-trust";
import { invalidateCachedJson } from "@/lib/browser-api-cache";

type Props = {
  postId: string;
  reviewerName: string;
  postVisibility?: string | null;
  myName?: string;
  initialSummary?: PostTasteTrustSummary | null;
  compact?: boolean;
  onSummaryChange?: (summary: PostTasteTrustSummary) => void;
};

type FeedbackPayload = {
  summary?: PostTasteTrustSummary;
  postSummary?: PostTasteTrustSummary;
  myFeedbackLabel?: string | null;
  message?: string;
  error?: string;
};

const EMPTY_SUMMARY: PostTasteTrustSummary = {
  tried_count: 0,
  agree_count: 0,
  agreed_count: 0,
  okay_count: 0,
  disagreed_count: 0,
  agreement_percentage: null,
  feedback_counts: {
    "Must Try": 0,
    "Not Worth It": 0,
  },
};

const FEEDBACK_ICONS: Record<string, LucideIcon> = {
  "Must Try": Flame,
  "Not Worth It": ThumbsDown,
};

function invalidateTasteTrustCaches() {
  invalidateCachedJson("/api/feed/circle");
  invalidateCachedJson("/api/feed/public");
  invalidateCachedJson("/api/me");
}

const FEEDBACK_LABELS: Record<string, string> = {
  "Must Try": "Must Try",
  "Not Worth It": "Not Worth It",
};

function feedbackCountFor(summary: PostTasteTrustSummary, label: string) {
  const count = summary.feedback_counts?.[label as keyof typeof summary.feedback_counts];
  if (typeof count === "number" && Number.isFinite(count)) return count;
  if (label === "Must Try") return summary.agree_count ?? summary.agreed_count ?? 0;
  if (label === "Not Worth It") return summary.disagreed_count;
  return 0;
}

export default function RecommendationFeedback({
  postId,
  reviewerName,
  postVisibility = "public",
  myName = "",
  initialSummary = null,
  compact = false,
  onSummaryChange,
}: Props) {
  const [summary, setSummary] = useState<PostTasteTrustSummary>(initialSummary ?? EMPTY_SUMMARY);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");
  const [submittingLabel, setSubmittingLabel] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const isPrivatePost = postVisibility === "me" || postVisibility === "private";
  const canSubmit = Boolean(myName) && myName !== reviewerName && !isPrivatePost;
  const shouldShowSummaryOnly = summary.tried_count > 0 && (!canSubmit || isPrivatePost);
  const agreeCount = summary.agree_count ?? summary.agreed_count;

  useEffect(() => {
    if (isPrivatePost) return;
    let cancelled = false;
    fetch(`/api/taste-trust/feedback?postId=${encodeURIComponent(postId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: FeedbackPayload | null) => {
        if (cancelled || !payload) return;
        if (payload.summary) {
          setSummary(payload.summary);
          onSummaryChange?.(payload.summary);
        }
        setSelectedLabel(payload.myFeedbackLabel ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isPrivatePost, onSummaryChange, postId]);

  if (isPrivatePost && summary.tried_count === 0) return null;
  if (!canSubmit && !shouldShowSummaryOnly) return null;

  async function submitFeedback(label: string) {
    if (!canSubmit || submittingLabel || removing) return;
    setSubmittingLabel(label);
    setStatusText("");

    const response = await fetch("/api/taste-trust/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, feedbackLabel: label }),
    });
    const payload = await response.json().catch(() => ({})) as FeedbackPayload;
    if (!response.ok) {
      setStatusText(payload.error || "Could not save Taste Trust feedback.");
      setSubmittingLabel(null);
      return;
    }

    setSelectedLabel(payload.myFeedbackLabel ?? label);
    if (payload.postSummary) {
      setSummary(payload.postSummary);
      onSummaryChange?.(payload.postSummary);
    }
    invalidateTasteTrustCaches();
    setStatusText(payload.error || "");
    setSubmittingLabel(null);
  }

  async function removeFeedback() {
    if (!canSubmit || removing) return;
    setRemoving(true);
    setStatusText("");

    const response = await fetch(`/api/taste-trust/feedback?postId=${encodeURIComponent(postId)}`, {
      method: "DELETE",
    });
    const payload = await response.json().catch(() => ({})) as FeedbackPayload;
    if (!response.ok) {
      setStatusText(payload.error || "Could not remove Taste Trust feedback.");
      setRemoving(false);
      return;
    }

    setSelectedLabel(null);
    if (payload.postSummary) {
      setSummary(payload.postSummary);
      onSummaryChange?.(payload.postSummary);
    }
    invalidateTasteTrustCaches();
    setRemoving(false);
  }

  const subtitle = selectedLabel
    ? selectedLabel
    : summary.tried_count > 0
      ? [
          `${summary.tried_count} tried`,
          agreeCount > 0 ? `${agreeCount} agreed` : "",
          summary.disagreed_count > 0 ? `${summary.disagreed_count} disagreed` : "",
        ].filter(Boolean).join(" · ")
      : "";

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      style={{
        padding: compact ? "3px 0 6px" : "4px 0 6px",
        marginTop: compact ? "3px" : "4px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "8px" }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: compact ? "12px" : "13px", fontWeight: 900, color: "var(--cream)", margin: 0, lineHeight: 1.25 }}>
            React to this bite
          </p>
          {subtitle && (
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", color: selectedLabel ? "var(--orange)" : "var(--muted)", margin: "3px 0 0", lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {subtitle}
            </p>
          )}
        </div>
        {summary.agreement_percentage !== null && summary.tried_count > 0 && (
          <span style={{ flexShrink: 0, fontFamily: "'DM Sans', sans-serif", fontSize: "10px", color: "var(--green)", fontWeight: 900 }}>
            {summary.agreement_percentage}% match
          </span>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "7px",
        }}
      >
        {TASTE_TRUST_FEEDBACK_OPTIONS.map((option) => {
          const selected = selectedLabel === option.label;
          const busy = submittingLabel === option.label;
          const count = feedbackCountFor(summary, option.label);
          const FeedbackIcon = FEEDBACK_ICONS[option.label];
          return (
            <button
              key={option.label}
              type="button"
              onClick={() => submitFeedback(option.label)}
              disabled={!canSubmit || Boolean(submittingLabel) || removing}
              aria-label={option.label}
              style={{
                minHeight: compact ? "50px" : "56px",
                background: selected ? "rgba(240,96,48,0.16)" : "rgba(255,255,255,0.045)",
                border: selected ? "1px solid rgba(240,96,48,0.42)" : "1px solid var(--border)",
                borderRadius: "15px",
                color: "var(--cream)",
                cursor: canSubmit && !submittingLabel && !removing ? "pointer" : "default",
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 900,
                padding: 0,
                lineHeight: 1,
                textAlign: "center",
                opacity: submittingLabel && !busy ? 0.55 : 1,
                transform: selected ? "translateY(-1px)" : "none",
                transition: "border-color 0.12s, background 0.12s, opacity 0.12s, transform 0.12s",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
              }}
            >
              <span style={{ color: selected ? "var(--orange)" : "var(--muted)", lineHeight: 1 }}>
                {busy ? "..." : <FeedbackIcon size={compact ? 20 : 23} strokeWidth={selected ? 2.4 : 2.05} />}
              </span>
              <span style={{ fontSize: "10px", fontWeight: 800, color: selected ? "var(--orange)" : "var(--muted)", lineHeight: 1 }}>
                {FEEDBACK_LABELS[option.label]} {count}
              </span>
            </button>
          );
        })}
      </div>

      {selectedLabel && canSubmit && (
        <button
          type="button"
          onClick={removeFeedback}
          disabled={removing || Boolean(submittingLabel)}
          style={{
            marginTop: "9px",
            background: "transparent",
            border: "none",
            color: "#FCA5A5",
            cursor: removing || submittingLabel ? "default" : "pointer",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: "11px",
            fontWeight: 800,
            padding: 0,
            lineHeight: 1.2,
            opacity: removing ? 0.7 : 1,
          }}
        >
          {removing ? "Removing..." : "Remove"}
        </button>
      )}

      {shouldShowSummaryOnly && (
        <p
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: "10px",
            color: "var(--muted)",
            margin: "8px 0 0",
            lineHeight: 1.3,
          }}
        >
          Aggregate tried history
        </p>
      )}

      {statusText && (
        <div
          role="status"
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: "11px",
            color: "#F87171",
            margin: "8px 0 0",
            lineHeight: 1.35,
          }}
        >
          <p style={{ margin: 0 }}>{statusText}</p>
        </div>
      )}
    </div>
  );
}
