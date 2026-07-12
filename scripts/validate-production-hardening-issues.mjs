import { readFile } from "node:fs/promises";

const registerUrl = new URL("../docs/production-hardening/issues.json", import.meta.url);
const allowedSeverities = new Set(["P0", "P1", "P2", "P3"]);
const allowedStatuses = new Set(["open", "in_progress", "blocked", "complete", "accepted_risk"]);

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function requireStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must be a non-empty array`);
  }
  value.forEach((item, index) => requireString(item, `${field}[${index}]`));
}

const register = JSON.parse(await readFile(registerUrl, "utf8"));
if (register.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
requireString(register.program, "program");
requireString(register.updatedAt, "updatedAt");
requireString(register.sourceCommit, "sourceCommit");
if (!Array.isArray(register.issues) || register.issues.length === 0) {
  throw new Error("issues must be a non-empty array");
}

const ids = new Set();
for (const [index, issue] of register.issues.entries()) {
  const prefix = `issues[${index}]`;
  requireString(issue.id, `${prefix}.id`);
  if (!/^PH-\d{3}$/.test(issue.id)) throw new Error(`${prefix}.id must match PH-NNN`);
  if (ids.has(issue.id)) throw new Error(`duplicate issue id ${issue.id}`);
  ids.add(issue.id);
  requireString(issue.title, `${prefix}.title`);
  if (!allowedSeverities.has(issue.severity)) throw new Error(`${issue.id}.severity is invalid`);
  if (!allowedStatuses.has(issue.status)) throw new Error(`${issue.id}.status is invalid`);
  requireString(issue.phase, `${issue.id}.phase`);
  requireString(issue.branch, `${issue.id}.branch`);
  requireStringArray(issue.affectedFiles, `${issue.id}.affectedFiles`);
  if (!Array.isArray(issue.dependencies)) throw new Error(`${issue.id}.dependencies must be an array`);
  issue.dependencies.forEach((dependency, dependencyIndex) => {
    requireString(dependency, `${issue.id}.dependencies[${dependencyIndex}]`);
  });
  requireStringArray(issue.acceptanceCriteria, `${issue.id}.acceptanceCriteria`);
}

console.log(`Validated ${register.issues.length} production-hardening issues.`);
