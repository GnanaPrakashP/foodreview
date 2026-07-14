#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  argument,
  ExternalSafetyMonitor,
  assertNodeRuntime,
  authenticateActors,
  capacityConclusion,
  invariant,
  loadActorDefinitions,
  loadCapacityConfig,
  percentile,
  safeRunId,
  safeTargetMetadata,
  writeResult
} from "./lib.mjs";

const config = await loadCapacityConfig();
assertNodeRuntime(config);
const target = safeTargetMetadata(config);
const tierName = argument("tier", "launch");
const tier = config.tiers[tierName];
invariant(Boolean(tier), `realtime_tier_unknown:${tierName}`);
const roomTarget = Number(argument("rooms", tier.activeMemoryRooms));
invariant(Number.isInteger(roomTarget) && roomTarget > 0 && roomTarget <= config.tiers.stress.activeMemoryRooms, "realtime_room_target_invalid");

const definitions = (await loadActorDefinitions()).filter((actor) => actor.loadEligible !== false);
const eligible = definitions.filter((actor) => actor.roomIds.length > 0);
const distinctRooms = [...new Set(eligible.flatMap((actor) => actor.roomIds))].slice(0, roomTarget);
invariant(distinctRooms.length === roomTarget, `realtime_room_fixtures_insufficient:${distinctRooms.length}<${roomTarget}`);
const selectedDefinitions = eligible.filter((actor) => actor.roomIds.some((roomId) => distinctRooms.includes(roomId)));
const actors = await authenticateActors(selectedDefinitions, selectedDefinitions.length);
const supabaseUrl = process.env.LOAD_STAGING_SUPABASE_URL;
const anonKey = process.env.LOAD_STAGING_SUPABASE_ANON_KEY;
invariant(Boolean(anonKey), "realtime_anon_key_required");

const runId = safeRunId();
const safety = new ExternalSafetyMonitor(config, { runId, scenario: "realtime" });
const startedAt = new Date().toISOString();
const subscribeMs = [];
const reconnectMs = [];
const reconnectReconciliationMs = [];
const deliveryMs = [];
const writeMs = [];
const deliveries = new Map();
const expectedMessages = new Map();
const lastSequences = new Map();
const clients = [];
const channels = [];
let subscriptionFailures = 0;
let unauthorizedDeliveries = 0;
let messageOrderViolations = 0;
let reconnectReconciliationMisses = 0;
let postReconnectMissedDeliveries = 0;
await safety.poll(true);
invariant(!safety.abortReason, `safety_abort:${safety.abortReason}`);

function clientFor(actor) {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${actor.accessToken}`, "X-CircleBites-Load-Run": runId } },
    realtime: { params: { eventsPerSecond: 20 } }
  });
  client.realtime.setAuth(actor.accessToken);
  clients.push(client);
  return client;
}

function subscribe(client, actor, roomId, reconnect = false) {
  const started = performance.now();
  const channel = client
    .channel(`load9:${runId}:${actor.username}:${roomId}:${reconnect ? "reconnect" : "initial"}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "shared_memory_messages", filter: `room_id=eq.${roomId}` }, (event) => {
      const id = event.new?.id;
      if (!id || !expectedMessages.has(id)) return;
      const expected = expectedMessages.get(id);
      if (!actor.roomIds.includes(roomId)) unauthorizedDeliveries += 1;
      const key = `${actor.username}:${id}`;
      deliveries.set(key, (deliveries.get(key) ?? 0) + 1);
      const orderKey = `${actor.username}:${roomId}`;
      const priorSequence = lastSequences.get(orderKey) ?? -1;
      if (expected.sequence <= priorSequence) messageOrderViolations += 1;
      lastSequences.set(orderKey, expected.sequence);
      deliveryMs.push(Math.max(0, Date.now() - expected.sentAt));
    });
  channels.push(channel);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      subscriptionFailures += 1;
      resolve(channel);
    }, 10000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        (reconnect ? reconnectMs : subscribeMs).push(performance.now() - started);
        resolve(channel);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        subscriptionFailures += 1;
        resolve(channel);
      }
    });
  });
}

