import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRouteActor } from "@/lib/server/route-supabase";

const BUCKET = "review-photos";
const MAX_PHOTOS = 4;

type ModeratedPhoto = {
  publicUrl: string;
  storagePath: string;
  width: number;
  height: number;
  sizeBytes: number;
};

type SafeSearchLikelihood = "UNKNOWN" | "VERY_UNLIKELY" | "UNLIKELY" | "POSSIBLE" | "LIKELY" | "VERY_LIKELY";

const UNSAFE: Set<SafeSearchLikelihood> = new Set(["LIKELY", "VERY_LIKELY"]);

async function runSafeSearch(buffer: Buffer): Promise<{ safe: boolean; reason?: string }> {
  const apiKey =
    process.env.GOOGLE_API_KEY ??
    process.env.GOOGLE_VISION_API_KEY ??
    process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    // No key configured — skip moderation (log so operators notice in prod)
    console.warn("[photos/moderate] GOOGLE_API_KEY not set — skipping SafeSearch");
    return { safe: true };
  }

  let res: Response;
  try {
    res = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{
            image: { content: buffer.toString("base64") },
            features: [{ type: "SAFE_SEARCH_DETECTION", maxResults: 1 }],
          }],
        }),
      }
    );
  } catch {
    // Network failure — fail-closed: block photo
    return { safe: false, reason: "moderation service unavailable" };
  }

  if (!res.ok) {
    console.error("[photos/moderate] Vision API error", res.status, await res.text().catch(() => ""));
    return { safe: false, reason: "moderation service unavailable" };
  }

  const data = await res.json() as {
    responses?: [{
      safeSearchAnnotation?: {
        adult: SafeSearchLikelihood;
        violence: SafeSearchLikelihood;
        racy: SafeSearchLikelihood;
      };
    }]
  };

  const ann = data.responses?.[0]?.safeSearchAnnotation;
  if (!ann) return { safe: true };

  if (UNSAFE.has(ann.adult))    return { safe: false, reason: "adult content" };
  if (UNSAFE.has(ann.violence)) return { safe: false, reason: "violent content" };

  return { safe: true };
}

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor();
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await req.json() as { quarantinePaths?: unknown };
  const quarantinePaths = body.quarantinePaths;

  if (!Array.isArray(quarantinePaths) || quarantinePaths.length === 0) {
    return NextResponse.json({ error: "No photos provided" }, { status: 400 });
  }
  if (quarantinePaths.length > MAX_PHOTOS) {
    return NextResponse.json({ error: `Maximum ${MAX_PHOTOS} photos allowed` }, { status: 400 });
  }
  if (!quarantinePaths.every((p) => typeof p === "string" && p.startsWith("quarantine/"))) {
    return NextResponse.json({ error: "Invalid photo paths" }, { status: 400 });
  }

  const admin = createAdminClient();
  const results: ModeratedPhoto[] = [];
  const processed: string[] = [];

  try {
    for (let i = 0; i < quarantinePaths.length; i++) {
      const qPath = quarantinePaths[i] as string;

      // 1. Download from quarantine (service role bypasses RLS)
      const { data: blob, error: downloadErr } = await admin.storage.from(BUCKET).download(qPath);
      if (downloadErr || !blob) {
        return NextResponse.json(
          { error: `Could not retrieve photo ${i + 1}` },
          { status: 500 }
        );
      }

      const rawBuffer = Buffer.from(await blob.arrayBuffer());

      // 2. Re-encode with Sharp — validates it is a real image and strips all metadata
      //    (prevents polyglot files and exif-embedded scripts)
      let cleanBuffer: Buffer;
      let width = 0;
      let height = 0;
      try {
        const meta = await sharp(rawBuffer).metadata();
        width = meta.width ?? 0;
        height = meta.height ?? 0;
        cleanBuffer = await sharp(rawBuffer)
          .rotate()               // honour EXIF orientation then strip it
          .jpeg({ quality: 85 })  // always output clean JPEG
          .toBuffer();
      } catch {
        await admin.storage.from(BUCKET).remove([qPath]).catch(() => {});
        return NextResponse.json(
          { error: `Photo ${i + 1} is not a valid image` },
          { status: 422 }
        );
      }

      // 3. Google Vision SafeSearch
      const safety = await runSafeSearch(cleanBuffer);
      if (!safety.safe) {
        await admin.storage.from(BUCKET).remove([qPath]).catch(() => {});
        return NextResponse.json(
          { error: `Photo ${i + 1} was rejected: ${safety.reason}` },
          { status: 422 }
        );
      }

      // 4. Upload re-encoded image to public prefix
      const publicPath = `public/${Date.now()}_${i}_${Math.random().toString(36).slice(2)}.jpg`;
      const { error: uploadErr } = await admin.storage
        .from(BUCKET)
        .upload(publicPath, cleanBuffer, { contentType: "image/jpeg", upsert: false });
      if (uploadErr) {
        return NextResponse.json({ error: "Upload failed" }, { status: 500 });
      }

      const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(publicPath);
      results.push({
        publicUrl: urlData.publicUrl,
        storagePath: publicPath,
        width,
        height,
        sizeBytes: cleanBuffer.byteLength,
      });
      processed.push(qPath);
    }

    // 5. Delete all quarantine originals after success
    await admin.storage.from(BUCKET).remove(quarantinePaths as string[]).catch(() => {});

    return NextResponse.json({ photos: results });
  } catch {
    // Cleanup any quarantine files we haven't cleaned up yet
    const remaining = (quarantinePaths as string[]).filter((p) => !processed.includes(p));
    if (remaining.length) {
      await admin.storage.from(BUCKET).remove(remaining).catch(() => {});
    }
    return NextResponse.json({ error: "Photo processing failed" }, { status: 500 });
  }
}
