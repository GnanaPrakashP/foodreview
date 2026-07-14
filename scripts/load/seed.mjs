#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import {
  argument,
  assertNodeRuntime,
  hasFlag,
  invariant,
  loadCapacityConfig,
  resultDirectory,
  safeTargetMetadata,
  writeResult
} from "./lib.mjs";
import { buildSeedPlan, seedCounts } from "./seed-plan.mjs";

const config = await loadCapacityConfig();
const scale = Number(argument("scale", 1));
const counts = seedCounts(config, scale);
const apply = hasFlag("apply");
const localContract = hasFlag("local-contract");
if (!apply) {
  console.log(JSON.stringify({
    apply: false,
    counts,
    dataClassification: "synthetic-only",
    requiredFollowUp: [
      `npm run load:media -- --tier=launch --total=${counts.mediaUploads}`,
      "npm run load:reconcile -- --dry-run"
    ],
    status: "dry-run"
  }, null, 2));
  process.exit(0);
}

assertNodeRuntime(config, { localValidation: localContract });
const target = safeTargetMetadata(config, process.env, localContract
  ? { allowLocal: true }
  : { confirmation: config.safety.seedConfirmation });
const startedAt = new Date().toISOString();
const supabaseUrl = process.env.LOAD_STAGING_SUPABASE_URL;
const serviceKey = process.env.LOAD_STAGING_SERVICE_ROLE_KEY;
const password = process.env.LOAD_ACTOR_PASSWORD;
const emailDomain = process.env.LOAD_ACTOR_EMAIL_DOMAIN?.trim().toLowerCase();
invariant(Boolean(serviceKey && password && password.length >= 16), "seed_admin_and_actor_credentials_required");
invariant(Boolean(emailDomain && !emailDomain.endsWith("circlebites.in")), "seed_synthetic_email_domain_required");

const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const expectedEmails = Array.from({ length: counts.users }, (_, index) => `${config.seed.emailPrefix}${String(index).padStart(4, "0")}@${emailDomain}`);

async function listAllUsers() {
  const users = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("seed_auth_user_list_failed");
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

let existing = await listAllUsers();
const byEmail = new Map(existing.map((user) => [user.email?.toLowerCase(), user]));
const missing = expectedEmails.filter((email) => !byEmail.has(email));
for (let offset = 0; offset < missing.length; offset += 10) {
  const batch = missing.slice(offset, offset + 10);
  await Promise.all(batch.map(async (email) => {
    const index = expectedEmails.indexOf(email);
    const { error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
      user_metadata: { synthetic_load_fixture: true, username: `load9_${String(index).padStart(4, "0")}` }
    });
    if (error) throw new Error("seed_auth_user_create_failed");
  }));
}

existing = await listAllUsers();
const createdByEmail = new Map(existing.map((user) => [user.email?.toLowerCase(), user]));
const identities = expectedEmails.map((email) => {
  const user = createdByEmail.get(email);
  invariant(Boolean(user?.id), "seed_auth_identity_missing");
  return { email, id: user.id };
});
const plan = buildSeedPlan(config, identities, scale);

async function upsertBatches(table, rows, onConflict = "id") {
  for (let offset = 0; offset < rows.length; offset += 500) {
    const { error } = await admin.from(table).upsert(rows.slice(offset, offset + 500), { ignoreDuplicates: false, onConflict });
    if (error) throw new Error(`seed_table_failed:${table}`);
  }
}

await upsertBatches("profiles", plan.rows.profiles.map((profile) => ({
  ...profile,
  account_status: "active",
  deletion_started_at: null
})));
await upsertBatches("circle_memberships", plan.rows.circleMemberships);
await upsertBatches("blocked_users", plan.rows.blocks);
await upsertBatches("reviews", plan.rows.reviews);
await upsertBatches("likes", plan.rows.likes);
await upsertBatches("wishlist", plan.rows.bookmarks);
await upsertBatches("recommendation_feedback", plan.rows.reactions);
await upsertBatches("comments", plan.rows.comments);
await upsertBatches("notifications", plan.rows.notifications);
await upsertBatches("post_views", plan.rows.postViews, "user_id,post_id");
await upsertBatches("shared_memory_rooms", plan.rows.rooms);
await upsertBatches("shared_memory_members", plan.rows.roomMembers);
await upsertBatches("shared_memory_messages", plan.rows.roomMessages);
await upsertBatches("shared_memory_dishes", plan.rows.memoryDishes);
await upsertBatches("review_dish_mentions", plan.rows.dishMentions);
await upsertBatches("content_reports", plan.rows.contentReports);
// Freeze deletion fixtures only after their representative owned data exists.
// This preserves the same no-new-writes invariant exercised in production.
await upsertBatches("profiles", plan.rows.profiles);
await upsertBatches("account_deletion_jobs", plan.rows.accountDeletionJobs);

const insertedCounts = {
  users: identities.length,
  profiles: plan.rows.profiles.length,
  circleMemberships: plan.rows.circleMemberships.length,
  blocks: plan.rows.blocks.length,
  posts: plan.rows.reviews.length,
  likes: plan.rows.likes.length,
  bookmarks: plan.rows.bookmarks.length,
  reactions: plan.rows.reactions.length,
  comments: plan.rows.comments.length,
  notifications: plan.rows.notifications.length,
  postViews: plan.rows.postViews.length,
  memoryRooms: plan.rows.rooms.length,
  memoryMemberships: plan.rows.roomMembers.length,
  memoryMessages: plan.rows.roomMessages.length,
  memoryDishes: plan.rows.memoryDishes.length,
  places: new Set(plan.rows.reviews.map((row) => row.restaurant_id)).size,
  dishMentions: plan.rows.dishMentions.length,
  contentReports: plan.rows.contentReports.length,
  accountDeletionJobs: plan.rows.accountDeletionJobs.length
};
const deferredCounts = Object.fromEntries(["imagePosts", "videoPosts", "roomMedia", "mediaUploads"].map((key) => [key, plan.counts[key]]));

await mkdir(resultDirectory, { recursive: true });
const actorFile = new URL("actors.json", resultDirectory);
await writeFile(actorFile, `${JSON.stringify(plan.actors, null, 2)}\n`, { mode: 0o600 });
const result = {
  schemaVersion: config.harness.resultSchemaVersion,
  harness: config.harness,
  environment: target,
  release: { api: target.apiRelease, worker: target.workerRelease },
  migrationHead: target.migrationHead,
  scenario: "seed",
  startedAt,
  completedAt: new Date().toISOString(),
  durationSeconds: Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 1000)),
  metrics: { plannedCounts: plan.counts, insertedCounts, deferredCounts, actors: plan.actors.length },
  thresholds: { exactDatabaseCountsRequired: true, mediaPopulationRequiredSeparately: true },
  thresholdFailures: [],
  correctness: { violations: 0 },
  storageFixtureStatus: "pending real Storage population through load:media",
  capacityConclusion: "NOT PROVEN — seed completion is not capacity evidence"
};
const resultFile = await writeResult(result, "seed");
console.log(JSON.stringify({ actorFile: "load-results/actors.json", resultFile, status: "seeded", storageFollowUp: `npm run load:media -- --tier=launch --total=${counts.mediaUploads}` }, null, 2));
