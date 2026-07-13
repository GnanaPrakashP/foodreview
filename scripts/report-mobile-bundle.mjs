#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const allowMissing = args.includes("--allow-missing");
const valueFor = (name, fallback) => {
  const exact = args.find((arg) => arg.startsWith(`${name}=`));
  return exact ? exact.slice(name.length + 1) : fallback;
};
const exportDir = resolve(root, valueFor("--export-dir", "mobile/dist-mobile-performance"));
const apkPath = resolve(root, valueFor("--apk", "mobile/android/app/build/outputs/apk/release/app-release.apk"));
const budgets = JSON.parse(readFileSync(resolve(root, "config/mobile-performance-budgets.json"), "utf8"));

async function walk(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (entry.isFile()) result.push({ bytes: statSync(path).size, path });
  }
  return result;
}

const files = await walk(exportDir);
const assetExtensions = new Map();
for (const platform of ["android", "ios"]) {
  const metadataPath = resolve(exportDir, platform, "metadata.json");
  if (!existsSync(metadataPath)) continue;
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  for (const entry of metadata.fileMetadata?.[platform]?.assets ?? []) {
    assetExtensions.set(`${platform}/${entry.path}`, `.${entry.ext}`);
  }
}
const normalized = files.map((file) => {
  const relativePath = relative(exportDir, file.path).replaceAll("\\", "/");
  return { ...file, effectiveExtension: assetExtensions.get(relativePath) ?? extname(file.path).toLowerCase(), relativePath };
});
// Source maps are retained release diagnostics and are uploaded to telemetry;
// they are not shipped as app assets. Keep their size visible without charging
// them against the distributable native-export/Hermes budgets.
const sourceMaps = normalized.filter((file) => file.effectiveExtension === ".map");
const distributable = normalized.filter((file) => !sourceMaps.includes(file));
const hermes = distributable.filter((file) => extname(file.path) === ".hbc" || /\/static\/js\/(android|ios)\//.test(`/${file.relativePath}`));
const fonts = distributable.filter((file) => [".otf", ".ttf", ".woff", ".woff2"].includes(file.effectiveExtension));
const assets = distributable.filter((file) => !hermes.includes(file));
const sum = (items) => items.reduce((total, item) => total + item.bytes, 0);
const largestByPlatform = Object.fromEntries(["android", "ios"].map((platform) => {
  const matches = hermes.filter((file) => file.relativePath.includes(`/${platform}/`) || file.relativePath.startsWith(`${platform}/`));
  return [platform, matches.reduce((largest, file) => Math.max(largest, file.bytes), 0)];
}));
const apkBytes = existsSync(apkPath) ? statSync(apkPath).size : null;
const exportTotalBytes = sum(distributable);
const platformTotals = Object.fromEntries(["android", "ios"].map((platform) => [platform, {
  exportBytes: sum(distributable.filter((file) => file.relativePath.startsWith(`${platform}/`))),
  fontBytes: sum(fonts.filter((file) => file.relativePath.startsWith(`${platform}/`)))
}]));
const failures = [];

if (files.length === 0 && !allowMissing) failures.push(`native export is missing: ${relative(root, exportDir)}`);
if (apkBytes == null && !allowMissing) failures.push(`release APK is missing: ${relative(root, apkPath)}`);
for (const [platform, bytes] of Object.entries(largestByPlatform)) {
  if (bytes > budgets.bundleBytes.hermesPerPlatform) failures.push(`${platform} Hermes bundle exceeds budget`);
  if (platformTotals[platform].exportBytes > budgets.bundleBytes.nativeExportTotal) failures.push(`${platform} native export exceeds budget`);
  if (platformTotals[platform].fontBytes > budgets.bundleBytes.fontAssetsTotal) failures.push(`${platform} font assets exceed budget`);
}
if (apkBytes != null && apkBytes > budgets.bundleBytes.androidReleaseApk) failures.push("Android release APK exceeds budget");

const report = {
  status: failures.length ? "FAIL" : files.length === 0 ? "MISSING" : "PASS",
  exportDirectory: relative(root, exportDir),
  apkPath: relative(root, apkPath),
  totals: {
    files: files.length,
    exportTotalBytes,
    sourceMapBytes: sum(sourceMaps),
    hermesBytes: sum(hermes),
    fontBytes: sum(fonts),
    otherAssetBytes: sum(assets),
    androidHermesBytes: largestByPlatform.android,
    iosHermesBytes: largestByPlatform.ios,
    perPlatform: platformTotals,
    apkBytes
  },
  baseline: budgets.phase5Baseline,
  budgets: budgets.bundleBytes,
  largestFiles: [...normalized].sort((a, b) => b.bytes - a.bytes).slice(0, 12),
  failures
};

if (jsonMode) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Mobile bundle report: ${report.status}`);
  console.log(`export=${report.totals.exportTotalBytes} android-hermes=${report.totals.androidHermesBytes} ios-hermes=${report.totals.iosHermesBytes} fonts=${report.totals.fontBytes} apk=${report.totals.apkBytes ?? "missing"}`);
  console.log(`Phase 5 APK baseline=${report.baseline.androidReleaseApkBytes}`);
  for (const failure of failures) console.error(`FAIL: ${failure}`);
}
if (failures.length) process.exitCode = 1;
