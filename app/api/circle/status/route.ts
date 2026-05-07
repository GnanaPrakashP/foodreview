import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCircleActor } from "@/lib/circle-auth";
import { DEFAULT_ACCOUNT_TYPE } from "@/lib/circle";
import { getAccountTypeForName, getAccountTypesForNames } from "@/lib/circle-db";
import type { CircleRelationshipState } from "@/lib/types";

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

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );

  const actor = await getAuthenticatedCircleActor(supabase);
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
    if (row.status === "accepted") {
      if (row.sender_name === name) {
        circleMembersSet.add(row.receiver_name);
        joinedCirclesSet.add(row.receiver_name);
      }
      if (row.receiver_name === name) {
        circleMembersSet.add(row.sender_name);
        joinedCirclesSet.add(row.sender_name);
      }
      continue;
    }

    if (row.status !== "pending") continue;
    if (row.receiver_name === name && !circleMembersSet.has(row.sender_name)) pendingIncomingSet.add(row.sender_name);
    if (row.sender_name === name && !joinedCirclesSet.has(row.receiver_name)) pendingSentSet.add(row.receiver_name);
  }

  const circleMembers = Array.from(circleMembersSet);
  const joinedCircles = Array.from(joinedCirclesSet);
  const mutualMembers = joinedCircles.filter((member) => circleMembersSet.has(member));
  const oneWayMembers = joinedCircles.filter((member) => !circleMembersSet.has(member));
  const pendingIncoming = Array.from(pendingIncomingSet);
  const pendingSent = Array.from(pendingSentSet);

  const memberStates: Record<string, CircleRelationshipState> = {};
  for (const member of joinedCircles) {
    memberStates[member] = circleMembersSet.has(member) ? "CIRCLE_MUTUAL" : "CIRCLE_ONE_WAY";
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
