"use client";

import {
  ChevronRight,
  FileText,
  Pencil,
  Shield,
  ShieldCheck,
  TrendingUp,
  User,
  Users,
  X,
} from "lucide-react";
import type { Review } from "@/lib/types";
import {
  TASTE_TRUST_CONFIDENCE_PRIOR,
  TASTE_TRUST_MAX_SCORE,
  TASTE_TRUST_MIN_CONFIRMATIONS,
  TASTE_TRUST_STARTING_SCORE,
  formatTrustScore,
  type TasteTrustSummary,
} from "@/lib/taste-trust";

type TrendPoint = {
  label: string;
  score: number;
  posts: number;
  confirmations: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function scoreFor(averageFeedback: number, confirmations: number) {
  if (confirmations <= 0) return TASTE_TRUST_STARTING_SCORE;
  const confidence = confirmations / (confirmations + TASTE_TRUST_CONFIDENCE_PRIOR);
  const qualityScore = (clamp(averageFeedback, -1, 1) + 1) / 2;
  return Math.round(
    clamp(
      TASTE_TRUST_STARTING_SCORE * (1 - confidence) +
        TASTE_TRUST_MAX_SCORE * qualityScore * confidence,
      0,
      100
    ) * 10
  ) / 10;
}

function monthKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(year, month - 1, 1));
}

function buildTrend(summary: TasteTrustSummary, reviews: Review[]): TrendPoint[] {
  const sorted = [...reviews]
    .filter((review) => monthKey(review.created_at))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (sorted.length === 0) {
    return [{
      label: "Now",
      score: Math.round(summary.trust_score * 10) / 10,
      posts: 0,
      confirmations: summary.confirmed_recommendations_count,
    }];
  }

  const months = Array.from(new Set(sorted.map((review) => monthKey(review.created_at)))).slice(-6);
  const postsByMonth = new Map<string, number>();
  for (const review of sorted) {
    const key = monthKey(review.created_at);
    if (months.includes(key)) postsByMonth.set(key, (postsByMonth.get(key) ?? 0) + 1);
  }

  const totalPosts = Math.max(1, sorted.length);
  const totalConfirmations = summary.confirmed_recommendations_count;
  const averageFeedback = totalConfirmations > 0
    ? Number(summary.total_feedback_points) / totalConfirmations
    : 0;

  let cumulativePostsBeforeWindow = sorted.filter((review) => !months.includes(monthKey(review.created_at))).length;
  const points = months.map((key, index) => {
    cumulativePostsBeforeWindow += postsByMonth.get(key) ?? 0;
    const isLast = index === months.length - 1;
    const confirmations = isLast
      ? totalConfirmations
      : Math.round((totalConfirmations * cumulativePostsBeforeWindow) / totalPosts);
    return {
      label: monthLabel(key),
      score: isLast ? Math.round(summary.trust_score * 10) / 10 : scoreFor(averageFeedback, confirmations),
      posts: cumulativePostsBeforeWindow,
      confirmations,
    };
  });

  return points.length > 0 ? points : [{
    label: "Now",
    score: Math.round(summary.trust_score * 10) / 10,
    posts: sorted.length,
    confirmations: totalConfirmations,
  }];
}

