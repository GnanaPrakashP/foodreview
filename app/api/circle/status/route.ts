import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_ACCOUNT_TYPE } from "@/lib/circle";
import { getAccountTypeForName, getAccountTypesForNames } from "@/lib/circle-db";
import type { CircleRelationshipState } from "@/lib/types";
import { getRouteActor } from "@/lib/server/route-supabase";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({
      accountType: DEFAULT_ACCOUNT_TYPE,
      members: [],
      mutualMembers: [],
      oneWayMembers: [],
      audienceMembers: [],
      displayMembers: [],
      pendingIncoming: [],
      pendingSent: [],
      memberStates: {},
      accountTypes: {},
      circleCount: 0,
    });
  }

  const { actor, supabase } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const canSeePendingState = actor?.actorName === name;

  const [{ data: edgeRows }, { data: requestRows }, accountType] = await Promise.all([
    supabase
      .from("circle_memberships")
      .select("user_name, member_name")
      .or(`user_name.eq."${name}",member_name.eq."${name}"`),
    supabase
      .from("circle_requests")
      .select("sender_name, receiver_name, status")
      .or(`sender_name.eq."${name}",receiver_name.eq."${name}"`),
    getAccountTypeForName(supabase, name),
  ]);

  const circleMembersSet = new Set<string>();
  const joinedCirclesSet = new Set<string>();
  for (const row of edgeRows ?? []) {
    if (row.user_name === name) circleMembersSet.add(row.member_name);
    if (row.member_name === name) joinedCirclesSet.add(row.user_name);
  }

  const pendingIncomingSet = new Set<string>();
  const pendingSentSet = new Set<string>();

  for (const row of requestRows ?? []) {
    if (row.status !== "pending") continue;
    if (row.receiver_name === name && !circleMembersSet.has(row.sender_name)) pendingIncomingSet.add(row.sender_name);
    if (row.sender_name === name && !joinedCirclesSet.has(row.receiver_name)) pendingSentSet.add(row.receiver_name);
  }

  const circleMembers = Array.from(circleMembersSet);
  const joinedCircles = Array.from(joinedCirclesSet);
  const mutualMembers: string[] = [];
  const oneWayMembers = joinedCircles;
  const pendingIncoming = Array.from(pendingIncomingSet);
  const pendingSent = Array.from(pendingSentSet);

  const memberStates: Record<string, CircleRelationshipState> = {};
  for (const member of joinedCircles) {
    memberStates[member] = "CIRCLE_ONE_WAY";
  }
  if (canSeePendingState) {
    for (const pending of pendingSent) {
      memberStates[pending] = "PENDING";
    }
  }

  const accountTypes = await getAccountTypesForNames(supabase, [
    ...circleMembers,
    ...joinedCircles,
    ...pendingIncoming,
    ...pendingSent,
  ]);

  return NextResponse.json({
    accountType,
    // Compatibility: screens that need "people whose posts I see" read `members`.
    members: joinedCircles,
    joinedCircles,
    mutualMembers,
    oneWayMembers,
    // The actual owner -> audience Circle list.
    circleMembers,
    audienceMembers: circleMembers,
    displayMembers: circleMembers,
    pendingIncoming: canSeePendingState ? pendingIncoming : [],
    pendingSent: canSeePendingState ? pendingSent : [],
    memberStates,
    accountTypes,
    circleCount: circleMembers.length,
  });
}
