import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const previewConfig = JSON.parse(readFileSync(new URL("../vercel.preview.json", import.meta.url), "utf8"));
const productionConfig = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

test("Vercel Preview deployment excludes production cron registration", () => {
  assert.deepEqual(previewConfig.regions, productionConfig.regions);
  assert.equal("crons" in previewConfig, false);
  assert.ok(Array.isArray(productionConfig.crons));
  assert.ok(productionConfig.crons.length > 0);
});

test("the deployment command explicitly selects Preview and its local config", () => {
  const buildCommand = packageJson.scripts["predeploy:preview"];
  const command = packageJson.scripts["deploy:preview"];
  assert.match(buildCommand, /vercel@56\.4\.0 build/);
  assert.match(buildCommand, /--target=preview/);
  assert.match(buildCommand, /--local-config vercel\.preview\.json/);
  assert.match(command, /vercel@56\.4\.0 deploy/);
  assert.match(command, /--prebuilt/);
  assert.match(command, /--target=preview/);
  assert.match(command, /--local-config vercel\.preview\.json/);
  assert.doesNotMatch(`${buildCommand} ${command}`, /--prod(?:uction)?\b/);
});
