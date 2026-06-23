import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotificationForNames } from "@/lib/notifications";
import { memoryErrorKind, memoryOperationDurationMs, recordMemoryOperation } from "@/lib/server/memory-observability";
import { assertMemoryRoomMutationAllowed, memoryRoomSecurityErrorStatus } from "@/lib/server/memory-room-security";
import { getRouteActor } from "@/lib/server/route-supabase";

type RoomRow = {
  id: string;
  restaurant_name: string;
};

type ProfileRow = {
  username: string;
};

type BlockRow = {
  blocked_name: string | null;
  blocker_name: string | null;
};

type MemberRow = {
  user_name: string;
};

type InviteRow = {
  id: string;
  receiver_name: string;
};

type InviteParticipantsResult = {
  added: string[];
  alreadyMembers: string[];
  blocked: string[];
  invited: string[];
  notFound: string[];
};

function normalizeUsername(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function uniqueUsernames(values: unknown[]) {
  return Array.from(new Set(values.map(normalizeUsername).filter(Boolean))).slice(0, 20);
}

function isMissingTableError(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "42P01"
    || error?.code === "PGRST205"
    || message.includes("Could not find the table")
    || message.includes("shared_memory_invites");
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  const startedAt = Date.now();
  try {
    const { roomId } = await context.params;
    const body = await req.json().catch(() => null) as { usernames?: unknown } | null;
    const usernames = uniqueUsernames(Array.isArray(body?.usernames) ? body.usernames : []);

    if (!roomId || usernames.length === 0) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { actor, supabase } = await getRouteActor(req);
    if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const admin = createAdminClient();
    const inviter = actor.actorName;
    const result: InviteParticipantsResult = {
      added: [],
      alreadyMembers: [],
      blocked: [],
      invited: [],
      notFound: []
    };

    const { data: room, error: roomError } = await admin
      .from("shared_memory_rooms")
      .select("id, restaurant_name")
      .eq("id", roomId)
      .maybeSingle<RoomRow>();

    if (roomError) return NextResponse.json({ error: "Unable to load memory room" }, { status: 500 });
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    await assertMemoryRoomMutationAllowed({
      actorName: inviter,
      admin,
      roomId,
      supabase
    });

    const { data: membershipRows, error: membershipError } = await admin
      .from("shared_memory_members")
      .select("user_name")
      .eq("room_id", roomId)
      .returns<MemberRow[]>();

    if (membershipError) return NextResponse.json({ error: "Unable to load room members" }, { status: 500 });
    const memberNames = new Set((membershipRows ?? []).map((member) => member.user_name));
    if (!memberNames.has(inviter)) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const { data: profiles, error: profileError } = await admin
      .from("profiles")
      .select("username")
      .in("username", usernames)
      .returns<ProfileRow[]>();

    if (profileError) return NextResponse.json({ error: "Unable to load profiles" }, { status: 500 });

    const profileNames = new Set((profiles ?? []).map((profile) => profile.username));
    result.notFound = usernames.filter((username) => !profileNames.has(username));

    const candidateNames = (profiles ?? [])
      .map((profile) => profile.username)
      .filter((username) => username !== inviter);

    if (candidateNames.length === 0) return NextResponse.json(result);

    const relationshipNames = Array.from(new Set([...memberNames, ...candidateNames]));
    const { data: blockRows, error: blockError } = await admin
      .from("blocked_users")
      .select("blocker_name, blocked_name")
      .in("blocker_name", relationshipNames)
      .in("blocked_name", relationshipNames)
      .returns<BlockRow[]>();

    if (blockError) return NextResponse.json({ error: "Unable to verify participant permissions" }, { status: 500 });

    const blockedTargets = new Set<string>();
    for (const candidate of candidateNames) {
      const blocked = (blockRows ?? []).some((block) => {
        const blocker = block.blocker_name;
        const blockedName = block.blocked_name;
        if (!blocker || !blockedName || blocker === blockedName) return false;
        if (blocker === candidate && relationshipNames.includes(blockedName)) return true;
        if (blockedName === candidate && relationshipNames.includes(blocker)) return true;
        return false;
      });
      if (blocked) blockedTargets.add(candidate);
    }

    result.blocked = candidateNames.filter((username) => blockedTargets.has(username));
    const allowedCandidateNames = candidateNames.filter((username) => !blockedTargets.has(username));
    if (allowedCandidateNames.length === 0) return NextResponse.json(result);

    const { data: existingRows, error: existingError } = await admin
      .from("shared_memory_members")
      .select("user_name")
      .eq("room_id", roomId)
      .in("user_name", allowedCandidateNames);

    if (existingError) return NextResponse.json({ error: "Unable to load existing participants" }, { status: 500 });

    const existingMembers = new Set((existingRows ?? []).map((row: { user_name: string }) => row.user_name));
    result.alreadyMembers = allowedCandidateNames.filter((username) => existingMembers.has(username));
    const targetNames = allowedCandidateNames.filter((username) => !existingMembers.has(username));

    if (targetNames.length === 0) return NextResponse.json(result);

    const { data: circleRows, error: circleError } = await admin
      .from("circle_memberships")
      .select("member_name")
      .eq("user_name", inviter)
      .in("member_name", targetNames);

    if (circleError) return NextResponse.json({ error: "Unable to verify circle membership" }, { status: 500 });

    const circleMembers = new Set((circleRows ?? []).map((row: { member_name: string }) => row.member_name));
    const addNames = targetNames.filter((username) => circleMembers.has(username));
    const inviteNames = targetNames.filter((username) => !circleMembers.has(username));

    if (addNames.length > 0) {
      const { error: addError } = await admin
        .from("shared_memory_members")
        .upsert(
          addNames.map((username) => ({ room_id: roomId, user_name: username, role: "participant" })),
          { onConflict: "room_id,user_name" }
        );

      if (addError) return NextResponse.json({ error: "Unable to add participants" }, { status: 500 });
      result.added = addNames;
    }

    let inviteRows: InviteRow[] = [];
    if (inviteNames.length > 0) {
      const now = new Date().toISOString();
      const inviteInsert = await admin
        .from("shared_memory_invites")
        .upsert(
          inviteNames.map((username) => ({
            receiver_name: username,
            room_id: roomId,
            sender_name: inviter,
            status: "pending",
            updated_at: now
          })),
          { onConflict: "room_id,receiver_name" }
        )
        .select("id, receiver_name")
        .returns<InviteRow[]>();

      if (inviteInsert.error && !isMissingTableError(inviteInsert.error)) {
        return NextResponse.json({ error: "Unable to invite participants" }, { status: 500 });
      }

      inviteRows = inviteInsert.data ?? inviteNames.map((receiverName) => ({ id: "", receiver_name: receiverName }));
      result.invited = inviteRows.map((invite) => invite.receiver_name);

      await Promise.all(inviteRows.map((invite) => createNotificationForNames(admin, {
        recipientName: invite.receiver_name,
        actorName: inviter,
        type: "TABLE_MEMORY_INVITE",
        title: "Table Memory",
        message: "You have a new memory room invite.",
        entityType: "TABLE_MEMORY",
        entityId: roomId,
        metadata: {
          inviteId: invite.id || null,
          status: "pending"
        },
        dedupe: true
      })));
    }

    recordMemoryOperation("memory_participants.invite", {
      durationMs: memoryOperationDurationMs(startedAt),
      status: "success",
      statusCode: 200
    });
    return NextResponse.json(result);
  } catch (error) {
    recordMemoryOperation("memory_participants.invite", {
      durationMs: memoryOperationDurationMs(startedAt),
      errorKind: memoryErrorKind(error),
      status: "error",
      statusCode: memoryRoomSecurityErrorStatus(error)
    });
    return NextResponse.json({ error: "Unable to invite participants" }, { status: memoryRoomSecurityErrorStatus(error) });
  }
}
