import type { AccountType } from "@/lib/types";
import { DEFAULT_ACCOUNT_TYPE, normalizeAccountType } from "@/lib/circle";

type CircleDb = {
  from: (table: string) => any;
};

type ProfileRow = {
  first_name: string;
  last_name: string;
  account_type: string | null;
};

function profileName(profile: Pick<ProfileRow, "first_name" | "last_name">): string {
  return `${profile.first_name} ${profile.last_name}`.trim();
}

export async function getAccountTypeForName(db: CircleDb, name: string): Promise<AccountType> {
  const { data } = await db
    .from("profiles")
    .select("first_name, last_name, account_type")
    .limit(1000);

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

  const { data } = await db
    .from("profiles")
    .select("first_name, last_name, account_type")
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
  const { data } = await db
    .from("circle_memberships")
    .select("id")
    .eq("user_name", userName)
    .eq("member_name", memberName)
    .maybeSingle();

  return Boolean(data);
}

export async function addCircleEdge(db: CircleDb, userName: string, memberName: string) {
  return db
    .from("circle_memberships")
    .upsert(
      { user_name: userName, member_name: memberName },
      { onConflict: "user_name,member_name", ignoreDuplicates: true }
    );
}

export async function addMutualCircleEdges(db: CircleDb, firstName: string, secondName: string) {
  return db
    .from("circle_memberships")
    .upsert(
      [
        { user_name: firstName, member_name: secondName },
        { user_name: secondName, member_name: firstName },
      ],
      { onConflict: "user_name,member_name", ignoreDuplicates: true }
    );
}
