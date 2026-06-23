type SupabaseLike = {
  from: (table: string) => any;
};

export async function assertMemoryRoomMutationAllowed({
  actorName,
  admin,
  roomId,
  supabase
}: {
  actorName: string;
  admin: SupabaseLike;
  roomId: string;
  supabase: SupabaseLike;
}) {
  const { data: members, error: membersError } = await supabase
    .from("shared_memory_members")
    .select("user_name")
    .eq("room_id", roomId);

  if (membersError) throw membersError;
  const memberNames = ((members ?? []) as Array<{ user_name: string | null }>)
    .map((member) => member.user_name)
    .filter((value): value is string => Boolean(value));

  if (!memberNames.includes(actorName)) {
    const error = new Error("memory_room_not_found");
    error.name = "MemoryRoomNotFound";
    throw error;
  }

  const { data: blocks, error: blockError } = await admin
    .from("blocked_users")
    .select("blocker_name, blocked_name")
    .or(`blocker_name.eq.${actorName},blocked_name.eq.${actorName}`);

  if (blockError) throw blockError;
  const memberSet = new Set(memberNames);
  const blocked = ((blocks ?? []) as Array<{ blocked_name: string | null; blocker_name: string | null }>)
    .some((row) => {
      const counterpart = row.blocker_name === actorName ? row.blocked_name : row.blocked_name === actorName ? row.blocker_name : null;
      return Boolean(counterpart && memberSet.has(counterpart));
    });

  if (blocked) {
    const error = new Error("memory_room_blocked_relationship");
    error.name = "MemoryRoomBlockedRelationship";
    throw error;
  }

  return memberNames;
}

export function memoryRoomSecurityErrorStatus(error: unknown) {
  if (error instanceof Error && error.name === "MemoryRoomNotFound") return 404;
  if (error instanceof Error && error.name === "MemoryRoomBlockedRelationship") return 403;
  return 500;
}
