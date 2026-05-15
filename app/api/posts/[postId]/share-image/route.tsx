import { ImageResponse } from "next/og";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import { REVIEW_SELECT } from "@/lib/selects";
import type { FoodItem, Review } from "@/lib/types";
import { isReviewSuppressed } from "@/lib/visibility";

export const runtime = "nodejs";

const C = {
  bg:        "#0E0B08",
  card:      "#211C17",
  surface:   "#1A1410",
  border:    "#2E2720",
  orange:    "#F06030",
  orangeDim: "rgba(240,96,48,0.12)",
  gold:      "#E8A830",
  cream:     "#F5EDD8",
  muted:     "#7A6E65",
  glass:     "rgba(36,31,26,0.72)",
  glassLine: "rgba(245,237,216,0.12)",
  glassGlow: "rgba(240,96,48,0.10)",
};

const GRADIENTS: [string, string][] = [
  ["#F06030", "#C04020"],
  ["#6366F1", "#4F46E5"],
  ["#3DD68C", "#22C55E"],
  ["#E8A830", "#D4821A"],
  ["#EC4899", "#BE185D"],
  ["#14B8A6", "#0F766E"],
];

const DEFAULT_SHARE_IMAGE_WIDTH = 560;
const MIN_SHARE_IMAGE_WIDTH = 320;
const MAX_SHARE_IMAGE_WIDTH = 720;
const SHARE_IMAGE_PADDING = 14;
const CARD_HORIZONTAL_PADDING = 40;
const FOOTER_HEIGHT = 48;

function clampShareImageWidth(width: number | null): number {
  if (!width || Number.isNaN(width)) return DEFAULT_SHARE_IMAGE_WIDTH;
  return Math.min(MAX_SHARE_IMAGE_WIDTH, Math.max(MIN_SHARE_IMAGE_WIDTH, Math.round(width)));
}

function avatarColors(name: string): [string, string] {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
  return GRADIENTS[h % GRADIENTS.length];
}

function avatarInitials(displayName: string): string {
  const parts = displayName.split(/[\s_]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] ?? displayName[0] ?? "?").toUpperCase();
}