function TrendChart({ points, postCount }: { points: TrendPoint[]; postCount: number }) {
  const chartPoints = points.length > 1
    ? points
    : [
        { ...(points[0] ?? { label: "Start", score: 0, posts: 0, confirmations: 0 }), label: "Start" },
        { ...(points[0] ?? { label: "Now", score: 0, posts: 0, confirmations: 0 }), label: points[0]?.label === "Start" ? "Now" : points[0]?.label ?? "Now" },
      ];
  const width = 320;
  const height = 122;
  const padX = 44;
  const plotTop = 18;
  const plotBottom = 80;
  const usableWidth = width - padX * 2;
  const usableHeight = plotBottom - plotTop;
  const plotted = chartPoints.map((point, index) => {
    const x = padX + (usableWidth * index) / (chartPoints.length - 1);
    const y = plotTop + usableHeight - (clamp(point.score, 0, 100) / 100) * usableHeight;
    return { ...point, x, y };
  });
  const path = plotted.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const fillPath = plotted.length > 1
    ? `${path} L ${plotted[plotted.length - 1].x} ${plotBottom} L ${plotted[0].x} ${plotBottom} Z`
    : "";

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <p style={{ margin: 0, color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: 10, fontWeight: 900, letterSpacing: 0.8 }}>
          TRACK RECORD
        </p>
        <p style={{ margin: 0, color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 800 }}>
          {postCount} post{postCount !== 1 ? "s" : ""}
        </p>
      </div>
      <div style={{ background: "rgba(13,9,7,0.72)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 13, padding: "15px 14px 13px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="122" role="img" aria-label="Trust score track record">
          <line x1={padX} y1={plotTop + 2} x2={width - padX} y2={plotTop + 2} stroke="rgba(255,255,255,0.045)" />
          <line x1={padX} y1={(plotTop + plotBottom) / 2} x2={width - padX} y2={(plotTop + plotBottom) / 2} stroke="rgba(255,255,255,0.06)" />
          <line x1={padX} y1={plotBottom} x2={width - padX} y2={plotBottom} stroke="rgba(255,255,255,0.06)" />
          {fillPath && <path d={fillPath} fill="rgba(240,96,48,0.12)" />}
          {plotted.length > 1 && <path d={path} fill="none" stroke="var(--orange)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
          {plotted.map((point) => {
            const scoreY = Math.max(11, point.y - 13);
            return (
              <g key={`${point.label}-${point.posts}`}>
                <text x={point.x} y={scoreY} textAnchor="middle" fill="var(--cream)" fontFamily="'DM Sans', sans-serif" fontSize="11" fontWeight="900">
                  {Math.round(point.score)}
                </text>
                <circle cx={point.x} cy={point.y} r="4.8" fill="var(--orange)" stroke="rgba(13,9,7,0.9)" strokeWidth="2" />
                <text x={point.x} y="110" textAnchor="middle" fill="var(--muted)" fontFamily="'DM Sans', sans-serif" fontSize="10" fontWeight="700">
                  {point.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

function Metric({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "11px 10px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ color: "var(--orange)", display: "inline-flex", flexShrink: 0 }}>{icon}</span>
        <p style={{ margin: 0, color: "var(--cream)", fontSize: 17, lineHeight: 1, fontWeight: 900, fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace", fontVariantNumeric: "tabular-nums" }}>{value}</p>
      </div>
      <p style={{ margin: "9px 0 0", color: "var(--muted)", fontSize: 10, lineHeight: 1.1, fontWeight: 800, fontFamily: "'DM Sans', sans-serif" }}>{label}</p>
    </div>
  );
}

function GrowthStep({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
      <div style={{ width: 38, height: 38, borderRadius: 13, background: "rgba(240,96,48,0.11)", border: "1px solid rgba(240,96,48,0.22)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--orange)" }}>
        {icon}
      </div>
      <p style={{ margin: 0, color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: 11, lineHeight: 1, fontWeight: 900 }}>
        {label}
      </p>
    </div>
  );
}

export default function TrustScoreSheet({
  summary,
  reviews,
  onClose,
}: {
  summary: TasteTrustSummary;
  reviews: Review[];
  onClose: () => void;
}) {
  const postCount = reviews.length;
  const points = buildTrend(summary, reviews);
  const matchText = summary.agreement_percentage == null ? "—" : `${summary.agreement_percentage}%`;
  const confirmations = summary.confirmed_recommendations_count;
  const confirmationsUntilLevel = Math.max(0, TASTE_TRUST_MIN_CONFIRMATIONS - confirmations);

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(0,0,0,0.60)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Trust score details"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 512,
          maxHeight: "88dvh",
          borderRadius: "20px 20px 0 0",
          background: "linear-gradient(180deg, #171717 0%, var(--card) 100%)",
          border: "1px solid rgba(255,255,255,0.09)",
          borderBottom: "none",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 -24px 80px rgba(0,0,0,0.42)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 18px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
          <p style={{ margin: 0, color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 800 }}>
            Trust Score
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 999, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <X size={15} strokeWidth={2.5} color="var(--muted)" />
          </button>
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: "16px 18px calc(28px + env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column", gap: 14, scrollbarWidth: "none" }}>
          <section style={{ display: "grid", gridTemplateColumns: "112px minmax(0, 1fr)", gap: 14, alignItems: "stretch" }}>
            <div style={{ minHeight: 118, borderRadius: 18, background: "linear-gradient(180deg, rgba(240,96,48,0.18), rgba(240,96,48,0.06))", border: "1.5px solid rgba(240,96,48,0.30)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxShadow: "0 18px 44px rgba(240,96,48,0.08)" }}>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 4 }}>
                <p style={{ margin: 0, color: "var(--cream)", fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace", fontSize: 40, lineHeight: 0.9, fontWeight: 900 }}>
                  {formatTrustScore(summary.trust_score)}
                </p>
                <p style={{ margin: "0 0 3px", color: "var(--orange)", fontFamily: "'DM Sans', sans-serif", fontSize: 11, lineHeight: 1, fontWeight: 900 }}>
                  /100
                </p>
              </div>
            </div>
            <div style={{ minWidth: 0, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, padding: "14px 14px 13px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 28, height: 28, borderRadius: 999, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--orange)", flexShrink: 0 }}>
                  <User size={15} strokeWidth={2.3} />
                </span>
                <p style={{ margin: 0, color: "var(--cream)", fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 900, lineHeight: 1.1 }}>
                  {summary.public_trust_level}
                </p>
              </div>
              <p style={{ margin: "12px 0 0", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: 12, lineHeight: 1.35, fontWeight: 800 }}>
                Earn trust when others try and confirm your posts.
              </p>
            </div>
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            <Metric icon={<FileText size={15} strokeWidth={2.2} />} value={String(postCount)} label="Posts" />
            <Metric icon={<ShieldCheck size={15} strokeWidth={2.2} />} value={String(confirmations)} label="Confirmed" />
            <Metric icon={<Users size={15} strokeWidth={2.2} />} value={matchText} label="Match" />
          </section>
          <div style={{ display: "flex", alignItems: "center", gap: 7, minHeight: 16, color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 800, lineHeight: 1 }}>
            <span style={{ width: 14, height: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <ShieldCheck size={13} strokeWidth={2.3} color="var(--orange)" />
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", minHeight: 14, transform: "translateY(1.2px)" }}>
              {confirmationsUntilLevel > 0
                ? `${confirmationsUntilLevel} more confirmation${confirmationsUntilLevel !== 1 ? "s" : ""} to unlock level`
                : "Level unlocked at 5 confirmations"}
            </span>
          </div>

          <TrendChart points={points} postCount={postCount} />

          <section style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "14px" }}>
            <p style={{ margin: 0, color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: 10, fontWeight: 900, letterSpacing: 0.8 }}>
              How it grows
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 13 }}>
              <GrowthStep icon={<Pencil size={16} strokeWidth={2.3} />} label="Post" />
              <ChevronRight size={15} strokeWidth={2.4} color="var(--muted)" />
              <GrowthStep icon={<Shield size={16} strokeWidth={2.3} />} label="Confirm" />
              <ChevronRight size={15} strokeWidth={2.4} color="var(--muted)" />
              <GrowthStep icon={<TrendingUp size={16} strokeWidth={2.3} />} label="Grow" />
            </div>
            <p style={{ margin: "13px 0 0", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", fontSize: 12, lineHeight: 1.2, fontWeight: 800, textAlign: "center" }}>
              Confirmations strengthen trust.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
