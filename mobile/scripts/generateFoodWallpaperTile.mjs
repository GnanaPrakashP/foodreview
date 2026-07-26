import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  FOOD_WALLPAPER_LINE_COLOR,
  FOOD_WALLPAPER_TILE_SIZE,
  buildFoodWallpaperPlacements
} from "../src/components/memories/foodWallpaperPattern.ts";

/**
 * The room ships `food-wallpaper-tile-baked.png`: the theme line colour and its
 * opacity are painted straight into the pixels so the runtime needs no tintColor
 * shader (see FoodChatWallpaper in app/memories/[id].tsx).
 *
 * Must stay in step with FOOD_WALLPAPER_OPACITY and tokens.wallpaperOpacity —
 * nothing enforces that, and they silently disagreed for a while: the tile was
 * baked at full opacity while both constants claimed 0.2, so the app rendered a
 * wallpaper roughly five times brighter than every preview showed.
 *
 * The ceiling here is set by the surfaces on top, not by taste. At full opacity
 * the strokes are ~7x the luminance of the received bubble they sit behind, which
 * reads as the wallpaper floating above the bubbles.
 */
const BAKED_LINE_OPACITY = 0.22;

/**
 * Device pixel ratios to emit. RN picks the bucket matching the screen.
 *
 * Deliberately stops at @2x. `resizeMode="repeat"` keeps the whole tile decoded,
 * and at a 728dp tile an @3x variant is 2184x2184 — 18.1MB resident, against
 * 8.0MB for @2x. Three-times screens upscale the @2x tile by 1.5x instead, which
 * softens the hairlines a little where pixels are smallest. Add 3 back here if
 * that ever looks wrong on a device, and re-check the memory cost.
 */
const SCALES = [1, 2];

function primitiveSvg(primitive) {
  switch (primitive.type) {
    case "path":
      return `<path d="${primitive.d}"/>`;
    case "circle":
      return `<circle cx="${primitive.cx}" cy="${primitive.cy}" r="${primitive.r}"/>`;
    case "ellipse":
      return `<ellipse cx="${primitive.cx}" cy="${primitive.cy}" rx="${primitive.rx}" ry="${primitive.ry}"/>`;
    case "line":
      return `<line x1="${primitive.x1}" x2="${primitive.x2}" y1="${primitive.y1}" y2="${primitive.y2}"/>`;
    default:
      return "";
  }
}

const placements = buildFoodWallpaperPlacements();
const body = placements
  .map(
    (placement) =>
      `<g stroke-width="${placement.strokeWidth}" transform="${placement.transform}">` +
      placement.primitives.map(primitiveSvg).join("") +
      "</g>"
  )
  .join("");

const tileSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${FOOD_WALLPAPER_TILE_SIZE}" height="${FOOD_WALLPAPER_TILE_SIZE}" viewBox="0 0 ${FOOD_WALLPAPER_TILE_SIZE} ${FOOD_WALLPAPER_TILE_SIZE}">` +
    `<g fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round">${body}</g>` +
    "</svg>"
);

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetDir = resolve(mobileRoot, "assets/memories");
mkdirSync(assetDir, { recursive: true });

const hex = (color) => [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));

/**
 * Every doodle is one flat colour, so the stroke coverage lives entirely in the
 * alpha channel: rasterise once, then repaint RGB to the target colour. Holding
 * RGB constant keeps the 256-entry palette lossless (one hue x 256 alphas) —
 * letting the quantiser see antialiased colour instead shifts hue on edge pixels.
 *
 * sharp rasterises SVG input at the resize target rather than resampling the
 * natural-size bitmap, so every scale is a true vector render.
 */
async function emit(baseName, color, opacity) {
  const [r, g, b] = hex(color);
  for (const scale of SCALES) {
    const suffix = scale === 1 ? "" : `@${scale}x`;
    const output = resolve(assetDir, `${baseName}${suffix}.png`);
    const px = FOOD_WALLPAPER_TILE_SIZE * scale;
    const mask = await sharp(tileSvg).resize(px, px).ensureAlpha().raw().toBuffer();
    const pixels = Buffer.allocUnsafe(px * px * 4);
    for (let i = 0; i < px * px; i += 1) {
      pixels[i * 4] = r;
      pixels[i * 4 + 1] = g;
      pixels[i * 4 + 2] = b;
      pixels[i * 4 + 3] = Math.round(mask[i * 4 + 3] * opacity);
    }
    await sharp(pixels, { raw: { width: px, height: px, channels: 4 } })
      .png({ compressionLevel: 9, palette: true })
      .toFile(output);
    console.log(`  ${baseName}${suffix}.png  ${px}x${px}`);
  }
}

console.log(`${placements.length} doodle placements per ${FOOD_WALLPAPER_TILE_SIZE}dp tile`);

// Shipped asset: theme line colour baked in. Untinted white masters used to be
// emitted alongside these; nothing referenced them, so they were dropped. Add a
// second emit() with "#ffffff" if a runtime-tinted or per-theme tile is needed.
console.log("baked (shipped):");
await emit("food-wallpaper-tile-baked", FOOD_WALLPAPER_LINE_COLOR, BAKED_LINE_OPACITY);
