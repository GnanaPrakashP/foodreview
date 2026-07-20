import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../scripts/seed-home-media-test-dataset.mjs", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../scripts/fixtures/home-media-test-manifest.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("Home media seed is local by default and hosted staging requires exact destructive guards", () => {
  assert.match(source, /const DATASET_ID = "home_media_test_v1"/);
  assert.match(source, /function isLoopbackUrl\(value\)/);
  assert.match(source, /Refusing non-loopback dataset target/);
  assert.match(source, /hostedProjectDisposition/);
  assert.match(source, /--hosted-project-ref/);
  assert.match(source, /HOME_MEDIA_HOSTED_ENVIRONMENT/);
  assert.match(source, /HOME_MEDIA_HOSTED_CONFIRMATION/);
  assert.match(source, /hosted_fixture_project_ref_mismatch/);
  assert.match(source, /hosted_fixture_target_not_empty/);
  assert.match(source, /hosted_fixture_storage_not_empty/);
  for (const mode of ["--dry-run", "--apply", "--cleanup", "--verify"]) assert.match(source, new RegExp(mode));
  assert.equal(packageJson.scripts["seed:home-media"], "node scripts/seed-home-media-test-dataset.mjs");
});

test("every binary fixture uses upload intent, private source upload, finalize, moderation and worker processing", () => {
  for (const contract of [
    "/api/media/upload-intent",
    "media-sources",
    "/api/media/finalize-upload",
    "apply_media_moderation_action",
    "/api/internal/media/process"
  ]) assert.match(source, new RegExp(contract.replaceAll("/", "\\/")));
  assert.match(source, /status !== "ready"/);
  assert.match(source, /privacy_state !== "stable"/);
  assert.match(source, /public_url !== null/);
});

test("dataset defines two ordered valid ten-post pages plus blocked and repair-only invalid cases", () => {
  const labels = [...source.matchAll(/label: "TEST (\d{2}) —/g)].map((match) => Number(match[1]));
  assert.deepEqual(labels, Array.from({ length: 20 }, (_, index) => index + 1));
  assert.match(source, /TEST BLOCKED — Authorization exclusion/);
  assert.match(source, /TEST 11 — Ten images/);
  assert.match(source, /TEST 10 — Initials avatar fallback/);
  assert.match(source, /TEST INVALID — Published without media/);
  assert.match(source, /hiddenInvalidPosts: 1/);
});

test("large test posts preserve the production four-item mutation cap", () => {
  assert.match(source, /const contractMedia = media\.slice\(0, 4\)/);
  assert.match(source, /const additionalMedia = media\.slice\(4\)/);
  assert.match(source, /asset\.status !== "ready"/);
  assert.match(source, /asset\.owner_id !== role\.id/);
  assert.match(source, /row\.bucket_id !== "media-private"/);
  assert.match(source, /public_url: null/);
});

test("fixture manifest is repository-owned and contains no remote source", () => {
  assert.equal(manifest.datasetId, "home_media_test_v1");
  assert.equal(manifest.fixtures.length, 9);
  assert.ok(manifest.fixtures.some((fixture) => fixture.originalAspectRatio === "portrait"));
  assert.ok(manifest.fixtures.some((fixture) => fixture.originalAspectRatio === "landscape"));
  assert.ok(manifest.fixtures.some((fixture) => fixture.originalAspectRatio === "square"));
  assert.ok(manifest.fixtures.every((fixture) => !/^https?:/i.test(fixture.source)));
  assert.ok(manifest.fixtures.every((fixture) => /repository-owned/.test(fixture.license)));
});
