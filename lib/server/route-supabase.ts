import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getAuthenticatedCircleActor } from "@/lib/circle-auth";

export async function createRouteSupabase() {
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

export async function getRouteActor() {
  const supabase = await createRouteSupabase();
  const actor = await getAuthenticatedCircleActor(supabase);
  return { supabase, actor };
}
