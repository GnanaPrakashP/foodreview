/**
 * Seed unread Table Memory messages for a viewer.
 *
 * Inserts messages authored by another room member into every shared memory
 * room where the viewer is a member. Since unread counts exclude the viewer's
 * own messages, this is useful for testing the unread badges on memory cards.
 *
 * Prerequisites:
 *   .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/seed-memory-unread-test-messages.mjs --viewer rahul_g --dry-run
 *   node scripts/seed-memory-unread-test-messages.mjs --viewer rahul_g --random 1:5 --execute
 *   node scripts/seed-memory-unread-test-messages.mjs --viewer rahul_g --room "Video Memory QA" --fallback-author gnana_prakash --ensure-author-member --execute
 *   node scripts/seed-memory-unread-test-messages.mjs --cleanup
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
const seedRecordPath = resolve(__dirname, ".memory-unread-seed-ids.json");

function loadEnv() {
  if (!existsSync(envPath)) {
    console.error("Missing .env.local at repo root.");
    process.exit(1);
  }

  return Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split("\n")
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
}

const args = process.argv.slice(2);
function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(flag) {
  return args.includes(flag);
}

const env = loadEnv();
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env.local.");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

if (hasFlag("--cleanup")) {
  if (!existsSync(seedRecordPath)) {
    console.error("No seed record found at scripts/.memory-unread-seed-ids.json.");
    process.exit(1);
  }

  const record = JSON.parse(readFileSync(seedRecordPath, "utf8"));
  const ids = Array.isArray(record.ids) ? record.ids.filter(Boolean) : [];
  const seededMembers = Array.isArray(record.memberInserts) ? record.memberInserts : [];

  if (ids.length > 0) {
    const { error } = await admin.from("shared_memory_messages").delete().in("id", ids);
    if (error) {
      console.error(`Cleanup failed: ${error.message}`);
      process.exit(1);
    }
  }

  for (const member of seededMembers) {
    if (!member?.room_id || !member?.user_name) continue;
    const { error } = await admin
      .from("shared_memory_members")
      .delete()
      .eq("room_id", member.room_id)
      .eq("user_name", member.user_name);
    if (error) {
      console.error(`Member cleanup failed for ${member.user_name} in ${member.room_id}: ${error.message}`);
      process.exit(1);
    }
  }

  console.log(`Deleted ${ids.length} seeded memory messages for ${record.viewer ?? "unknown viewer"}.`);
  if (seededMembers.length > 0) console.log(`Deleted ${seededMembers.length} temporary room members.`);
  process.exit(0);
}

const viewerInput = argValue("--viewer");
const roomFilter = argValue("--room");
const fallbackAuthorInput = argValue("--fallback-author") ?? "gnana_prakash";
const ensureAuthorMember = hasFlag("--ensure-author-member");
const fixedCount = Number(argValue("--messages") ?? "1");
const randomRange = argValue("--random");
const shouldExecute = hasFlag("--execute");
const dryRun = hasFlag("--dry-run") || !shouldExecute;

if (!viewerInput) {
  console.error("Usage: node scripts/seed-memory-unread-test-messages.mjs --viewer <username> [--room <id-or-title>] [--messages 1 | --random 1:5] [--fallback-author <username> --ensure-author-member] [--execute|--dry-run]");
  process.exit(1);
}

function randomCountForRoom() {
  if (!randomRange) return Number.isFinite(fixedCount) && fixedCount > 0 ? Math.floor(fixedCount) : 1;
  const [minRaw, maxRaw] = randomRange.split(":");
  const min = Math.max(1, Math.floor(Number(minRaw)));
  const max = Math.max(min, Math.floor(Number(maxRaw)));
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function resolveViewerUsername(input) {
  const trimmed = input.trim();
  const { data: exact, error: exactError } = await admin
    .from("profiles")
    .select("username")
    .ilike("username", trimmed)
    .limit(5);

  if (exactError) {
    console.error(`Could not look up profiles: ${exactError.message}`);
    process.exit(1);
  }

  const exactMatch = (exact ?? []).find((profile) => profile.username.toLowerCase() === trimmed.toLowerCase());
  if (exactMatch) return exactMatch.username;

  const { data: suggestions, error: suggestionsError } = await admin
    .from("profiles")
    .select("username")
    .ilike("username", `${trimmed.replace(/[_%]/g, "\\$&")}%`)
    .limit(10);

  if (suggestionsError) {
    console.error(`Could not look up profile suggestions: ${suggestionsError.message}`);
    process.exit(1);
  }

  console.error(`No exact profile username found for "${trimmed}".`);
  if (suggestions?.length) {
    console.error(`Did you mean: ${suggestions.map((profile) => profile.username).join(", ")}`);
  }
  process.exit(1);
}

const viewer = await resolveViewerUsername(viewerInput);
const fallbackAuthor = fallbackAuthorInput ? await resolveViewerUsername(fallbackAuthorInput) : null;
if (fallbackAuthor && fallbackAuthor.toLowerCase() === viewer.toLowerCase()) {
  console.error("--fallback-author must be different from --viewer so the messages count as unread.");
  process.exit(1);
}

const { data: membershipRows, error: membershipError } = await admin
  .from("shared_memory_members")
  .select("room_id")
  .eq("user_name", viewer);

if (membershipError) {
  console.error(`Could not load rooms for ${viewer}: ${membershipError.message}`);
  process.exit(1);
}

const roomIds = Array.from(new Set((membershipRows ?? []).map((row) => row.room_id).filter(Boolean)));
if (roomIds.length === 0) {
  console.log(`${viewer} is not a member of any memory rooms.`);
  process.exit(0);
}

const [{ data: rooms, error: roomsError }, { data: members, error: membersError }] = await Promise.all([
  admin
    .from("shared_memory_rooms")
    .select("id, title, restaurant_name, created_at")
    .in("id", roomIds)
    .order("created_at", { ascending: false }),
  admin
    .from("shared_memory_members")
    .select("room_id, user_name, role, created_at")
    .in("room_id", roomIds)
]);

if (roomsError) {
  console.error(`Could not load rooms: ${roomsError.message}`);
  process.exit(1);
}
if (membersError) {
  console.error(`Could not load room members: ${membersError.message}`);
  process.exit(1);
}

const membersByRoom = new Map();
for (const member of members ?? []) {
  const bucket = membersByRoom.get(member.room_id) ?? [];
  bucket.push(member);
  membersByRoom.set(member.room_id, bucket);
}

const now = Date.now();
const selectedRooms = roomFilter
  ? (rooms ?? []).filter((room) => {
    const needle = roomFilter.toLowerCase();
    return (
      room.id.toLowerCase() === needle ||
      (room.title ?? "").toLowerCase().includes(needle) ||
      (room.restaurant_name ?? "").toLowerCase().includes(needle)
    );
  })
  : (rooms ?? []);

if (roomFilter && selectedRooms.length === 0) {
  console.error(`No ${viewer} memory room matched --room "${roomFilter}".`);
  process.exit(1);
}

const inserts = [];
const skippedRooms = [];
const memberInserts = [];

for (const room of selectedRooms) {
  const roomMembers = (membersByRoom.get(room.id) ?? []).sort((first, second) => {
    if (first.role !== second.role) return first.role === "owner" ? -1 : 1;
    return new Date(first.created_at).getTime() - new Date(second.created_at).getTime();
  });
  let author = roomMembers.find((member) => member.user_name !== viewer)?.user_name;
  if (!author) {
    if (!fallbackAuthor || !ensureAuthorMember) {
      skippedRooms.push({ id: room.id, label: room.title || room.restaurant_name || "(untitled)" });
      continue;
    }
    author = fallbackAuthor;
    memberInserts.push({
      room_id: room.id,
      user_name: fallbackAuthor,
      role: "participant"
    });
  }

  const messageCount = randomCountForRoom();
  for (let index = 0; index < messageCount; index += 1) {
    const createdAt = new Date(now + inserts.length * 1000).toISOString();
    inserts.push({
      room_id: room.id,
      author_name: author,
      body: `[Unread badge test] ${index + 1}/${messageCount} for ${viewer}`,
      created_at: createdAt
    });
  }
}

console.log(`${dryRun ? "Dry run" : "Execute"} for viewer: ${viewer}`);
console.log(`Rooms found: ${roomIds.length}`);
if (roomFilter) console.log(`Rooms matched by filter: ${selectedRooms.length}`);
console.log(`Rooms with another participant: ${new Set(inserts.map((item) => item.room_id)).size}`);
console.log(`Messages to insert: ${inserts.length}`);
if (memberInserts.length > 0) console.log(`Temporary members to insert: ${memberInserts.length}`);
if (skippedRooms.length > 0) {
  console.log(`Skipped solo rooms: ${skippedRooms.length}`);
  skippedRooms.slice(0, 10).forEach((room) => console.log(`  - ${room.label} (${room.id})`));
}

if (dryRun) {
  console.log("No writes performed. Add --execute to insert these messages.");
  process.exit(0);
}

if (inserts.length === 0) {
  console.log("Nothing to insert.");
  process.exit(0);
}

const insertedMembers = [];
for (const member of memberInserts) {
  const { data: existingMember, error: existingMemberError } = await admin
    .from("shared_memory_members")
    .select("room_id, user_name")
    .eq("room_id", member.room_id)
    .eq("user_name", member.user_name)
    .maybeSingle();

  if (existingMemberError) {
    console.error(`Could not check member ${member.user_name}: ${existingMemberError.message}`);
    process.exit(1);
  }

  if (existingMember) continue;

  const { error: memberInsertError } = await admin.from("shared_memory_members").insert(member);
  if (memberInsertError) {
    console.error(`Could not insert temporary member ${member.user_name}: ${memberInsertError.message}`);
    process.exit(1);
  }
  insertedMembers.push(member);
}

const { data: inserted, error: insertError } = await admin
  .from("shared_memory_messages")
  .insert(inserts)
  .select("id, room_id, author_name, body, created_at");

if (insertError) {
  console.error(`Insert failed: ${insertError.message}`);
  process.exit(1);
}

const ids = (inserted ?? []).map((message) => message.id);
const previousRecord = existsSync(seedRecordPath)
  ? JSON.parse(readFileSync(seedRecordPath, "utf8"))
  : null;
const previousIds = Array.isArray(previousRecord?.ids) ? previousRecord.ids : [];
const previousMessages = Array.isArray(previousRecord?.messages) ? previousRecord.messages : [];
const previousMemberInserts = Array.isArray(previousRecord?.memberInserts) ? previousRecord.memberInserts : [];
writeFileSync(seedRecordPath, JSON.stringify({
  viewer,
  createdAt: new Date().toISOString(),
  ids: [...previousIds, ...ids],
  memberInserts: [...previousMemberInserts, ...insertedMembers],
  messages: [...previousMessages, ...(inserted ?? [])]
}, null, 2));

console.log(`Inserted ${ids.length} messages.`);
if (insertedMembers.length > 0) console.log(`Inserted ${insertedMembers.length} temporary room members.`);
console.log(`Cleanup file: ${seedRecordPath}`);

const { data: summaries, error: summariesError } = await admin.rpc("shared_memory_room_summaries", {
  p_user_name: viewer,
  p_limit: 100,
  p_before_activity_at: null,
  p_before_room_id: null
});

if (summariesError) {
  console.log(`Could not verify unread summaries: ${summariesError.message}`);
  process.exit(0);
}

console.log("Top memory unread counts after seed:");
(summaries ?? []).slice(0, 20).forEach((room) => {
  const label = room.title || room.restaurant_name || "(untitled)";
  console.log(`  ${room.unread_count} unread - ${label} (${room.id})`);
});
