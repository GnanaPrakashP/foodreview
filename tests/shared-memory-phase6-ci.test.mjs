import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const workflow = readFileSync(".github/workflows/memory-hardening.yml", "utf8");
const agents = readFileSync("AGENTS.md", "utf8");
const skill = readFileSync(".agents/skills/chat-production-hardening/SKILL.md", "utf8");
const status = readFileSync("docs/security/CHAT_PRODUCTION_STATUS.md", "utf8");

test("phase 6 adds repo scripts for memory hardening verification", () => {
  const scripts = packageJson.scripts ?? {};
  assert.match(scripts["test:memory-hardening"], /shared-memory-phase1-security\.test\.mjs/);
  assert.match(scripts["test:memory-hardening"], /shared-memory-phase2-media-security\.test\.mjs/);
  assert.match(scripts["test:memory-hardening"], /shared-memory-phase3-scalability\.test\.mjs/);
  assert.match(scripts["test:memory-hardening"], /shared-memory-phase4-mobile-performance\.test\.mjs/);
  assert.match(scripts["test:memory-hardening"], /shared-memory-phase5-operations\.test\.mjs/);
  assert.match(scripts["test:memory-hardening"], /shared-memory-phase6-ci\.test\.mjs/);
  assert.match(scripts["verify:memory-hardening"], /npm run test:memory-hardening/);
  assert.match(scripts["verify:memory-hardening"], /npm test/);
  assert.match(scripts["verify:memory-hardening"], /npm run test:coverage/);
  assert.match(scripts["verify:memory-hardening"], /npm run lint/);
  assert.match(scripts["verify:memory-hardening"], /npm run typecheck/);
  assert.match(scripts["verify:memory-hardening"], /npm run build/);
  assert.match(scripts["verify:memory-hardening"], /cd mobile && npm run typecheck/);
  assert.match(scripts["test:coverage"], /--experimental-test-coverage/);
  assert.doesNotMatch(scripts["test:coverage"], /\bc8\b/);
});

test("phase 6 CI runs memory hardening tests and root/mobile typechecks", () => {
  assert.match(workflow, /name: Memory Hardening/);
  assert.match(workflow, /npm run test:memory-hardening/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run test:coverage/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /MEMORY_UPLOAD_CLEANUP_SECRET: ci-placeholder-cleanup-secret/);
  assert.match(workflow, /working-directory: mobile[\s\S]*npm run typecheck/);
  assert.match(workflow, /tests\/shared-memory-phase\*\.test\.mjs/);
  assert.match(workflow, /mobile\/supabase\/\*\*/);
});

test("phase 6 workflow instructions keep the hardening command discoverable", () => {
  for (const document of [agents, skill]) {
    assert.match(document, /npm run test:memory-hardening/);
    assert.match(document, /Never skip a security gate/);
    assert.match(document, /Do not expose service-role keys to the mobile app/);
    assert.match(document, /Do not make private memory media public/);
  }
});

test("phase 6 status remains phase-gated or records completed hardening", () => {
  assert.match(status, /Current phase: (Production Hardening Phase 4|Phase 6|Complete|Final production-readiness audit|Production DB deployment verification)/);
  assert.match(status, /Next required phase: (Phase 4 manual staging\/release matrix|Tests and CI\/CD|None|Production DB deployment verification|Authenticated staging smoke verification)/);
});
