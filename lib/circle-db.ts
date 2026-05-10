import type { AccountType } from "@/lib/types";
import { DEFAULT_ACCOUNT_TYPE, normalizeAccountType } from "@/lib/circle";

type CircleDb = {
  from: (table: string) => any;
};

type CircleDbError = {
  message: string;
  code?: string;
  details?: string | null;
};

function isMissingTableError(error: CircleDbError | null | undefined): boolean {
  return error?.code === "PGRST205" || Boolean(error?.message?.includes("Could not find the table"));
}

function logUnexpectedCircleDbError(message: string, error: CircleDbError | null | undefined) {
  if (!error || isMissingTableError(error)) return;
  console.warn(message, error.message, error.code, error.details);
}

type ProfileRow = {
  first_name: string;
  last_name: string;
  account_type: string | null;
};

function profileName(profile: Pick<ProfileRow, "first_name" | "last_name">): string {
  return `${profile.first_name} ${profile.last_name}`.trim();
}

export async function getAccountTypeForName(db: CircleDb, name: string): Promise<AccountType> {
  const firstName = name.trim().split(/\s+/)[0] ?? "";

  const { data } = await db
    .from("profiles")
    .select("first_name, last_name, account_type")
    .ilike("first_name", firstName)
    .limit(100);

  const profile = ((data ?? []) as ProfileRow[]).find((row) => profileName(row) === name);
  return profile ? normalizeAccountType(profile.account_type) : DEFAULT_ACCOUNT_TYPE;
}

export async function getAccountTypesForNames(
  db: CircleDb,
  names: string[]
): Promise<Record<string, AccountType>> {
  const uniqueNames = Array.from(new Set(names.filter(Boolean)));
  if (uniqueNames.length === 0) return {};

  const wanted = new Set(uniqueNames);
  const result: Record<string, AccountType> = {};

  const firstNames = [...new Set(
    uniqueNames.map((n) => n.trim().split(/\s+/)[0]).filter(Boolean)
  )];

  const orFilter = firstNames.map((f) => `first_name.ilike.${f}`).join(",");
  const { data } = await db
    .from("profiles")
    .select("first_name, last_name, account_type")
    .or(orFilter)
    .limit(1000);

  for (const row of (data ?? []) as ProfileRow[]) {
    const name = profileName(row);
    if (wanted.has(name)) result[name] = normalizeAccountType(row.account_type);
  }

  for (const name of uniqueNames) {
    result[name] ??= DEFAULT_ACCOUNT_TYPE;
  }

  return result;
}

export async function hasCircleEdge(db: CircleDb, userName: string, memberName: string): Promise<boolean> {
  const { data, error } = await db
    .from("circle_memberships")
    .select("id")
    .eq("user_name", userName)
    .eq("member_name", memberName)
    .limit(1);

  if (error) {
    logUnexpectedCircleDbError("[circle-db] failed to read circle edge:", error);
    return false;
  }

  return (data ?? []).length > 0;
}

async function hasAcceptedCircleRequest(db: CircleDb, firstName: string, secondName: string): Promise<boolean> {
  const [{ data: firstRows, error: firstError }, { data: secondRows, error: secondError }] = await Promise.all([
    db
      .from("circle_requests")
      .select("id")
      .eq("sender_name", firstName)
      .eq("receiver_name", secondName)
      .eq("status", "accepted")
      .limit(1),
    db
      .from("circle_requests")
      .select("id")
      .eq("sender_name", secondName)
      .eq("receiver_name", firstName)
      .eq("status", "accepted")
      .limit(1),
  ]);

  logUnexpectedCircleDbError("[circle-db] failed to read accepted circle request:", firstError);
  logUnexpectedCircleDbError("[circle-db] failed to read accepted circle request:", secondError);

  return (firstRows ?? []).length > 0 || (secondRows ?? []).length > 0;
}

export async function hasCircleAccess(db: CircleDb, ownerName: string, viewerName: string): Promise<boolean> {
  if (!ownerName || !viewerName) return false;
  if (ownerName === viewerName) return true;
  return hasCircleEdge(db, ownerName, viewerName);
}

export async function getCircleRelationshipsForName(db: CircleDb, name: string): Promise<{
  circleMembers: Set<string>;
  joinedCircles: Set<string>;
  mutualMembers: Set<string>;
}> {
  const circleMembers = new Set<string>();
  const joinedCircles = new Set<string>();

  if (!name) return { circleMembers, joinedCircles, mutualMembers: new Set() };

  const { data: edgeRows, error: edgeError } = await db
    .from("circle_memberships")
    .select("user_name, member_name")
    .or(`user_name.eq."${name}",member_name.eq."${name}"`);

  logUnexpectedCircleDbError("[circle-db] failed to read circle memberships:", edgeError);

  for (const row of edgeRows ?? []) {
    if (row.user_name === name) circleMembers.add(row.member_name);
    if (row.member_name === name) joinedCircles.add(row.user_name);
  }

  const mutualMembers = new Set(Array.from(joinedCircles).filter((member) => circleMembers.has(member)));
  return { circleMembers, joinedCircles, mutualMembers };
}

async function insertCircleEdge(db: CircleDb, userName: string, memberName: string): Promise<CircleDbError | null> {
  if (await hasCircleEdge(db, userName, memberName)) return null;

  const { error } = await db
    .from("circle_memberships")
    .insert({ user_name: userName, member_name: memberName });

  // If the live DB has the unique constraint, a concurrent insert can still race.
  if (!error || error.code === "23505") return null;
  if (isMissingTableError(error)) {
    return ensureAcceptedCircleRequest(db, memberName, userName);
  }
  return error;
}

async function ensureAcceptedCircleRequest(db: CircleDb, senderName: string, receiverName: string): Promise<CircleDbError | null> {
  if (await hasAcceptedCircleRequest(db, senderName, receiverName)) return null;

  const { error } = await db
    .from("circle_requests")
    .insert({ sender_name: senderName, receiver_name: receiverName, status: "accepted" });

  if (!error) return null;
  if (error.code === "23505") {
    const { error: updateError } = await db
      .from("circle_requests")
      .update({ status: "accepted" })
      .eq("sender_name", senderName)
      .eq("receiver_name", receiverName);
    return updateError ?? null;
  }
  return error;
}

export async function addCircleEdge(db: CircleDb, userName: string, memberName: string) {
  return { error: await insertCircleEdge(db, userName, memberName) };
}

export async function addMutualCircleEdges(db: CircleDb, firstName: string, secondName: string) {
  const firstError = await insertCircleEdge(db, firstName, secondName);
  if (firstError) return { error: firstError };

  const secondError = await insertCircleEdge(db, secondName, firstName);
  return { error: secondError };
}
