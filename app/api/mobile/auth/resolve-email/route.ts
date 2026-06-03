import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type AuthMode = "sign_in" | "sign_up";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAGE_SIZE = 1000;
const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

function mobileJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...CORS_HEADERS,
      ...init?.headers
    }
  });
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function emailExistsInAuthUsers(email: string) {
  const admin = createAdminClient();

  const { data, error } = await admin
    .schema("auth")
    .from("users")
    .select("id")
    .eq("email", email)
    .limit(1);

  if (!error) return Boolean(data?.length);

  // Fallback for hosted projects that do not expose auth.users through PostgREST.
  for (let page = 1; page < 100; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (result.error) throw result.error;

    const users = result.data.users ?? [];
    if (users.some((user) => user.email?.toLowerCase() === email)) return true;
    if (users.length < PAGE_SIZE) return false;
  }

  throw new Error("Unable to resolve email");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const email = normalizeEmail(body?.email);

    if (!EMAIL_RE.test(email)) {
      return mobileJson({ error: "Enter a valid email address" }, { status: 400 });
    }

    const mode: AuthMode = await emailExistsInAuthUsers(email) ? "sign_in" : "sign_up";
    return mobileJson({ mode });
  } catch (error) {
    console.error("[mobile auth resolve-email] failed:", error);
    return mobileJson({ error: "Unable to continue with this email" }, { status: 500 });
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    headers: CORS_HEADERS,
    status: 204
  });
}
