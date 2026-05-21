"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { readCachedJson } from "@/lib/browser-api-cache";
import type { CircleFeedPage } from "@/lib/circle-feed";
import CirclePageClient, { CircleSkeleton } from "./CirclePageClient";

const API_URL = "/api/feed/circle";

function GenericLoadingSkeleton() {
  return (
    <div
      className="flex flex-col gap-4 px-5 pt-6"
      style={{ background: "var(--bg)", minHeight: "100vh" }}
    >
      <div style={{ height: "18px", width: "120px", background: "var(--card)", borderRadius: "8px" }} className="animate-pulse" />
      <div style={{ height: "32px", width: "200px", background: "var(--card)", borderRadius: "8px" }} className="animate-pulse" />

      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "20px",
            overflow: "hidden",
          }}
        >
          <div
            style={{ aspectRatio: "4/5", background: "var(--surface)" }}
            className="animate-pulse"
          />
          <div className="p-4 flex flex-col gap-3">
            <div style={{ height: "20px", width: "60%", background: "var(--surface)", borderRadius: "6px" }} className="animate-pulse" />
            <div style={{ height: "14px", width: "40%", background: "var(--surface)", borderRadius: "6px" }} className="animate-pulse" />
            <div style={{ height: "14px", width: "30%", background: "var(--surface)", borderRadius: "6px" }} className="animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CircleLoadingClient() {
  const pathname = usePathname();
  const [data] = useState(() => readCachedJson<CircleFeedPage>(API_URL));

  if (pathname !== "/") return <GenericLoadingSkeleton />;
  if (!data) return <CircleSkeleton />;

  return <CirclePageClient initialData={data} />;
}
