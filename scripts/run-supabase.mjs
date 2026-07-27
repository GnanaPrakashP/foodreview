#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const expectedVersion = "2.109.1";

function probe(command, prefix = []) {
  return spawnSync(command, [...prefix, "--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

let command = "supabase";
let prefix = [];
let version = probe(command);
if (
  version.error?.code === "ENOENT" ||
  version.status !== 0 ||
  version.stdout.trim() !== expectedVersion
) {
  command = "npx";
  // `npx --no-install` can block while resolving an already-cached binary on
  // some npm releases. The version check below remains the source of truth,
  // so allowing normal npx resolution cannot silently select another CLI.
  // Pin the npx fallback too. An unpinned `npx supabase` can resolve a newer
  // cached/latest CLI and fail the version gate even though this repository
  // already declares the exact version it needs.
  prefix = [`supabase@${expectedVersion}`];
  version = probe(command, prefix);
}

if (version.status !== 0 || version.stdout.trim() !== expectedVersion) {
  console.error(`supabase-cli-version-mismatch: expected ${expectedVersion}`);
  process.exit(1);
}

const result = spawnSync(command, [...prefix, ...process.argv.slice(2)], {
  stdio: "inherit"
});
if (result.error) {
  console.error("supabase-cli-execution-failed");
  process.exit(1);
}
process.exit(result.status ?? 1);
