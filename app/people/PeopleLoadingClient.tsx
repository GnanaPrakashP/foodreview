"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { readCachedJson } from "@/lib/browser-api-cache";
import { readPendingRoute } from "@/lib/browser-navigation-intent";
import { isInitialDocumentReload } from "@/lib/browser-navigation-state";
import PeoplePageClient, { PeopleSkeleton } from "./PeoplePageClient";
import type { CircleMember } from "@/lib/people-page-data";

const API_URL = "/api/people";

type PeopleApiResponse = {
  circleMembers: CircleMember[];
  myName?: string;
};

export default function PeopleLoadingClient() {
  const pathname = usePathname();
  const [pendingPathname] = useState(() => readPendingRoute());
  const [data] = useState(() => isInitialDocumentReload() ? null : readCachedJson<PeopleApiResponse>(API_URL, { allowStale: true }));

  if (pathname !== "/explore" && pendingPathname !== "/explore") return <PeopleSkeleton />;
  if (!data) return <PeopleSkeleton />;

  return <PeoplePageClient initialData={data} />;
}
