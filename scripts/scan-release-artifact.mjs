import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const paths = process.argv.slice(2).filter((value) => !value.startsWith("--"));
if (paths.length === 0) throw new Error("Provide one or more release artifact paths");

const forbidden = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sb_secret_|sntrys_)[A-Za-z0-9._-]{12,}/i,
  /SUPABASE_SERVICE_ROLE_KEY/i,
  /EXPO_PUBLIC_SUPABASE_SERVICE/i,
  /API_RATE_LIMIT_HMAC_SECRET/i,
  /MEDIA_WORKER_SECRET/i,
  /ACCOUNT_DELETION_WORKER_SECRET/i,
  /MODERATION_OPERATOR_SECRET/i,
  /CRON_SECRET/i,
  /DEV_AUTOLOGIN_(EMAIL|PASSWORD)/i,
  // Metro and URL-polyfill dependencies contain inert localhost examples. Block
  // the actual application/backend ports while app.config.js validates every
  // configured production URL as public HTTPS before a release can build.
  /https?:\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.\d{1,3}\.\d{1,3}):(?:3000|54321|55321)(?:[/'"]|$)/i
];

// Source maps deliberately contain original source text. The client source
// includes development-only branches and the names of variables that release
// validation rejects. Those names/branches are not embedded runtime values,
// and the compiled Hermes artifact is scanned separately. Keep source maps
// strict for privileged secret names and credential-looking values while
// avoiding false failures on the auditable development guards themselves.
const sourceMapAllowedSources = new Set([
  /DEV_AUTOLOGIN_(EMAIL|PASSWORD)/i.source,
  /https?:\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.\d{1,3}\.\d{1,3}):(?:3000|54321|55321)(?:[/'"]|$)/i.source
]);

async function filesUnder(path) {
  const info = await stat(path);
  if (info.isFile()) return [path];
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    files.push(...await filesUnder(join(path, entry.name)));
  }
  return files;
}

for (const input of paths) {
  const artifact = resolve(input);
  const bytes = await readFile(artifact);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const extraction = await mkdtemp(join(tmpdir(), "circlebites-release-scan-"));
  try {
    const unzip = spawnSync("unzip", ["-qq", artifact, "-d", extraction], { encoding: "utf8" });
    const scanFiles = unzip.status === 0 ? await filesUnder(extraction) : [artifact];
    const matches = new Set();
    for (const file of scanFiles) {
      const content = (await readFile(file)).toString("latin1");
      forbidden.forEach((pattern) => {
        if (artifact.endsWith(".map") && sourceMapAllowedSources.has(pattern.source)) return;
        if (pattern.test(content)) matches.add(pattern.source);
      });
    }
    if (matches.size > 0) {
      throw new Error(`Forbidden release configuration pattern found in ${basename(artifact)}: ${[...matches].join(", ")}`);
    }
    console.log(JSON.stringify({ artifact: basename(artifact), bytes: bytes.length, sha256, status: "passed" }));
  } finally {
    await rm(extraction, { force: true, recursive: true });
  }
}
