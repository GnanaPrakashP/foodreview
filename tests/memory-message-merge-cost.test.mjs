import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  mergeMemoryMessageSnapshot,
  sortMemoryMessages,
  upsertMemoryMessage
} from "../mobile/src/services/memoryMessageReconciliation.mjs";

// The old snapshot merge called upsertMemoryMessage per incoming message, and
// upsert sorts the WHOLE array every time — so merging m messages into n cost
// O(m·n log n) plus m array copies, with a redundant final sort on top. Once
// history paging was fixed and rooms began loading their full history, that
// became the most expensive thing this app's own code did on a tab switch.
const uuid = (i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`;

function message(i, { legacy = false, optimistic = false, body } = {}) {
  const at = new Date(1785000000000 + i * 1000).toISOString();
  return {
    attachments: [],
    authorName: i % 2 ? "a" : "b",
    body: body ?? `m${i}`,
    clientCreatedAt: at,
    clientId: legacy ? null : `client-${i}`,
    clientOrderKey: `${at}:${i}`,
    clientSequence: i,
    createdAt: at,
    deliveryStatus: optimistic ? "pending" : "sent",
    editedAt: null,
    id: optimistic ? `optimistic-message:${i}` : uuid(i),
    replyToMessage: null,
    replyToMessageId: null,
    roomId: "room",
    serverCreatedAt: optimistic ? null : at,
    serverId: optimistic ? null : uuid(i)
  };
}

const mergeByRepeatedUpsert = (current, snapshot) => {
  let next = [...current];
  for (const incoming of snapshot) next = upsertMemoryMessage(next, incoming);
  return sortMemoryMessages(next);
};

test("snapshot merge matches repeated upsert across randomized realistic input", () => {
  let seed = 987654321;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  for (let round = 0; round < 200; round += 1) {
    // A logical message has ONE identity shape, and a snapshot never carries
    // the same logical message twice — both true of real server pages.
    const legacyBases = new Set();
    let current = [];
    for (let i = 0; i < Math.floor(rnd() * 20); i += 1) {
      const legacy = rnd() < 0.2;
      if (legacy) legacyBases.add(i);
      current = upsertMemoryMessage(current, message(i, { legacy, optimistic: rnd() < 0.3 }));
    }
    const seen = new Set();
    const snapshot = [];
    for (let k = 0; k < Math.floor(rnd() * 20); k += 1) {
      const base = current.length > 0 && rnd() < 0.5
        ? Number(current[Math.floor(rnd() * current.length)].body.slice(1))
        : 100 + k;
      if (seen.has(base)) continue;
      seen.add(base);
      snapshot.push(message(base, { legacy: legacyBases.has(base), body: `srv${base}` }));
    }

    assert.deepEqual(
      mergeMemoryMessageSnapshot(current, snapshot),
      mergeByRepeatedUpsert(current, snapshot),
      `round ${round}`
    );
  }
});

test("snapshot merge confirms an optimistic row instead of duplicating it", () => {
  const optimistic = message(1, { optimistic: true });
  const confirmed = message(1, { body: "from server" });
  const merged = mergeMemoryMessageSnapshot([optimistic], [confirmed]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].deliveryStatus, "sent");
  assert.equal(merged[0].serverId, uuid(1));
});

test("snapshot merge sorts once regardless of how many messages arrive", () => {
  // Guards the actual regression: a per-insert sort is invisible in output and
  // only shows up as cost, so assert the shape of the code that produces it.
  const source = readFileSync(
    new URL("../mobile/src/services/memoryMessageReconciliation.mjs", import.meta.url),
    "utf8"
  );
  const body = source.match(
    /export function mergeMemoryMessageSnapshot\([\s\S]*?\n\}/
  )?.[0] ?? "";
  assert.ok(body);
  assert.doesNotMatch(body, /upsertMemoryMessage\(/);
  assert.equal((body.match(/sortMemoryMessages\(/g) ?? []).length, 1);
  // Exact identity resolves by key, not by rescanning the array per message.
  assert.match(body, /const indexByKey = new Map\(\)/);
});
