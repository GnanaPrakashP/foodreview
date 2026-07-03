/**
 * Chat timestamp test-case seeder
 *
 * Inserts the full verification matrix for the memory-room chat timestamp
 * placement (ChatMainBodyWithTime) into an existing room, alternating between
 * two real room members so both sent (right) and received (left) bubbles are
 * covered. Text cases only — media/dish cases are listed as manual steps in
 * scripts/chat-timestamp-test-cases.md.
 *
 * Prerequisites:
 *   .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/seed-chat-timestamp-cases.mjs --list-rooms
 *   node scripts/seed-chat-timestamp-cases.mjs --room <room_id> --me <username>
 *
 * `--me` is the username you log in with on the phone, so "mine" cases render
 * on the right for you. The first other member of the room plays the friend.
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

/* ── Load .env.local ── */
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌  NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* ── CLI args ── */
const args = process.argv.slice(2);
function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

if (args.includes("--list-rooms")) {
  const { data, error } = await admin
    .from("shared_memory_rooms")
    .select("id, restaurant_name, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("❌ ", error.message);
    process.exit(1);
  }
  for (const room of data) console.log(`${room.id}  ${room.restaurant_name ?? "(unnamed)"}`);
  process.exit(0);
}

const SEED_IDS_PATH = resolve(__dirname, ".chat-timestamp-seed-ids.json");

// --cleanup: delete exactly the messages a previous run inserted (by id).
if (args.includes("--cleanup")) {
  if (!existsSync(SEED_IDS_PATH)) {
    console.error("❌  No previous seed record found (scripts/.chat-timestamp-seed-ids.json).");
    process.exit(1);
  }
  const ids = JSON.parse(readFileSync(SEED_IDS_PATH, "utf8")).filter(Boolean);
  const { error } = await admin.from("shared_memory_messages").delete().in("id", ids);
  if (error) {
    console.error("❌ ", error.message);
    process.exit(1);
  }
  console.log(`✓ Deleted ${ids.length} seeded test messages.`);
  process.exit(0);
}

const ROOM_ID = argValue("--room");
const ME = argValue("--me");
if (!ROOM_ID || !ME) {
  console.error("Usage: node scripts/seed-chat-timestamp-cases.mjs --room <room_id> --me <username>");
  console.error("       node scripts/seed-chat-timestamp-cases.mjs --list-rooms");
  console.error("       node scripts/seed-chat-timestamp-cases.mjs --cleanup");
  process.exit(1);
}

/* ── Validate members ── */
const { data: members, error: membersError } = await admin
  .from("shared_memory_members")
  .select("user_name")
  .eq("room_id", ROOM_ID);
if (membersError) {
  console.error("❌ ", membersError.message);
  process.exit(1);
}
const memberNames = (members ?? []).map((m) => m.user_name);
if (!memberNames.includes(ME)) {
  console.error(`❌  "${ME}" is not a member of this room. Members: ${memberNames.join(", ")}`);
  process.exit(1);
}
const OTHER = memberNames.find((name) => name !== ME);
if (!OTHER) {
  console.error("❌  Room needs at least one other member for received-message cases.");
  process.exit(1);
}

/* ── The matrix ─────────────────────────────────────────────────────────
 * sender: "me" | "other"
 * at: minutes relative to a base one hour ago (fractions = seconds), or an
 *     absolute Date for the day-boundary cases.
 * replyTo: index of an earlier case to quote.
 * edited: sets edited_at (wide "edited h:mm" label).
 */
const now = Date.now();
const base = now - 60 * 60_000;
const yesterday = (h, m) => {
  const d = new Date(now - 86_400_000);
  d.setHours(h, m, 0, 0);
  return d;
};
const today = (h, m) => {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d;
};

