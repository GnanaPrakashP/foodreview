import { NextRequest, NextResponse } from "next/server";
import { convertOpenDishCandidates, runMajorityRenameSweep } from "@/lib/server/dish-self-curation";
import { createAdminClient } from "@/lib/supabase/admin";
import { configuredInternalSecret, internalRequestSecret, readBoundedJson, timingSafeSecretMatch } from "@/lib/server/api-security";

export const runtime = "nodejs";
export const maxDuration = 300;

// Operational endpoint only — the dish identity loop is fully self-curating.
// Actions here are maintenance jobs, not approval decisions.

function authorized(req: NextRequest) {
  return timingSafeSecretMatch(
    internalRequestSecret(req, "x-dish-curation-secret"),
    configuredInternalSecret("DISH_CURATION_SECRET")
  );
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = await readBoundedJson<Record<string, unknown>>(req, 16 * 1024);
  if (!parsed.ok) return NextResponse.json({ error: "Invalid request" }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const body = parsed.value;
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
