"use client";

import { useState } from "react";
import { readCachedJson } from "@/lib/browser-api-cache";
import { isInitialDocumentReload } from "@/lib/browser-navigation-state";
import MePageClient, { MeSkeleton } from "./MePageClient";
import type { Review } from "@/lib/types";

const API_URL = "/api/me";

type MeApiResponse = {
  reviews: Review[];
  circleMembers: string[];
  myName: string;
  displayName: string;
  hasMore?: boolean;
  nextCursor?: { id: string; createdAt: string } | null;
};

export default function MeLoadingClient() {
  // On hard reload the sessionStorage cache may be stale; skip it so we don't
  // flash old profile data before the fresh fetch arrives.
  const [data] = useState(() => isInitialDocumentReload() ? null : readCachedJson<MeApiResponse>(API_URL, { allowStale: true }));

  if (!data) return <MeSkeleton />;

  return <MePageClient initialData={data} />;
}
