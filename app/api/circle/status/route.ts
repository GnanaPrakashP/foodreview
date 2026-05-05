import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAccountTypeForName, getAccountTypesForNames } from "@/lib/circle-db";
import type { CircleRelationshipState } from "@/lib/types";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({
      accountType: "private",
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

  const [{ data: edgeRows }, { data: requestRows }, accountType] = await Promise.all([
    supabase
      .from("circle_memberships")
      .select("user_name, member_name")
      .or(`user_name.eq.${name},member_name.eq.${name}`),
    supabase
      .from("circle_requests")
      .select("sender_name, receiver_name, status")
      .or(`sender_name.eq.${name},receiver_name.eq.${name}`)
      .eq("status", "pending"),
    getAccountTypeForName(supabase, name),
  ]);

  const circleMembersSet = new Set<string>();
  const joinedCirclesSet = new Set<string>();
  for (const row of edgeRows ?? []) {
    if (row.user_name === name) circleMembersSet.add(row.member_name);
    if (row.member_name === name) joinedCirclesSet.add(row.user_name);
  }

  const circleMembers = Array.from(circleMembersSet);
  const joinedCircles = Array.from(joinedCirclesSet);
  const mutualMembers = joinedCircles.filter((member) => circleMembersSet.has(member));
  const oneWayMembers = joinedCircles.filter((member) => !circleMembersSet.has(member));

  const pendingIncoming: string[] = [];
  const pendingSent: string[] = [];

  for (const row of requestRows ?? []) {
    if (row.receiver_name === name) pendingIncoming.push(row.sender_name);
    if (row.sender_name === name) pendingSent.push(row.receiver_name);
  }

  const memberStates: Record<string, CircleRelationshipState> = {};
  for (const member of joinedCircles) {
    memberStates[member] = circleMembersSet.has(member) ? "CIRCLE_MUTUAL" : "CIRCLE_ONE_WAY";
  }
  for (const pending of pendingSent) {
    memberStates[pending] = "PENDING";
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
    pendingIncoming,
    pendingSent,
    memberStates,
    accountTypes,
    circleCount: circleMembers.length,
  });
}
