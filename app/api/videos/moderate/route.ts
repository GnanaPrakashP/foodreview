import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRouteActor } from "@/lib/server/route-supabase";

// Video Intelligence API is async — allow up to 60 s for polling to complete.
export const maxDuration = 60;

const BUCKET = "review-photos";

// Google's inline-content limit for the Video Intelligence API.
const MAX_INLINE_BYTES = 20 * 1024 * 1024; // 20 MB

type Likelihood =
  | "LIKELIHOOD_UNSPECIFIED"
  | "VERY_UNLIKELY"
  | "UNLIKELY"
  | "POSSIBLE"
  | "LIKELY"
  | "VERY_LIKELY";

const UNSAFE: Set<Likelihood> = new Set(["LIKELY", "VERY_LIKELY"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runExplicitContentCheck(
  buffer: Buffer,
  apiKey: string,
): Promise<{ safe: boolean; reason?: string }> {
  // 1. Submit annotation job
  let annotateRes: Response;
  try {
    annotateRes = await fetch(
      `https://videointelligence.googleapis.com/v1/videos:annotate?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputContent: buffer.toString("base64"),
          features: ["EXPLICIT_CONTENT_DETECTION"],
        }),
      },
    );
  } catch {
    return { safe: false, reason: "moderation service unavailable" };
  }

  if (!annotateRes.ok) {
    console.error(
      "[videos/moderate] annotate error",
      annotateRes.status,
      await annotateRes.text().catch(() => ""),
    );
    return { safe: false, reason: "moderation service unavailable" };
  }

  const { name: operationName } = (await annotateRes.json()) as {
    name?: string;
  };
  if (!operationName) {
    return { safe: false, reason: "moderation service unavailable" };
  }

  // 2. Poll the long-running operation until done (max ~55 s, backoff 3→10 s)
  const deadline = Date.now() + 55_000;
  let delay = 3_000;

  while (Date.now() < deadline) {
    await sleep(delay);
    delay = Math.min(delay + 2_000, 10_000);

    let pollRes: Response;
    try {
      pollRes = await fetch(
        `https://videointelligence.googleapis.com/v1/${operationName}?key=${apiKey}`,
      );
    } catch {
      return { safe: false, reason: "moderation service unavailable" };
    }

    if (!pollRes.ok) {
      return { safe: false, reason: "moderation service unavailable" };
    }

    const op = (await pollRes.json()) as {
      done?: boolean;
      error?: unknown;
      response?: {
        annotationResults?: [
          {
            explicitAnnotation?: {
              frames?: Array<{ pornographyLikelihood: Likelihood }>;
            };
          },
        ];
      };
    };

    if (!op.done) continue;

    if (op.error) {
      console.error("[videos/moderate] operation failed", op.error);
      return { safe: false, reason: "moderation check failed" };
    }

    const frames =
      op.response?.annotationResults?.[0]?.explicitAnnotation?.frames ?? [];
    const unsafeFrame = frames.find((f) => UNSAFE.has(f.pornographyLikelihood));
    if (unsafeFrame) {
      return { safe: false, reason: "explicit content" };
    }

    return { safe: true };
  }

  console.error("[videos/moderate] operation timed out");
  return { safe: false, reason: "moderation check timed out" };
}

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor();
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    quarantinePath?: unknown;
  };
  const quarantinePath = body.quarantinePath;

  if (
    typeof quarantinePath !== "string" ||
    !quarantinePath.startsWith("quarantine/")
  ) {
    return NextResponse.json({ error: "Invalid video path" }, { status: 400 });
  }

  const admin = createAdminClient();

  // 1. Download from quarantine (service-role bypasses RLS)
  const { data: blob, error: downloadErr } = await admin.storage
    .from(BUCKET)
    .download(quarantinePath);
  if (downloadErr || !blob) {
    return NextResponse.json(
      { error: "Could not retrieve video" },
      { status: 500 },
    );
  }

  const buffer = Buffer.from(await blob.arrayBuffer());

  if (buffer.byteLength > MAX_INLINE_BYTES) {
    await admin.storage.from(BUCKET).remove([quarantinePath]).catch(() => {});
    return NextResponse.json(
      { error: "Video is too large for content check (max 20 MB)" },
      { status: 422 },
    );
  }

  // 2. Run explicit-content check via Google Video Intelligence API
  const apiKey =
    process.env.GOOGLE_VIDEO_INTELLIGENCE_API_KEY ??
    process.env.GOOGLE_VISION_API_KEY;

  if (!apiKey) {
    // No key configured — skip moderation (same pattern as photos/moderate)
    console.warn(
      "[videos/moderate] GOOGLE_VIDEO_INTELLIGENCE_API_KEY not set — skipping moderation",
    );
  } else {
    const safety = await runExplicitContentCheck(buffer, apiKey);
    if (!safety.safe) {
      await admin.storage.from(BUCKET).remove([quarantinePath]).catch(() => {});
      return NextResponse.json(
        {
          error: `Video was rejected: ${safety.reason ?? "content policy violation"}`,
        },
        { status: 422 },
      );
    }
  }

  // 3. Move from quarantine to public prefix (atomic rename, no re-upload)
  const ext = quarantinePath.split(".").pop() ?? "mp4";
  const publicPath = `public/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  const { error: moveErr } = await admin.storage
    .from(BUCKET)
    .move(quarantinePath, publicPath);

  if (moveErr) {
    await admin.storage.from(BUCKET).remove([quarantinePath]).catch(() => {});
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(publicPath);

  return NextResponse.json({
    publicUrl: urlData.publicUrl,
    storagePath: publicPath,
    sizeBytes: buffer.byteLength,
  });
}
