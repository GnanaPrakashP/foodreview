#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const inventory = JSON.parse(await readFile(new URL("config/observability-inventory.json", root), "utf8"));
const alerts = JSON.parse(await readFile(new URL("config/operations-alerts.json", root), "utf8"));
const schedules = JSON.parse(await readFile(new URL("config/operations-schedules.json", root), "utf8"));
if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.entries)) throw new Error("observability_inventory_invalid");
const requiredDomains = new Set(["mobile", "api", "worker", "database", "scheduler", "push", "moderation", "media", "deletion", "realtime", "storage", "backup", "release"]);
for (const [index, entry] of inventory.entries.entries()) {
  for (const key of ["domain", "signal", "environment", "severity", "retention", "privacyRisk", "correlation", "alerting", "operatorAction"]) {
    if (typeof entry[key] !== "string" || !entry[key].trim()) throw new Error(`observability_inventory_${index}_${key}_invalid`);
  }
  requiredDomains.delete(entry.domain);
}
if (requiredDomains.size) throw new Error(`observability_inventory_missing:${[...requiredDomains].join(",")}`);
if (schedules.operations.length < 15) throw new Error("operations_schedule_inventory_incomplete");
for (const alert of alerts.alerts) {
  if (!["above", "below"].includes(alert.comparison) || !Number.isFinite(alert.warning) || !Number.isFinite(alert.critical)) throw new Error(`alert_invalid:${alert.id}`);
  await access(new URL(`docs/operations/runbooks/${alert.runbook}.md`, root));
}
console.log(`Validated ${inventory.entries.length} observability signals, ${schedules.operations.length} schedules, and ${alerts.alerts.length} alert definitions.`);
