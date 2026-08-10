#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  return result.stdout;
}

const names = run("docker", ["ps", "--format", "{{.Names}}"]).trim().split(/\s+/);
const database = names.find((name) => name.startsWith("supabase_db_") && name.includes("foodreview"));
if (!database) throw new Error("Local Witoh Supabase database container is not running");
const fixture = readFileSync(new URL("./fixtures/phase5-performance.sql", import.meta.url), "utf8");
const output = run("docker", ["exec", "-i", database, "psql", "-X", "-q", "-U", "postgres", "-d", "postgres"], { input: fixture });

// Circle can legitimately start from the chronological active cursor or from a
// reviewer-scoped index when the local profile cardinality is small. Both plans
// remain indexed; the large-table sequential-scan guard below is authoritative.
const plans = [
  ["CIRCLE", ["reviews_active_cursor_idx", "reviews_reviewer_name_idx", "reviews_reviewer_visible_cursor_idx"]],
  ["PUBLIC", ["reviews_public_cursor_idx"]],
  ["COMMENTS", ["comments_post_cursor_idx"]],
  ["NOTIFICATIONS", ["notifications_recipient_user_cursor_idx"]],
  ["CHAT", ["shared_memory_messages_room_created_id_desc_idx"]]
];
const timings = [];
for (const [label, acceptedIndexes] of plans) {
  const match = output.match(new RegExp(`PHASE5_PLAN_${label}_BEGIN([\\s\\S]*?)PHASE5_PLAN_${label}_END`));
  assert.ok(match, `${label} plan output is missing`);
  const usedIndexes = Array.from(match[1].matchAll(/"Index Name": "([^"]+)"/g), (entry) => entry[1]);
  assert.ok(
    acceptedIndexes.some((index) => usedIndexes.includes(index)),
    `${label} did not use an accepted cursor/filter index (${acceptedIndexes.join(", ")}); used ${usedIndexes.join(", ") || "no index"}`
  );
  const sequentialRelations = Array.from(
    match[1].matchAll(/"Node Type": "Seq Scan"[\s\S]{0,600}?"Relation Name": "([^"]+)"/g),
    (entry) => entry[1]
  );
  const largeTables = new Set(["reviews", "comments", "notifications", "shared_memory_messages"]);
  assert.equal(sequentialRelations.some((relation) => largeTables.has(relation)), false,
    `${label} sequentially scanned a seeded large table: ${sequentialRelations.join(", ")}`);
  const execution = Number(match[1].match(/"Execution Time": ([0-9.]+)/)?.[1]);
  assert.ok(Number.isFinite(execution), `${label} execution timing is missing`);
  timings.push({ executionMs: execution, query: label.toLowerCase() });
}
assert.match(output, /PHASE5_CURSOR_OVERLAP=0/);
assert.match(output, /PHASE5_CURSOR_PAGE_TWO=24/);
const circleRows = Number(output.match(/PHASE5_CIRCLE_ROWS=(\d+)/)?.[1]);
assert.equal(circleRows, 10, `Circle returned ${circleRows} rows instead of one bounded page`);
const circlePayloadBytes = Number(output.match(/PHASE5_CIRCLE_PAYLOAD_BYTES=(\d+)/)?.[1]);
assert.ok(circlePayloadBytes > 0 && circlePayloadBytes <= 196608,
  `Circle payload ${circlePayloadBytes} exceeds budget`);
const payloadBytes = Number(output.match(/PHASE5_PAYLOAD_BYTES=(\d+)/)?.[1]);
assert.ok(payloadBytes > 0 && payloadBytes <= 196608, `public payload ${payloadBytes} exceeds budget`);
const homeMediaRows = Number(output.match(/PHASE5_HOME_MEDIA_ROWS=(\d+)/)?.[1]);
assert.equal(homeMediaRows, 10, `Home media authorization returned ${homeMediaRows} assets`);
const homeMediaPayloadBytes = Number(output.match(/PHASE5_HOME_MEDIA_PAYLOAD_BYTES=(\d+)/)?.[1]);
assert.ok(homeMediaPayloadBytes > 0 && homeMediaPayloadBytes <= 65536,
  `Home media authorization payload ${homeMediaPayloadBytes} exceeds budget`);

console.log(JSON.stringify({
  fixture: { comments: 2000, memoryMessages: 5000, notifications: 5000, reviews: 10000 },
  circle: { payloadBytes: circlePayloadBytes, rows: circleRows },
  homeMedia: { assets: homeMediaRows, authorizationPayloadBytes: homeMediaPayloadBytes },
  payloadBytes,
  plans: timings,
  stableCursor: { overlap: 0, pageTwoRows: 24 },
  status: "PASS"
}, null, 2));
