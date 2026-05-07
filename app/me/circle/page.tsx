"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Users } from "lucide-react";
import { avatarGradient, avatarInitials } from "@/lib/profile";
import { createClient } from "@/lib/supabase/client";
import type { AccountType, Review } from "@/lib/types";
import { DEFAULT_ACCOUNT_TYPE, accountTypeLabel } from "@/lib/circle";

interface Member {
  name: string;
  placeCount: number;
}

export default function MyCirclePage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [accountType, setAccountType] = useState<AccountType>(DEFAULT_ACCOUNT_TYPE);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const name = localStorage.getItem("fc_my_name") ?? "";
    if (!name) { setMounted(true); return; }

    (async () => {
      const res = await fetch(`/api/circle/status?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      setAccountType(data.accountType ?? DEFAULT_ACCOUNT_TYPE);
      const memberNames: string[] = data.displayMembers ?? data.members ?? [];

      if (memberNames.length === 0) { setMounted(true); return; }

      const supabase = createClient();
      const { data: reviews } = await supabase
        .from("reviews")
        .select("reviewer_name, restaurant_name")
        .in("reviewer_name", memberNames)
        .returns<Pick<Review, "reviewer_name" | "restaurant_name">[]>();

      const placeCounts = new Map<string, Set<string>>();
      for (const r of reviews ?? []) {
        if (!placeCounts.has(r.reviewer_name)) placeCounts.set(r.reviewer_name, new Set());
        placeCounts.get(r.reviewer_name)!.add(r.restaurant_name);
      }

      setMembers(memberNames.map(n => ({
        name: n,
        placeCount: placeCounts.get(n)?.size ?? 0,
      })));
      setMounted(true);
    })();
  }, []);

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>

      {/* Header */}
      <div style={{ padding: "16px 20px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
        <Link href="/me" style={{ textDecoration: "none", flexShrink: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
          </div>
        </Link>
        <div>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "17px", color: "var(--cream)", margin: 0 }}>
            My Circle
          </h1>
          {mounted && (
            <p style={{ fontSize: "12px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginTop: "2px" }}>
              {accountTypeLabel(accountType)} · {members.length} {members.length === 1 ? "person" : "people"}
            </p>
          )}
        </div>
      </div>

      {/* Loading skeleton */}
      {!mounted && (
        <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: "1px" }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse" style={{ height: "70px", background: "var(--card)", borderRadius: i === 1 ? "18px 18px 0 0" : i === 3 ? "0 0 18px 18px" : "0", opacity: 0.5, borderBottom: i < 3 ? "1px solid var(--border)" : "none" }} />
          ))}
        </div>
      )}

      {/* Content */}
      {mounted && members.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "80px 24px", gap: "14px" }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--orange-dim)", border: "1.5px solid rgba(240,96,48,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Users size={24} strokeWidth={1.8} color="var(--orange)" />
          </div>
          <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--cream)", margin: 0 }}>
            Your circle is empty
          </p>
          <p style={{ fontSize: "13px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", margin: 0, maxWidth: "240px", lineHeight: 1.5 }}>
            {accountType === "public" ? "No one has joined your circle yet" : "Add friends to build your circle"}
          </p>
          <Link href="/people" style={{ textDecoration: "none" }}>
            <button style={{ background: "var(--orange)", color: "white", border: "none", borderRadius: "14px", padding: "13px 28px", fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
              Find friends
            </button>
          </Link>
        </div>
      )}

      {mounted && members.length > 0 && (
        <div style={{ padding: "0 20px" }}>
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "18px", overflow: "hidden" }}>
            {members.map(({ name, placeCount }, i) => (
              <Link key={name} href={`/people/${encodeURIComponent(name)}`} style={{ textDecoration: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderBottom: i < members.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <div style={{ width: 42, height: 42, borderRadius: "12px", background: avatarGradient(name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", fontWeight: 700, color: "white", flexShrink: 0, fontFamily: "'Syne', sans-serif" }}>
                    {avatarInitials(name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {name}
                    </p>
                    <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginTop: "2px" }}>
                      {placeCount} place{placeCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <ChevronRight size={16} strokeWidth={2} color="var(--muted)" />
                </div>
              </Link>
            ))}
          </div>

          <Link href="/people" style={{ textDecoration: "none" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 0", gap: "6px", color: "var(--orange)", fontSize: "13px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
              + Add more friends
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}
