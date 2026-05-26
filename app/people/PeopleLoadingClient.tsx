"use client";

import { useState } from "react";
import { readCachedJson } from "@/lib/browser-api-cache";
import PeoplePageClient, { PeopleSkeleton } from "./PeoplePageClient";
import type { CircleMember } from "@/lib/people-page-data";

const API_URL = "/api/people";

type PeopleApiResponse = {
  circleMembers: CircleMember[];
};

export default function PeopleLoadingClient() {
  const [data] = useState(() => readCachedJson<PeopleApiResponse>(API_URL, { allowStale: true }));

  if (!data) return <PeopleSkeleton />;

  return <PeoplePageClient initialData={data} />;
}