const actorClients = new Map(actors.map((actor) => [actor.username, clientFor(actor)]));
const initialSubscriptions = [];
for (const actor of actors) {
  for (const roomId of actor.roomIds.filter((value) => distinctRooms.includes(value))) {
    initialSubscriptions.push(subscribe(actorClients.get(actor.username), actor, roomId));
  }
  for (const forbiddenRoom of (actor.forbiddenRoomIds ?? []).filter((value) => distinctRooms.includes(value))) {
    initialSubscriptions.push(subscribe(actorClients.get(actor.username), actor, forbiddenRoom));
  }
}
await Promise.all(initialSubscriptions);
await safety.poll();

const inserted = [];
const messagesPerRoom = Number(argument("messages-per-room", config.launchModel.messagesPerActiveRoomPerMinute));
invariant(Number.isInteger(messagesPerRoom) && messagesPerRoom > 0 && messagesPerRoom <= 20, "realtime_messages_per_room_invalid");
for (const roomId of distinctRooms) {
  if (safety.abortReason) break;
  const sender = actors.find((actor) => actor.roomIds.includes(roomId));
  invariant(Boolean(sender), `realtime_room_sender_missing:${roomId}`);
  for (let sequence = 0; sequence < messagesPerRoom; sequence += 1) {
    const id = randomUUID();
    const sentAt = Date.now();
    expectedMessages.set(id, { roomId, sentAt, sequence });
    const { error } = await actorClients.get(sender.username)
      .from("shared_memory_messages")
      .insert({ id, room_id: roomId, author_name: sender.username, body: `load-validation-${runId}-${sequence}` });
    writeMs.push(Date.now() - sentAt);
    if (error) subscriptionFailures += 1;
    else inserted.push({ id, roomId, sender, sequence });
    await safety.poll();
  }
}

await new Promise((resolve) => setTimeout(resolve, 3000));
const expectedDeliveryCount = inserted.reduce((total, message) =>
  total + actors.filter((actor) => actor.roomIds.includes(message.roomId)).length, 0);
const uniqueDeliveryCount = [...deliveries.values()].filter((count) => count > 0).length;
const duplicateDeliveries = [...deliveries.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
const missedDeliveries = Math.max(0, expectedDeliveryCount - uniqueDeliveryCount);

let reconnectSequence = messagesPerRoom;
for (const actor of actors.slice(0, Math.min(5, actors.length))) {
  const roomId = actor.roomIds.find((value) => distinctRooms.includes(value));
  if (!roomId) continue;
  const client = actorClients.get(actor.username);
  const original = channels.find((channel) => channel.topic.includes(actor.username) && channel.topic.includes(roomId));
  if (original) await client.removeChannel(original);
  await subscribe(client, actor, roomId, true);

  const expectedRoomIds = inserted.filter((message) => message.roomId === roomId).map((message) => message.id);
  const reconcileStarted = performance.now();
  const reconciliation = await client.from("shared_memory_messages").select("id").eq("room_id", roomId).in("id", expectedRoomIds);
  reconnectReconciliationMs.push(performance.now() - reconcileStarted);
  if (reconciliation.error) subscriptionFailures += 1;
  const reconciledIds = new Set((reconciliation.data ?? []).map((row) => row.id));
  reconnectReconciliationMisses += expectedRoomIds.filter((id) => !reconciledIds.has(id)).length;

  const id = randomUUID();
  const sentAt = Date.now();
  expectedMessages.set(id, { roomId, sentAt, sequence: reconnectSequence });
  reconnectSequence += 1;
  const postReconnectWrite = await client.from("shared_memory_messages")
    .insert({ id, room_id: roomId, author_name: actor.username, body: `load-reconnect-${runId}-${reconnectSequence}` });
  writeMs.push(Date.now() - sentAt);
  if (postReconnectWrite.error) subscriptionFailures += 1;
  else {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!deliveries.has(`${actor.username}:${id}`)) postReconnectMissedDeliveries += 1;
  }
  await safety.poll();
}

