"use client";

import type { TasteTrustSummary } from "@/lib/taste-trust";

type Props = {
  summary: TasteTrustSummary;
};

export default function TasteTrustCard({ summary }: Props) {
  const hasConfirmations = summary.confirmed_recommendations_count > 0;
  const hasEnoughConfirmations = summary.confirmed_recommendations_count >= 5;
  const agreementText = hasConfirmations && summary.agreement_percentage !== null
    ? `${summary.agreement_percentage}% agreement`
    : "No confirmed recommendations yet";

  return (
    <section style={{ padding: "0 20px 16px" }}>
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "14px 15px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 800, color: "var(--cream)", margin: 0 }}>
            Taste Trust
          </p>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", fontWeight: 800, color: "var(--orange)", margin: 0 }}>
            {summary.public_trust_level}
          </p>
        </div>
        {hasEnoughConfirmations ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px", marginTop: "12px" }}>
            <TrustMetric value={agreementText} label="Agreement" />
            <TrustMetric value={String(summary.confirmed_recommendations_count)} label="Confirmed tries" />
            <TrustMetric value={`${summary.positive_confirmations_count}/${summary.negative_confirmations_count}`} label="Positive / negative" />
          </div>
        ) : (
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", lineHeight: 1.45, color: "var(--muted)", margin: "10px 0 0" }}>
            {hasConfirmations ? `${summary.confirmed_recommendations_count} confirmed tr${summary.confirmed_recommendations_count === 1 ? "y" : "ies"}. Not enough confirmations yet` : "No confirmed recommendations yet"}
          </p>
        )}
      </div>
    </section>
  );
}

function TrustMetric({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ minWidth: 0, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "10px 8px", textAlign: "center" }}>
      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 800, color: "var(--cream)", lineHeight: 1.1, overflowWrap: "anywhere" }}>
        {value}
      </div>
      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "10px", color: "var(--muted)", marginTop: "5px", lineHeight: 1.2 }}>
        {label}
      </div>
    </div>
  );
}
