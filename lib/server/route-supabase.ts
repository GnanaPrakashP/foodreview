import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestPerformanceTrace } from "@/lib/server/request-performance";

export type RequestActor = {
  actorName: string;
  displayName: string;
  userId: string;
};

export type RequestActorResolution =
  | { actor: RequestActor; status: "active" }
  | { actor: null; status: "frozen" | "incomplete_profile" | "invalid" | "missing_profile" | "unauthenticated" | "unavailable" };

const actorResolutionCache = new WeakMap<NextRequest, Promise<{
  actorResolution: RequestActorResolution;
  authenticatedUserId: string | null;
  supabase: Awaited<ReturnType<typeof createRouteSupabase>>;
}>>();

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
  if (!req) {
    const supabase = await createRouteSupabase();
    return {
      actor: null,
      actorResolution: { actor: null, status: "unauthenticated" } as RequestActorResolution,
      authenticatedUserId: null,
      supabase,
    };
  }
  let pending = actorResolutionCache.get(req);
  if (!pending) {
    pending = resolveRouteActor(req);
    actorResolutionCache.set(req, pending);
  }
  const { actorResolution, authenticatedUserId, supabase } = await pending;
  return { actor: actorResolution.actor, actorResolution, authenticatedUserId, supabase };
}

async function resolveRouteActor(req: NextRequest) {
  const trace = requestPerformanceTrace(req);
  const supabase = await createRouteSupabase(req);
  const presentedCredential = Boolean(
    req.headers.get("authorization")?.trim() || req.headers.get("cookie")?.trim()
  );
  const { data: { user }, error } = trace
    ? await trace.measure("auth", "auth.get_user", () => supabase.auth.getUser())
    : await supabase.auth.getUser();
  if (error || !user) {
    return {
      actorResolution: {
        actor: null,
        status: presentedCredential ? "invalid" : "unauthenticated",
      } as RequestActorResolution,
      authenticatedUserId: null,
      supabase,
    };
  }
  try {
    const admin = createAdminClient();
    const profileQuery = () => admin
      .from("profiles")
      .select("username, first_name, last_name, account_status, deletion_started_at")
      .eq("id", user.id)
      .maybeSingle<{
        account_status: string | null;
        deletion_started_at: string | null;
        first_name: string | null;
        last_name: string | null;
        username: string | null;
      }>();
    const { data: profile, error: profileError } = trace
      ? await trace.database("actor.profile_status", profileQuery)
      : await profileQuery();
    if (profileError) {
      return {
        actorResolution: { actor: null, status: "unavailable" } as RequestActorResolution,
        authenticatedUserId: user.id,
        supabase,
      };
    }
    if (!profile) {
      return {
        actorResolution: { actor: null, status: "missing_profile" } as RequestActorResolution,
        authenticatedUserId: user.id,
        supabase,
      };
    }
    if (profile.account_status !== "active" || profile.deletion_started_at) {
      return {
        actorResolution: { actor: null, status: "frozen" } as RequestActorResolution,
        authenticatedUserId: user.id,
        supabase,
      };
    }
    const completenessQuery = () => admin.rpc("is_profile_complete", { p_user_id: user.id });
    const { data: profileComplete, error: completenessError } = trace
      ? await trace.database("actor.is_profile_complete", completenessQuery)
      : await completenessQuery();
    if (completenessError) {
      return {
        actorResolution: { actor: null, status: "unavailable" } as RequestActorResolution,
        authenticatedUserId: user.id,
        supabase,
      };
    }
    if (profileComplete !== true) {
      return {
        actorResolution: { actor: null, status: "incomplete_profile" } as RequestActorResolution,
        authenticatedUserId: user.id,
        supabase,
      };
    }
    const actorName = profile.username!.trim().toLowerCase();
    const displayName = [profile.first_name, profile.last_name]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ") || actorName;
    const actor: RequestActor = { actorName, displayName, userId: user.id };
    return {
      actorResolution: { actor, status: "active" } as RequestActorResolution,
      authenticatedUserId: user.id,
      supabase,
    };
  } catch {
    return {
      actorResolution: { actor: null, status: "unavailable" } as RequestActorResolution,
      authenticatedUserId: user.id,
      supabase,
    };
  }
}
