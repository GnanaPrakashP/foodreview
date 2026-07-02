import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(
  process.cwd(),
  "node_modules",
  "react-native-collapsible-tab-view"
);

if (!existsSync(packageRoot)) {
  console.warn("[patch-collapsible-tab-view-sync] package not installed; skipping.");
  process.exit(0);
}

const files = [
  "src/Container.tsx",
  "lib/module/Container.js",
  "lib/commonjs/Container.js"
];

const replacements = [
  {
    from: "timeSinceFirstFrame > 1500",
    to: "timeSinceFirstFrame > 96"
  },
  {
    from: "for about 1500ms",
    to: "for about 100ms"
  }
];

for (const relativePath of files) {
  const filePath = join(packageRoot, relativePath);
  let source = readFileSync(filePath, "utf8");
  let changed = false;

  for (const { from, to } of replacements) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) {
      throw new Error(
        `[patch-collapsible-tab-view-sync] Expected "${from}" in ${relativePath}.`
      );
    }
    source = source.replace(from, to);
    changed = true;
  }

  if (changed) writeFileSync(filePath, source);
}

console.log("[patch-collapsible-tab-view-sync] shortened tab sync window.");
