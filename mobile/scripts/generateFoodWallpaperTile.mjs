import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  FOOD_WALLPAPER_TILE_SIZE,
  buildFoodWallpaperPlacements
} from "../src/components/memories/foodWallpaperPattern.ts";

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
const body = placements.map((placement) => (
  `<g stroke-width="${placement.strokeWidth}" transform="${placement.transform}">` +
  placement.shape.primitives.map(primitiveSvg).join("") +
  "</g>"
)).join("");
const svg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${FOOD_WALLPAPER_TILE_SIZE}" height="${FOOD_WALLPAPER_TILE_SIZE}" viewBox="0 0 ${FOOD_WALLPAPER_TILE_SIZE} ${FOOD_WALLPAPER_TILE_SIZE}">` +
  `<g fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round">${body}</g>` +
  "</svg>"
);
const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(mobileRoot, "assets/memories/food-wallpaper-tile.png");

mkdirSync(dirname(output), { recursive: true });
for (const scale of [1, 2, 3]) {
  const suffix = scale === 1 ? "" : `@${scale}x`;
  const scaledOutput = resolve(mobileRoot, `assets/memories/food-wallpaper-tile${suffix}.png`);
  await sharp(svg)
    .resize(FOOD_WALLPAPER_TILE_SIZE * scale, FOOD_WALLPAPER_TILE_SIZE * scale)
    .png({ compressionLevel: 9, palette: true })
    .toFile(scaledOutput);
}
