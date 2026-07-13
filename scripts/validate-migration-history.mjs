import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const canonicalRoot = "supabase/migrations";
const deprecatedRoot = "mobile/supabase/migrations";
const archiveRoot = "docs/database/legacy-mobile-migrations";
const manifestPath = path.join(repositoryRoot, "docs/database/migration-history-manifest.json");
const migrationPattern = /^(\d{12})_([a-z0-9_]+)\.sql$/;

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function sqlFiles(relativeRoot) {
  const absoluteRoot = path.join(repositoryRoot, relativeRoot);
  if (!existsSync(absoluteRoot)) return [];
  return readdirSync(absoluteRoot)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => {
      const match = file.match(migrationPattern);
      const absolutePath = path.join(absoluteRoot, file);
      const sql = readFileSync(absolutePath, "utf8");
      return {
        description: match?.[2] ?? null,
        filename: file,
        hash: sha256(absolutePath),
        size: statSync(absolutePath).size,
        sql,
        version: match?.[1] ?? null
      };
    });
}

function categories(sql) {
  const rules = [
    ["account-deletion", /account_deletion|delete_current_account|account_status/i],
    ["auth", /auth\.users|auth\.uid|auth\.role/i],
    ["constraints", /constraint|foreign key|unique\s*\(/i],
    ["dish-identity", /canonical_dish|dish_alias|dish_candidate|dish_mention/i],
    ["explore", /explore|place_search|hungry/i],
    ["functions", /create(?: or replace)? function|create procedure/i],
    ["indexes", /create(?: unique)? index/i],
    ["memory", /shared_memory/i],
    ["media-pipeline", /media_asset|media_processing_job|media_derivative|media_upload_intent/i],
    ["notifications", /notification|push_token/i],
    ["profiles", /public\.profiles|profile_search|username/i],
    ["rls", /row level security|create policy/i],
    ["social", /review|circle|block|comment|like|wishlist|post_view|taste_trust/i],
    ["storage", /storage\.buckets|storage\.objects/i],
    ["triggers", /create trigger/i]
  ];
  const found = rules.filter(([, pattern]) => pattern.test(sql)).map(([name]) => name);
  return found.length > 0 ? found : ["schema"];
}

function dependencyHints(sql) {
  const names = new Set();
  for (const match of sql.matchAll(/(?:public|storage|auth)\.([a-z][a-z0-9_]*)/gi)) {
    names.add(match[1].toLowerCase());
    if (names.size >= 16) break;
  }
  return [...names].sort();
}

function captureLegacy() {
  const root = sqlFiles(canonicalRoot);
  const mobile = sqlFiles(deprecatedRoot);
  if (root.length === 0 || mobile.length === 0) {
    throw new Error("legacy_capture_requires_both_active_roots");
  }
  const rootByVersion = new Map(root.map((entry) => [entry.version, entry]));
  const mobileByVersion = new Map(mobile.map((entry) => [entry.version, entry]));
  const versions = [...new Set([...rootByVersion.keys(), ...mobileByVersion.keys()])].sort();
  const entries = [];
  const conflicts = [];
  let identical = 0;
  let rootOnly = 0;
  let mobileOnly = 0;

  for (const version of versions) {
    const rootEntry = rootByVersion.get(version);
    const mobileEntry = mobileByVersion.get(version);
    let duplicateStatus;
    if (rootEntry && mobileEntry) {
      duplicateStatus = rootEntry.hash === mobileEntry.hash ? "identical" : "conflicting";
      if (duplicateStatus === "identical") identical += 1;
      else conflicts.push({
        canonicalHash: rootEntry.hash,
        legacyMobileHash: mobileEntry.hash,
        resolution: "canonical_root_selected_executable_sql_equivalent_mobile_variant_archived",
        version
      });
    } else if (rootEntry) {
      duplicateStatus = "root-only";
      rootOnly += 1;
    } else {
      duplicateStatus = "mobile-only";
      mobileOnly += 1;
    }

    for (const [sourceRoot, entry] of [[canonicalRoot, rootEntry], [deprecatedRoot, mobileEntry]]) {
      if (!entry) continue;
      entries.push({
        canonicalDisposition: sourceRoot === canonicalRoot
          ? "canonical"
          : duplicateStatus === "mobile-only"
            ? "promote-to-canonical"
            : duplicateStatus === "conflicting"
              ? "archive-conflicting-variant"
              : "retire-identical-copy",
        dependencyHints: dependencyHints(entry.sql),
        description: entry.description,
        duplicateStatus,
        filename: entry.filename,
        objectCategories: categories(entry.sql),
        sha256: entry.hash,
        sizeBytes: entry.size,
        sourceRoot,
        version
      });
    }
  }

  return {
    canonicalRoot,
    conflicts,
    deprecatedRoot,
    generatedOn: "2026-07-13",
    schemaVersion: 1,
    totals: {
      conflictingVersions: conflicts.length,
      identicalVersions: identical,
      mobileMigrations: mobile.length,
      mobileOnlyVersions: mobileOnly,
      rootMigrations: root.length,
      rootOnlyVersions: rootOnly
    },
    entries
  };
}

function fail(message) {
  console.error(`migration-history: ${message}`);
  process.exitCode = 1;
}

function validate() {
  if (!existsSync(manifestPath)) throw new Error("migration_manifest_missing");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const canonical = sqlFiles(canonicalRoot);
  const activeVersions = new Set();
  for (const migration of canonical) {
    if (!migration.version) fail(`malformed canonical filename ${migration.filename}`);
    if (activeVersions.has(migration.version)) fail(`duplicate canonical version ${migration.version}`);
    activeVersions.add(migration.version);
    const historical = manifest.entries.filter((entry) => entry.version === migration.version);
    const expected = historical.find((entry) => entry.sourceRoot === canonicalRoot)
      ?? historical.find((entry) => entry.canonicalDisposition === "promote-to-canonical");
    if (!expected) fail(`manifest missing canonical migration ${migration.filename}`);
    else if (expected.sha256 !== migration.hash) fail(`canonical hash drift ${migration.filename}`);
  }

  const expectedCanonicalVersions = new Set(manifest.entries
    .filter((entry) => entry.sourceRoot === canonicalRoot || entry.canonicalDisposition === "promote-to-canonical")
    .map((entry) => entry.version));
  for (const version of expectedCanonicalVersions) {
    if (!activeVersions.has(version)) fail(`canonical migration missing for historical version ${version}`);
  }

  if (existsSync(path.join(repositoryRoot, deprecatedRoot))) {
    const executable = sqlFiles(deprecatedRoot);
    if (executable.length > 0) fail("deprecated mobile migration root contains executable SQL");
  }
  if (existsSync(path.join(repositoryRoot, "mobile/supabase/config.toml"))) {
    fail("deprecated mobile Supabase project config still exists");
  }

  for (const conflict of manifest.conflicts) {
    const canonicalEntry = canonical.find((entry) => entry.version === conflict.version);
    if (!canonicalEntry || canonicalEntry.hash !== conflict.canonicalHash) {
      fail(`conflict canonical representation drifted for ${conflict.version}`);
    }
    const archived = sqlFiles(archiveRoot).find((entry) => entry.version === conflict.version);
    if (!archived || archived.hash !== conflict.legacyMobileHash) {
      fail(`conflicting mobile variant is not preserved for ${conflict.version}`);
    }
  }

  if (!process.exitCode) {
    console.log(`Validated ${canonical.length} canonical migrations; ${manifest.entries.length} historical file entries; ${manifest.conflicts.length} preserved conflicts.`);
  }
}

function refreshCanonical() {
  if (!existsSync(manifestPath)) throw new Error("migration_manifest_missing");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  let added = 0;
  for (const migration of sqlFiles(canonicalRoot)) {
    const matching = manifest.entries.filter((entry) => entry.version === migration.version);
    if (matching.length > 0) {
      const expected = matching.find((entry) => entry.sourceRoot === canonicalRoot)
        ?? matching.find((entry) => entry.canonicalDisposition === "promote-to-canonical");
      if (!expected || expected.sha256 !== migration.hash) {
        throw new Error(`refusing_to_rewrite_historical_migration:${migration.filename}`);
      }
      continue;
    }
    manifest.entries.push({
      canonicalDisposition: "canonical",
      dependencyHints: dependencyHints(migration.sql),
      description: migration.description,
      duplicateStatus: "phase3-canonical",
      filename: migration.filename,
      objectCategories: categories(migration.sql),
      sha256: migration.hash,
      sizeBytes: migration.size,
      sourceRoot: canonicalRoot,
      version: migration.version
    });
    added += 1;
  }
  manifest.entries.sort((a, b) => a.version.localeCompare(b.version) || a.sourceRoot.localeCompare(b.sourceRoot));
  manifest.currentCanonicalMigrations = sqlFiles(canonicalRoot).length;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Refreshed canonical manifest with ${added} new migration(s).`);
}

if (process.argv.includes("--capture-legacy")) {
  const manifest = captureLegacy();
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Captured ${manifest.entries.length} legacy migration entries in ${path.relative(repositoryRoot, manifestPath)}.`);
} else if (process.argv.includes("--refresh-canonical")) {
  refreshCanonical();
} else {
  validate();
}
