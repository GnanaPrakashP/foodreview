"use client";

import { useState } from "react";
import { readCachedJson } from "@/lib/browser-api-cache";
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
  const [data] = useState(() => readCachedJson<MeApiResponse>(API_URL, { allowStale: true }));

  if (!data) return <MeSkeleton />;

  return <MePageClient initialData={data} />;
}
