import { NextRequest, NextResponse } from "next/server";
import { getTasteTrustSummaryForUsername } from "@/lib/server/taste-trust";
import { createAdminClient } from "@/lib/supabase/admin";

type Props = {
  params: Promise<{ username: string }>;
};

export async function GET(_req: NextRequest, { params }: Props) {
  const { username } = await params;
  const name = decodeURIComponent(username).trim();
  if (!name) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  try {
    const summary = await getTasteTrustSummaryForUsername(createAdminClient(), name);
    if (!summary) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ summary });
  } catch (error) {
    console.error("[taste-trust] failed to load summary:", error);
    return NextResponse.json({ error: "Unable to load Taste Trust" }, { status: 500 });
  }
}
