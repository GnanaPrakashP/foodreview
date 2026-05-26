"use client";

import type { PostTasteTrustSummary } from "@/lib/taste-trust";

type Props = {
  summary?: PostTasteTrustSummary | null;
  compact?: boolean;
};

export default function PostFeedbackSummary({ summary, compact = false }: Props) {
  if (!summary || summary.tried_count === 0) return null;

  const agreeCount = summary.agree_count ?? summary.agreed_count;
  const matchPercentage = summary.agreement_percentage ?? Math.round((agreeCount / summary.tried_count) * 100);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        background: "rgba(61,214,140,0.07)",
        border: "1px solid rgba(61,214,140,0.16)",
        borderRadius: compact ? "12px" : "14px",
        padding: compact ? "10px 11px" : "12px 13px",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: compact ? "12px" : "13px", fontWeight: 900, color: "var(--cream)", margin: 0, lineHeight: 1.2 }}>
          {summary.tried_count} people tried this
        </p>
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", fontWeight: 700, color: "var(--muted)", margin: "5px 0 0", lineHeight: 1.25 }}>
          <span style={{ color: "var(--green)" }}>{agreeCount} agreed</span>
          {" · "}
          {summary.okay_count} okay
          {" · "}
          {summary.disagreed_count} disagreed
        </p>
      </div>
      <div
        aria-label={`${matchPercentage}% match`}
        style={{
          width: compact ? "50px" : "54px",
          minWidth: compact ? "50px" : "54px",
          height: compact ? "50px" : "54px",
          borderRadius: compact ? "14px" : "16px",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: compact ? "13px" : "14px", fontWeight: 900, color: "var(--green)", lineHeight: 1 }}>
          {matchPercentage}%
        </span>
        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "10px", fontWeight: 800, color: "var(--muted)", marginTop: "4px", lineHeight: 1 }}>
          match
        </span>
      </div>
    </div>
  );
}