const CASES = [
  // ── 1. Single-line, time fits beside ──
  { sender: "me", at: 0, body: "K", expect: "1-char: time beside, bubble grows to fit time" },
  { sender: "me", at: 1, body: "Hi", expect: "tiny: time beside" },
  { sender: "other", at: 2, body: "Hi", expect: "received tiny: left, sender name, avatar, time beside" },
  { sender: "me", at: 3, body: "Asd", expect: "the old stuck case: wide one-liner, time beside" },
  { sender: "me", at: 4, body: "Asdf", expect: "the old stuck case #2: same" },
  { sender: "other", at: 5, body: "Ok", expect: "received short: time beside" },
  { sender: "me", at: 6, body: "On my way now", expect: "medium single line: time beside" },

  // ── 2. Boundary stair: somewhere in here the time stops fitting beside
  //       and must drop to its own tight line — the transition should be
  //       clean and stable (no jiggle, no overlap) ──
  { sender: "me", at: 7, body: "The dosa here is really great!", expect: "boundary stair 1" },
  { sender: "me", at: 8, body: "The dosa here is really great meal", expect: "boundary stair 2" },
  { sender: "me", at: 9, body: "The dosa here is really great meal ya", expect: "boundary stair 3" },
  { sender: "me", at: 10, body: "The dosa here is really great meal today", expect: "boundary stair 4" },
  { sender: "me", at: 11, body: "The dosa here is really great meal today ra", expect: "boundary stair 5" },
  { sender: "other", at: 12, body: "The dosa here is really great meal today ra", expect: "same boundary, received (narrower cap: avatar column)" },

  // ── 3. Unbroken words (mid-word breaking) ──
  { sender: "me", at: 13, body: "Loooooooooooooooooooooooooooool", expect: "single long word: mid-word break, no dead band" },
  { sender: "me", at: 14, body: "lgzigxigxigxigxitxitxiyxiyxitx ifxifxigxigxigxigxigcigcigxig", expect: "the classic gibberish: greedy break, time placement clean" },
  { sender: "other", at: 15, body: "lgzigxigxigxigxitxitxiyxiyxitx ifxifxigxigxigxigxigcigcigxig", expect: "same, received" },

  // ── 4. Multiline ──
  { sender: "other", at: 16, body: "The biryani rice was fragrant and the meat was tender. This is definitely worth saving for us.", expect: "3 lines, short last line: time tucked in the trailing gap, no extra line" },
  { sender: "me", at: 17, body: "The biryani rice was fragrant and the meat was tender. This is definitely worth saving for late-night cravings.", expect: "3 lines, full last line: time on its own tight line, small gap to bubble bottom" },
  { sender: "me", at: 18, body: "Order list:\nTwo biryanis\nOne haleem\nDone", expect: "explicit newlines: 4 lines, time after short last line" },
  { sender: "me", at: 19, body: "We should plan the next dinner properly this time. Everyone keeps suggesting places at the last minute and we end up at the same spot. Drop your top three picks here by tonight and I will make a poll tomorrow morning so we can lock the date and the place well in advance.", expect: "very long (6+ lines): stable, time at bottom-right" },

  // ── 5. Special content ──
  { sender: "me", at: 20, body: "😂😂😂", expect: "emoji only: time beside" },
  { sender: "me", at: 21, body: "So good 😋🔥", expect: "emoji + text: time beside" },
  { sender: "me", at: 22, body: "Menu is at https://example.com/pista-house tonight", expect: "link renders + wraps, time placed correctly" },
  { sender: "me", at: 23, body: "Total was 1,240.50!!", expect: "numbers/punctuation: time beside" },
  { sender: "me", at: 24, body: "OKAY WOW", expect: "wide caps glyphs: time beside" },

  // ── 6. Replies ──
  { sender: "other", at: 25, body: "Should we book the family pack for Saturday or go with individual plates?", expect: "(setup for reply below)" },
  { sender: "me", at: 26, body: "Ok", replyTo: 25, expect: "reply, quote wider than body: time at bubble's right edge, not after 'Ok'" },
  { sender: "me", at: 27, body: "Coming?", expect: "(setup for reply below)" },
  { sender: "other", at: 28, body: "Yes, give me twenty minutes, the traffic near the flyover is really bad right now", replyTo: 27, expect: "received reply, body wider than quote: normal placement" },

  // ── 7. Edited ──
  { sender: "me", at: 29, body: "This message was edited after sending", edited: true, expect: "wide 'edited h:mm' label: still fits/wraps correctly" },

  // ── 8. Grouping runs ──
  { sender: "me", at: 30.0, body: "One", expect: "run 1/4: tail on this one only" },
  { sender: "me", at: 30.2, body: "Two", expect: "run 2/4: no tail, tight corner" },
  { sender: "me", at: 30.4, body: "Three", expect: "run 3/4" },
  { sender: "me", at: 30.6, body: "Four", expect: "run 4/4: each shows its own time" },
  { sender: "other", at: 31.0, body: "A?", expect: "alternating: name header each time the sender changes" },
  { sender: "me", at: 31.2, body: "B" },
  { sender: "other", at: 31.4, body: "C?" },
  { sender: "me", at: 31.6, body: "D" },

  // ── 9. Day boundary ──
  { sender: "me", atDate: yesterday(23, 59), body: "Late night one", expect: "before the day divider" },
  { sender: "me", atDate: today(0, 1), body: "Past midnight", expect: "after the divider: new group, tail again" },

  // ── 10. Sanitization ──
  { sender: "me", at: 32, body: "   ", expect: "whitespace-only: must NOT appear in the chat at all" },

  // ── 11. Sender-name lengths (received bubbles) ──
  // The sender-name header competes with the text for bubble width; the time
  // must sit at the BUBBLE's right edge in every combination.
  { sender: "priya_nair", at: 33, body: "Hi", expect: "short name > text: time at bubble edge (name-driven width)" },
  { sender: "priya_nair", at: 34, body: "Priya here ok", expect: "short name ≈ text width" },
  { sender: "siddharth_rao", at: 35, body: "Hi", expect: "medium name ≫ text: time at bubble edge" },
  { sender: "siddharth_rao", at: 36, body: "The pulao was decent but the raita saved it honestly", expect: "medium name, multiline text wider than name" },
  { sender: "ananya_krishnan", at: 37, body: "Hi", expect: "longest name ≫ text: time at bubble edge" },
  { sender: "ananya_krishnan", at: 38, body: "Same", expect: "longest name, 4-char text" },
  { sender: "ananya_krishnan", at: 39, body: "Count me in for Saturday, I will get the drinks and the paper plates for everyone", expect: "longest name, multiline: normal placement" },
  // Consecutive run from a long-named sender: header only on the first;
  // follow-ups have no header, so their bubbles hug text+time on their own.
  { sender: "ananya_krishnan", at: 40.0, body: "One", expect: "long-name run 1/3: header + name-driven width" },
  { sender: "ananya_krishnan", at: 40.2, body: "Two more", expect: "run 2/3: no header, bubble hugs text+time" },
  { sender: "ananya_krishnan", at: 40.4, body: "Three", expect: "run 3/3: same" },
  // Reply from a long-named sender quoting a short message: header + quote +
  // short body all competing for width.
  { sender: "me", at: 41, body: "Done?", expect: "(setup for reply below)" },
  { sender: "ananya_krishnan", at: 42, body: "Yes", replyTo: 51, expect: "long name + quote card + 3-char body: time at bubble edge" },

  // ── 12. Short lines via explicit newlines (found in the wild 2026-07-04:
  //        time floated a full line below the last word) ──
  { sender: "me", at: 43, body: "Jssjdj\nSbdjdbdk\nJdndjx\nJxjd", expect: "4 short newline lines: bubble hugs longest line, time on own line TIGHT under the last word" },
  { sender: "other", at: 44, body: "Jssjdj\nSbdjdbdk\nJdndjx\nJxjd", expect: "same, received (name header wider than lines)" },
];