function trunc(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function estimateTextLines(str: string | null, charsPerLine: number, maxLines: number): number {
  if (!str) return 0;
  return Math.max(1, Math.min(maxLines, Math.ceil(str.length / charsPerLine)));
}

function responsiveChars(baseChars: number, contentWidth: number, minChars: number): number {
  const defaultContentWidth = DEFAULT_SHARE_IMAGE_WIDTH - SHARE_IMAGE_PADDING * 2 - CARD_HORIZONTAL_PADDING;
  return Math.max(minChars, Math.round(baseChars * (contentWidth / defaultContentWidth)));
}

function estimateItemRows(items: FoodItem[], contentWidth: number): number {
  if (items.length === 0) return 0;

  let rows = 1;
  let rowWidth = 0;

  for (const item of items) {
    const ratingWidth = item.rating > 0 ? 42 : 0;
    const chipWidth = Math.min(220, 28 + trunc(item.name, 28).length * 7 + ratingWidth);
    const nextWidth = rowWidth === 0 ? chipWidth : rowWidth + 6 + chipWidth;

    if (nextWidth > contentWidth) {
      rows += 1;
      rowWidth = chipWidth;
    } else {
      rowWidth = nextWidth;
    }
  }

  return rows;
}

async function loadGoogleFont(family: string, weight: number): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`,
      { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" } },
    ).then((r) => r.text());
    const url = css.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/)?.[1];
    if (!url) return null;
    return fetch(url).then((r) => r.arrayBuffer());
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ postId: string }> },
) {
  const { postId } = await params;
  const requestedWidth = Number(new URL(request.url).searchParams.get("w"));
  const shareImageWidth = clampShareImageWidth(requestedWidth);
  const cardContentWidth = shareImageWidth - SHARE_IMAGE_PADDING * 2 - CARD_HORIZONTAL_PADDING;
  const db = createAdminClient();

  const [{ data: review }, syne700, dmSans400, dmSans700] = await Promise.all([
    db.from("reviews").select(REVIEW_SELECT).eq("id", postId).single<Review>(),
    loadGoogleFont("Syne", 700),
    loadGoogleFont("DM Sans", 400),
    loadGoogleFont("DM Sans", 700),
  ]);

  if (!review) return new Response("Not found", { status: 404 });
  if (isReviewSuppressed(review)) return new Response("Not found", { status: 404 });
  if (review.visibility !== "public") return new Response("Forbidden", { status: 403 });

  const { data: profile } = await db
    .from("profiles")
    .select("first_name, last_name")
    .eq("username", review.reviewer_name)
    .maybeSingle();
  const reviewerDisplayName =
    profile
      ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || review.reviewer_name
      : review.reviewer_name;

  const [gradFrom, gradTo] = avatarColors(review.reviewer_name);
  const initials = avatarInitials(reviewerDisplayName);
  const restaurantName = review.restaurant_name;
  const location = review.area || review.restaurant_address || null;
  const items = (review.items as FoodItem[]).slice(0, 6);
  const captionRaw = review.body ?? null;
  const caption = captionRaw
    ? captionRaw.length > 160 ? captionRaw.slice(0, 157) + "..." : captionRaw
    : null;
  const titleLines = estimateTextLines(trunc(restaurantName, 48), responsiveChars(36, cardContentWidth, 20), 2);
  const locationLines = estimateTextLines(location ? trunc(location, 72) : null, responsiveChars(58, cardContentWidth, 30), 2);
  const captionLines = estimateTextLines(caption, responsiveChars(64, cardContentWidth, 34), 3);
  const itemRows = estimateItemRows(items, cardContentWidth);
  const cardHeight =
    36 + // card vertical padding
    46 + // header and spacing
    titleLines * 25 +
    (location ? 5 + locationLines * 14 + 8 : 8) +
    (caption ? 14 + captionLines * 19 + 8 : 0) +
    (items.length > 0 ? itemRows * 22 + (itemRows - 1) * 5 + 8 : 0) +
    FOOTER_HEIGHT;
  const imageHeight = Math.ceil(cardHeight + SHARE_IMAGE_PADDING * 2 + 2);

  const dmSansFamily = dmSans400 ? "'DM Sans', sans-serif" : "sans-serif";
  const syneFamily   = syne700   ? "'Syne', sans-serif"   : "sans-serif";

  const fonts: { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }[] = [];
  if (syne700)   fonts.push({ name: "Syne",    data: syne700,   weight: 700, style: "normal" });
  if (dmSans400) fonts.push({ name: "DM Sans", data: dmSans400, weight: 400, style: "normal" });
  if (dmSans700) fonts.push({ name: "DM Sans", data: dmSans700, weight: 700, style: "normal" });

  const imageResponse = new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          width: `${shareImageWidth}px`,
          height: `${imageHeight}px`,
          background: `
            radial-gradient(circle at 18% 0%, rgba(240,96,48,0.18), transparent 34%),
            radial-gradient(circle at 90% 88%, rgba(232,168,48,0.10), transparent 30%),
            linear-gradient(160deg, #15100C 0%, ${C.bg} 48%, #080604 100%)
          `,
          padding: `${SHARE_IMAGE_PADDING}px`,
          fontFamily: dmSansFamily,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            backgroundColor: C.glass,
            backgroundImage: "linear-gradient(145deg, rgba(255,255,255,0.07), rgba(255,255,255,0.015) 34%, rgba(0,0,0,0.06))",
            backdropFilter: "blur(18px)",
            border: `1px solid ${C.glassLine}`,
            borderTop: "1px solid rgba(255,255,255,0.18)",
            borderRadius: "22px",
            overflow: "hidden",
            padding: "18px 20px",
            boxShadow: `
              0 18px 46px rgba(0,0,0,0.36),
              inset 0 1px 0 rgba(255,255,255,0.10),
              inset 0 -1px 0 rgba(0,0,0,0.22)
            `,
          }}
        >

          {/* Header: avatar + "Name shared a spot" */}
          <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "12px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "34px",
                height: "34px",
                borderRadius: "11px",
                background: `linear-gradient(135deg, ${gradFrom}, ${gradTo})`,
                fontSize: "12px",
                fontWeight: 700,
                color: "white",
                flexShrink: 0,
                fontFamily: dmSansFamily,
                boxShadow: "0 8px 18px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.18)",
              }}
            >
              {initials}
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: "14px", fontWeight: 700, color: C.cream, fontFamily: dmSansFamily }}>
                {trunc(reviewerDisplayName, 28)}
              </span>
              <span style={{ fontSize: "14px", fontWeight: 400, color: C.muted, marginLeft: "6px", fontFamily: dmSansFamily }}>
                shared a spot
              </span>
            </div>
          </div>

          {/* Restaurant name */}
          <div
            style={{
              fontSize: "21px",
              fontWeight: 700,
              color: C.cream,
              lineHeight: "1.15",
              marginBottom: location ? "5px" : "8px",
              fontFamily: syneFamily,
            }}
          >
            {trunc(restaurantName, 48)}
          </div>

          {/* Location */}
          {location && (
            <div style={{ display: "flex", fontSize: "12px", color: C.muted, marginBottom: "8px", fontFamily: dmSansFamily }}>
              {trunc(location, 72)}
            </div>
          )}

          {/* Body text — orange left-border box */}
          {caption && (
            <div
              style={{
                display: "flex",
                padding: "7px 9px",
                background: "rgba(240,96,48,0.13)",
                borderLeft: `3px solid ${C.orange}`,
                borderTop: "1px solid rgba(255,255,255,0.06)",
                borderRight: "1px solid rgba(240,96,48,0.12)",
                borderBottom: "1px solid rgba(240,96,48,0.10)",
                borderRadius: "0 8px 8px 0",
                marginBottom: "8px",
              }}
            >
              <div style={{ fontSize: "13px", color: C.cream, lineHeight: 1.45, fontFamily: dmSansFamily }}>
                {caption}
              </div>
            </div>
          )}

          {/* Items */}
          {items.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "8px" }}>
              {items.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "rgba(26,20,16,0.62)",
                    border: "1px solid rgba(245,237,216,0.09)",
                    borderRadius: "7px",
                    padding: "3px 7px",
                    fontSize: "11px",
                    color: C.cream,
                    fontFamily: dmSansFamily,
                  }}
                >
                  {trunc(item.name, 28)}
                  {item.rating > 0 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        background: "rgba(232,168,48,0.15)",
                        border: "1px solid rgba(232,168,48,0.25)",
                        borderRadius: "5px",
                        padding: "1px 5px",
                        fontSize: "10px",
                        color: C.gold,
                        fontWeight: 700,
                        fontFamily: dmSansFamily,
                      }}
                    >
                      {item.rating}/5
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              paddingTop: "10px",
              borderTop: "1px solid rgba(245,237,216,0.10)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.2 }}>
              <div style={{ display: "flex", fontSize: "12px", fontWeight: 700, color: C.cream, fontFamily: dmSansFamily }}>
                Real food reviews from people you trust
              </div>
              <div style={{ display: "flex", fontSize: "11px", color: "#B8AFA3", marginTop: "4px", fontFamily: dmSansFamily }}>
                Discover the best bites near you on CircleBites
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                height: "26px",
                padding: "0 9px",
                background: "rgba(240,96,48,0.13)",
                border: "1px solid rgba(240,96,48,0.26)",
                borderRadius: "999px",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10)",
                fontSize: "12px",
                fontWeight: 700,
                color: C.orange,
                fontFamily: syneFamily,
                flexShrink: 0,
              }}
            >
              circlebites.in
            </div>
          </div>

        </div>
      </div>
    ),
    { width: shareImageWidth, height: imageHeight, fonts },
  );

  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const sharpenedImage = await sharp(imageBuffer)
    .sharpen({ sigma: 0.35 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  return new Response(new Uint8Array(sharpenedImage), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}
