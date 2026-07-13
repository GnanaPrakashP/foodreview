import { NextRequest, NextResponse } from "next/server";
import { getRouteActor } from "@/lib/server/route-supabase";

export async function GET(req: NextRequest) {
  const { actorResolution } = await getRouteActor(req);
  if (actorResolution.status === "unauthenticated" || actorResolution.status === "invalid") {
    return NextResponse.json({ status: "unauthenticated" }, { status: 401 });
  }
  if (actorResolution.status === "unavailable") {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
  const status = actorResolution.status === "active"
    ? "active"
    : actorResolution.status === "frozen"
      ? "deleting"
      : "missing";
  return NextResponse.json({ status }, { headers: { "Cache-Control": "private, no-store" } });
}
