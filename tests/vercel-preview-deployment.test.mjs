import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const previewConfig = JSON.parse(readFileSync(new URL("../vercel.preview.json", import.meta.url), "utf8"));
const productionConfig = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const deployScript = readFileSync(new URL("../scripts/vercel-preview-deploy.mjs", import.meta.url), "utf8");

test("Vercel Preview deployment excludes production cron registration", () => {
  assert.deepEqual(previewConfig.regions, productionConfig.regions);
  assert.equal("crons" in previewConfig, false);
  assert.ok(Array.isArray(productionConfig.crons));
  assert.ok(productionConfig.crons.length > 0);
});

test("the deployment command stages committed source with the Preview config for a native Vercel build", () => {
  const command = packageJson.scripts["deploy:preview"];
  assert.equal(packageJson.scripts["predeploy:preview"], undefined);
  assert.equal(command, "node scripts/vercel-preview-deploy.mjs");
  assert.equal(packageJson.scripts["verify:deploy-preview"], "node scripts/vercel-preview-deploy.mjs --verify");
  assert.match(deployScript, /\["ls-files", "-z"\]/);
  assert.match(deployScript, /preview_deploy_requires_clean_tracked_worktree/);
  assert.match(deployScript, /readFile\(path\.join\(repositoryRoot, "vercel\.preview\.json"\)/);
  assert.match(deployScript, /writeFile\(path\.join\(stagingRoot, "vercel\.json"\)/);
  assert.match(deployScript, /"vercel@56\.4\.0", "deploy", "--yes", "--target=preview"/);
  assert.doesNotMatch(deployScript, /--prebuilt|--prod(?:uction)?\b/);
  assert.match(deployScript, /rm\(stagingRoot, \{ force: true, recursive: true \}\)/);
});
