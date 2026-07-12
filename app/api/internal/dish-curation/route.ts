import { NextRequest, NextResponse } from "next/server";
import { convertOpenDishCandidates, runMajorityRenameSweep } from "@/lib/server/dish-self-curation";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

// Operational endpoint only — the dish identity loop is fully self-curating.
// Actions here are maintenance jobs, not approval decisions.

function configuredSecret() {
  return process.env.DISH_CURATION_SECRET ?? "";
}

function requestSecret(req: NextRequest) {
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return req.headers.get("x-dish-curation-secret")?.trim() ?? "";
}

function authorized(req: NextRequest) {
  const secret = configuredSecret();
  return Boolean(secret) && requestSecret(req) === secret;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const admin = createAdminClient();

  try {
    if (action === "self-curate") {
      const summary = await convertOpenDishCandidates(admin, {
        dryRun: body?.dryRun !== false,
        limit: boundedNumber(body?.limit, 500, 1, 2000)
      });
      return NextResponse.json({ ok: true, summary });
    }

    if (action === "rename-sweep") {
      const summary = await runMajorityRenameSweep(admin);
      return NextResponse.json({ ok: true, summary });
    }

    if (action === "rebuild-stats") {
      const { data, error } = await admin.rpc("rebuild_dish_identity_stats");
      if (error) {
        console.error("[dish-curation] stats rebuild failed:", error.message);
        return NextResponse.json({ error: "Stats rebuild failed" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, stats: data });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[dish-curation] action failed:", error);
    return NextResponse.json({ error: "Dish curation action failed" }, { status: 500 });
  }
}
