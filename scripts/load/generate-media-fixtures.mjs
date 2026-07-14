#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { argument, invariant } from "./lib.mjs";

const output = resolve(argument("output", "load-results/fixtures"));
await mkdir(output, { recursive: true });

const imagePath = resolve(output, "synthetic.jpg");
const videoPath = resolve(output, "synthetic.mp4");
const overlay = Buffer.from(`
  <svg width="960" height="1200" xmlns="http://www.w3.org/2000/svg">
    <rect width="960" height="1200" fill="#1f2937"/>
    <circle cx="480" cy="500" r="290" fill="#f59e0b"/>
    <circle cx="380" cy="440" r="70" fill="#dc2626"/>
    <circle cx="590" cy="590" r="85" fill="#16a34a"/>
    <text x="480" y="990" text-anchor="middle" fill="#ffffff" font-size="64" font-family="sans-serif">SYNTHETIC LOAD FIXTURE</text>
  </svg>
`);
await sharp(overlay).jpeg({ quality: 82, progressive: true }).toFile(imagePath);

const ffmpeg = spawnSync("ffmpeg", [
  "-hide_banner", "-loglevel", "error",
  "-f", "lavfi", "-i", "color=c=blue:s=1280x720:d=1:r=12",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
  "-metadata", "comment=repository-generated-synthetic", "-an", "-y", videoPath
], { encoding: "utf8" });
invariant(!ffmpeg.error && ffmpeg.status === 0, `media_fixture_ffmpeg_failed:${ffmpeg.stderr?.trim() || ffmpeg.error?.message || ffmpeg.status}`);

const version = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).stdout.split("\n")[0].trim();
console.log(JSON.stringify({
  generator: { ffmpeg: version, image: `sharp-${sharp.versions.sharp}` },
  image: { height: 1200, license: "repository-generated-synthetic", path: imagePath, width: 960 },
  video: { durationMs: 1000, height: 720, license: "repository-generated-synthetic", path: videoPath, width: 1280 }
}, null, 2));