// Extra usernames used above must exist as room members (the security
// triggers require the author to be a participant). Enroll them if missing.
const EXTRA_SENDERS = [...new Set(
  CASES.map((c) => c.sender).filter((s) => s !== "me" && s !== "other")
)];

/* ── Enroll extra senders as room members (idempotent) ── */
for (const username of EXTRA_SENDERS) {
  if (memberNames.includes(username)) continue;
  const { error } = await admin
    .from("shared_memory_members")
    .insert({ room_id: ROOM_ID, user_name: username, role: "participant" });
  if (error) {
    console.error(`❌  Could not add member "${username}": ${error.message}`);
    console.error("    (Does this profile exist? Run scripts/seed.mjs first.)");
    process.exit(1);
  }
  console.log(`+ added ${username} to the room`);
}

/* ── Insert ── */
function resolveAuthor(sender) {
  if (sender === "me") return ME;
  if (sender === "other") return OTHER;
  return sender;
}

const insertedIds = [];
let failures = 0;
for (let i = 0; i < CASES.length; i += 1) {
  const testCase = CASES[i];
  const createdAt = testCase.atDate
    ? testCase.atDate.toISOString()
    : new Date(base + testCase.at * 60_000).toISOString();
  const row = {
    room_id: ROOM_ID,
    author_name: resolveAuthor(testCase.sender),
    body: testCase.body,
    created_at: createdAt,
    reply_to_message_id: testCase.replyTo !== undefined ? insertedIds[testCase.replyTo] ?? null : null,
    edited_at: testCase.edited ? createdAt : null,
  };
  const { data, error } = await admin
    .from("shared_memory_messages")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    failures += 1;
    insertedIds.push(null);
    console.error(`✗ case ${i} (${JSON.stringify(testCase.body.slice(0, 24))}…): ${error.message}`);
    continue;
  }
  insertedIds.push(data.id);
  console.log(`✓ case ${i} ${testCase.sender === "me" ? "→" : "←"} ${JSON.stringify(testCase.body.slice(0, 40))}${testCase.expect ? `  [${testCase.expect}]` : ""}`);
}

writeFileSync(SEED_IDS_PATH, JSON.stringify(insertedIds, null, 2));
console.log(`\nDone: ${CASES.length - failures}/${CASES.length} inserted into room ${ROOM_ID}.`);
console.log("Verify against scripts/chat-timestamp-test-cases.md.");
console.log("When finished, remove the seeded messages with:");
console.log("  node scripts/seed-chat-timestamp-cases.mjs --cleanup");
