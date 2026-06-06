import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { getAuthenticatedCircleActor } from "@/lib/circle-auth";

export async function createRouteSupabase(req?: NextRequest) {
  const bearerToken = req?.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearerToken) {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${bearerToken}`,
          },
        },
        auth: {
          persistSession: false,
        },
      }
    );
  }

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    }
  );
}

export async function getRouteActor(req?: NextRequest) {
  const supabase = await createRouteSupabase(req);
  const actor = await getAuthenticatedCircleActor(supabase);
  return { supabase, actor };
}
