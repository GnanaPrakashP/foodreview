/**
 * Renders the food doodle wallpaper to an HTML page for visual review.
 * Run: node mobile/scripts/foodWallpaperPreview.ts (or sucrase-node)
 * Then screenshot with headless Chrome.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FOOD_WALLPAPER_LINE_COLOR,
  FOOD_WALLPAPER_OPACITY,
  FOOD_WALLPAPER_TILE_SIZE,
  buildFoodWallpaperPlacements,
  type DoodlePrimitive
} from "../src/components/memories/foodWallpaperPattern.ts";

const BG = "#0E0B08";

function primitiveToSvg(prim: DoodlePrimitive): string {
  switch (prim.type) {
    case "path":
      return `<path d="${prim.d}"/>`;
    case "circle":
      return `<circle cx="${prim.cx}" cy="${prim.cy}" r="${prim.r}"/>`;
    case "ellipse":
      return `<ellipse cx="${prim.cx}" cy="${prim.cy}" rx="${prim.rx}" ry="${prim.ry}"/>`;
    case "line":
      return `<line x1="${prim.x1}" y1="${prim.y1}" x2="${prim.x2}" y2="${prim.y2}"/>`;
  }
}

const tile = FOOD_WALLPAPER_TILE_SIZE;
const placements = buildFoodWallpaperPlacements();
const patternBody = placements
  .map(
    (pl) =>
      `<g stroke-width="${pl.strokeWidth}" transform="${pl.transform}">${pl.shape.primitives.map(primitiveToSvg).join("")}</g>`
  )
  .join("\n      ");

function wallpaperSvg(width: number, height: number, id: string): string {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="${id}" patternUnits="userSpaceOnUse" width="${tile}" height="${tile}">
      <rect width="${tile}" height="${tile}" fill="${BG}"/>
      <g fill="none" opacity="${FOOD_WALLPAPER_OPACITY}" stroke="${FOOD_WALLPAPER_LINE_COLOR}" stroke-linecap="round" stroke-linejoin="round">
      ${patternBody}
      </g>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="${BG}"/>
  <rect width="100%" height="100%" fill="url(#${id})"/>
</svg>`;
}

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  body { margin: 0; background: #000; font-family: -apple-system, sans-serif; display: flex; gap: 24px; padding: 20px; }
  .phone { position: relative; width: 390px; height: 844px; overflow: hidden; border-radius: 24px; outline: 1px solid #333; flex: none; }
  .phone svg { position: absolute; inset: 0; }
  .header { position: absolute; top: 0; left: 0; right: 0; height: 92px; background: #1A1410; border-bottom: 1px solid rgba(245,237,216,0.08); display: flex; align-items: flex-end; padding: 0 16px 12px; color: #F5EDD8; font-weight: 600; }
  .bubbles { position: absolute; inset: 92px 0 70px; display: flex; flex-direction: column; justify-content: flex-end; gap: 8px; padding: 16px; }
  .bubble { max-width: 70%; padding: 10px 14px; border-radius: 16px; color: #EDE6D6; font-size: 14px; line-height: 1.35; }
  .other { background: #211C17; align-self: flex-start; }
  .own { background: #143B36; align-self: flex-end; }
  .composer { position: absolute; bottom: 0; left: 0; right: 0; height: 70px; background: #1A1410; border-top: 1px solid rgba(245,237,216,0.08); display: flex; align-items: center; padding: 0 16px; }
  .input { flex: 1; height: 40px; border-radius: 20px; background: #211C17; border: 1px solid rgba(245,237,216,0.14); }
  .seams { width: ${tile * 2}px; height: ${tile * 2}px; outline: 1px solid #333; flex: none; }
  .label { color: #888; font-size: 12px; margin: 4px 0; }
</style>
</head>
<body>
  <div class="phone">
    ${wallpaperSvg(390, 844, "wp")}
    <div class="header">Friday Night Tacos 🌮</div>
    <div class="bubbles">
      <div class="bubble other">Who's in for tacos tonight?</div>
      <div class="bubble own">Count me in! 7pm works?</div>
      <div class="bubble other">The al pastor there is unreal</div>
      <div class="bubble own">Booking the table now 🙌</div>
    </div>
    <div class="composer"><div class="input"></div></div>
  </div>
  <div>
    <div class="label">2×2 tile repeat (seam check)</div>
    <div class="seams">${wallpaperSvg(tile * 2, tile * 2, "wp2")}</div>
  </div>
</body>
</html>`;

const outPath = join(import.meta.dirname ?? __dirname, "food-wallpaper-preview.html");
writeFileSync(outPath, html);

const seamHtml = `<!doctype html><html><head><meta charset="utf-8"/><style>body{margin:0;background:#000;}</style></head><body>${wallpaperSvg(tile * 2, tile * 2, "wp3")}</body></html>`;
const seamPath = join(import.meta.dirname ?? __dirname, "food-wallpaper-seam.html");
writeFileSync(seamPath, seamHtml);
console.log(`wrote ${outPath} (${placements.length} doodle placements per tile)`);