for (const channel of channels) await channel.unsubscribe().catch(() => undefined);
for (const client of clients) client.removeAllChannels();
await safety.poll(true);

const thresholds = config.thresholds[tier.thresholdProfile];
const missRate = expectedDeliveryCount ? missedDeliveries / expectedDeliveryCount : 1;
const duplicateRate = expectedDeliveryCount ? duplicateDeliveries / expectedDeliveryCount : 0;
const thresholdFailures = [];
if (percentile(subscribeMs, 0.95) > thresholds.realtimeSubscribeP95Ms) thresholdFailures.push("realtime_subscribe_p95");
if (percentile(deliveryMs, 0.95) > thresholds.realtimeDeliveryP95Ms) thresholdFailures.push("realtime_delivery_p95");
if (percentile(reconnectMs, 0.95) > thresholds.realtimeSubscribeP95Ms) thresholdFailures.push("realtime_reconnect_p95");
if (missRate > thresholds.realtimeMissRate) thresholdFailures.push("realtime_miss_rate");
if (duplicateRate > thresholds.realtimeDuplicateRate) thresholdFailures.push("realtime_duplicate_rate");
if (subscriptionFailures) thresholdFailures.push("realtime_subscription_failures");
if (unauthorizedDeliveries) thresholdFailures.push("realtime_unauthorized_delivery");
if (messageOrderViolations) thresholdFailures.push("realtime_message_order");
if (reconnectReconciliationMisses) thresholdFailures.push("realtime_reconciliation_miss");
if (postReconnectMissedDeliveries) thresholdFailures.push("realtime_post_reconnect_delivery_miss");
if (safety.abortReason) thresholdFailures.push(`safety_abort:${safety.abortReason}`);

const result = {
  schemaVersion: config.harness.resultSchemaVersion,
  harness: config.harness,
  runId,
  environment: target,
  release: { api: target.apiRelease, worker: target.workerRelease },
  migrationHead: target.migrationHead,
  scenario: "realtime",
  workload: { tier: tierName, activeRooms: distinctRooms.length },
  startedAt,
  completedAt: new Date().toISOString(),
  durationSeconds: Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 1000)),
  metrics: {
    activeRooms: distinctRooms.length,
    connections: clients.length,
    subscriptions: subscribeMs.length,
    subscriptionFailures,
    subscribeP95Ms: percentile(subscribeMs, 0.95),
    deliveryP95Ms: percentile(deliveryMs, 0.95),
    writeP95Ms: percentile(writeMs, 0.95),
    reconnectP95Ms: percentile(reconnectMs, 0.95),
    reconnectReconciliationP95Ms: percentile(reconnectReconciliationMs, 0.95),
    reconnectReconciliationMisses,
    postReconnectMissedDeliveries,
    expectedDeliveries: expectedDeliveryCount,
    missedDeliveries,
    duplicateDeliveries,
    unauthorizedDeliveries,
    messageOrderViolations,
    missRate,
    duplicateRate
  },
  thresholds,
  safetyTelemetry: safety.summary(),
  thresholdFailures,
  correctness: {
    violations: unauthorizedDeliveries + missedDeliveries + duplicateDeliveries + messageOrderViolations + reconnectReconciliationMisses + postReconnectMissedDeliveries
  },
  capacityConclusion: capacityConclusion(false)
};
const resultFile = await writeResult(result, "realtime");
console.log(JSON.stringify({ resultFile, thresholdFailures: thresholdFailures.length, status: thresholdFailures.length ? "failed" : "passed" }, null, 2));
if (thresholdFailures.length) process.exitCode = 2;
