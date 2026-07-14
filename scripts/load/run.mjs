#!/usr/bin/env node
import {
  MetricRegistry,
  ExternalSafetyMonitor,
  actorHeaders,
  argument,
  assertNodeRuntime,
  authenticateActors,
  capacityConclusion,
  deterministicRandom,
  evaluateThresholds,
  hasFlag,
  invariant,
  loadActorDefinitions,
  loadCapacityConfig,
  safeRunId,
  safeTargetMetadata,
  timedRequest,
  weightedChoice,
  writeResult
} from "./lib.mjs";

const config = await loadCapacityConfig();
const scenario = argument("scenario", "smoke");
const tier = config.tiers[scenario];
invariant(Boolean(tier), `load_scenario_unknown:${scenario}`);

const durationSeconds = Number(argument("duration", tier.durationSeconds));
const concurrentUsers = Number(argument("concurrency", tier.concurrentUsers));
invariant(Number.isInteger(durationSeconds) && durationSeconds > 0 && durationSeconds <= config.safety.maxRunSeconds, "load_duration_out_of_bounds");
invariant(Number.isInteger(concurrentUsers) && concurrentUsers > 0 && concurrentUsers <= config.safety.maxConcurrentUsers, "load_concurrency_out_of_bounds");

if (hasFlag("dry-run")) {
  console.log(JSON.stringify({
    capacityClaim: false,
    concurrentUsers,
    durationSeconds,
    scenario,
    status: "dry-run",
    tier
  }, null, 2));
  process.exit(0);
}

assertNodeRuntime(config);
const target = safeTargetMetadata(config);
const apiBase = process.env.LOAD_STAGING_API_URL.replace(/\/$/, "");
const supabaseBase = process.env.LOAD_STAGING_SUPABASE_URL.replace(/\/$/, "");
const anonKey = process.env.LOAD_STAGING_SUPABASE_ANON_KEY;
invariant(Boolean(anonKey), "load_supabase_anon_key_required");

const definitions = await loadActorDefinitions();
const eligibleDefinitions = definitions.filter((actor) => actor.loadEligible !== false);
const actors = await authenticateActors(eligibleDefinitions, concurrentUsers);
const frozenDefinition = definitions.find((actor) => actor.frozenFixture);
const frozenActor = frozenDefinition ? (await authenticateActors([frozenDefinition], 1))[0] : null;
const metrics = new MetricRegistry();
const actorRequestCounts = new Map(actors.map((actor) => [actor.username, 0]));
const runId = safeRunId();
const safety = new ExternalSafetyMonitor(config, { runId, scenario });
const startedAt = new Date().toISOString();
const deadline = Date.now() + durationSeconds * 1000;
const maximumIterations = tier.maxIterationsPerUser ?? Number.POSITIVE_INFINITY;
let abortReason = null;

async function checkSafetyAbort(force = false) {
  if (metrics.correctness.length > 0) abortReason = "correctness_violation";
  if (metrics.totalRequests >= 50 && metrics.unexpectedErrorRate() > config.safety.abort.unexpectedErrorRate) {
    abortReason = "unexpected_error_rate";
  }
  const externalAbort = await safety.poll(force);
  if (externalAbort) abortReason = externalAbort;
}

function actorPost(actor) {
  const postId = actor.postIds[0];
  if (!postId) metrics.violation("actor_missing_post_id");
  return postId;
}

function actorRoom(actor) {
  const roomId = actor.roomIds[0];
  if (!roomId) metrics.violation("actor_missing_room_id");
  return roomId;
}

function engagementPost(actor) {
  const postId = actor.engagementPostIds[0];
  if (!postId) metrics.violation("actor_missing_engagement_post_id");
  return postId;
}

async function apiRequest(group, actor, path, options = {}) {
  actorRequestCounts.set(actor.username, (actorRequestCounts.get(actor.username) ?? 0) + 1);
  return timedRequest(metrics, group, `${apiBase}${path}`, {
    ...options,
    headers: actorHeaders(actor, {
      "X-CircleBites-Load-Run": runId,
      ...options.headers
    })
  });
}

async function actorRequest(group, actor, url, options = {}) {
  actorRequestCounts.set(actor.username, (actorRequestCounts.get(actor.username) ?? 0) + 1);
  return timedRequest(metrics, group, url, options);
}

async function authScenario(actor, random) {
  await apiRequest("auth-session", actor, "/api/mobile/auth/account-status");
  if (actor.refreshToken && random() < 0.05) {
    await actorRequest("auth-refresh", actor, `${supabaseBase}/auth/v1/token?grant_type=refresh_token`, {
      body: JSON.stringify({ refresh_token: actor.refreshToken }),
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      method: "POST"
    });
  }
  if (random() < 0.02) {
    await actorRequest("auth-invalid", actor, `${apiBase}/api/mobile/auth/account-status`, {
      expectedStatuses: [401],
      headers: { Authorization: "Bearer invalid-load-token", "X-CircleBites-Load-Run": runId }
    });
  }
  if (frozenActor && random() < 0.02) {
    const frozenStatus = await apiRequest("auth-frozen-status", frozenActor, "/api/mobile/auth/account-status");
    if (frozenStatus.payload?.status !== "deleting") metrics.violation("frozen_account_status_not_deleting");
    await apiRequest("auth-frozen-denial", frozenActor, "/api/mobile/profile/shell", { expectedStatuses: [401, 409] });
  }
}

async function circleScenario(actor) {
  const first = await apiRequest("circle-feed", actor, "/api/feed/circle?limit=24");
  const blockedNames = new Set(actor.blockedUsernames);
  if ((first.payload?.posts ?? []).some((post) => blockedNames.has(post.reviewerName ?? post.reviewer_name))) {
    metrics.violation("circle_blocked_actor_visible");
  }
  const cursor = first.payload?.nextCursorString;
  if (cursor) {
    const second = await apiRequest("circle-feed-page2", actor, `/api/feed/circle?limit=24&cursor=${encodeURIComponent(cursor)}`);
    const firstIds = new Set((first.payload?.posts ?? []).map((post) => post.id));
    if ((second.payload?.posts ?? []).some((post) => firstIds.has(post.id))) metrics.violation("circle_cursor_duplicate");
    if ((second.payload?.posts ?? []).some((post) => blockedNames.has(post.reviewerName ?? post.reviewer_name))) {
      metrics.violation("circle_blocked_actor_visible");
    }
  }
  await apiRequest("circle-feed-refresh", actor, "/api/feed/circle?limit=24&refresh=1", { headers: { "Cache-Control": "no-cache" } });
}

async function exploreScenario(actor) {
  await actorRequest("explore-rpc", actor, `${supabaseBase}/rest/v1/rpc/explore_discovery_canonical_v3`, {
    body: JSON.stringify({ p_lat: 12.9716, p_lng: 77.5946, p_limit: 24 }),
    headers: { apikey: anonKey, Authorization: `Bearer ${actor.accessToken}`, "Content-Type": "application/json", "X-CircleBites-Load-Run": runId },
    method: "POST"
  });
}

async function restaurantDishScenario(actor) {
  const placeId = actor.placeIds[0] ?? "load9-place-0001";
  await apiRequest("restaurant-feed", actor, `/api/mobile/feed?scope=restaurant&placeId=${encodeURIComponent(placeId)}&limit=24`);
  await apiRequest("dish-feed", actor, "/api/mobile/feed?scope=dish&dishName=masala%20dosa&limit=24");
}

async function profileScenario(actor) {
  await apiRequest("profile-shell", actor, "/api/mobile/profile/shell");
  await apiRequest("profile-posts", actor, `/api/mobile/feed?scope=profile&profileName=${encodeURIComponent(actor.username)}&limit=24`);
  if (actor.otherUsername) {
    await actorRequest("other-profile", actor, `${supabaseBase}/rest/v1/profiles?username=eq.${encodeURIComponent(actor.otherUsername)}&select=id,username,first_name,last_name,account_type,bio&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${actor.accessToken}`, "X-CircleBites-Load-Run": runId }
    });
    await apiRequest("other-profile-posts", actor, `/api/mobile/feed?scope=profile&profileName=${encodeURIComponent(actor.otherUsername)}&limit=24`);
    await actorRequest("other-profile-stats", actor, `${supabaseBase}/rest/v1/rpc/profile_post_stats`, {
      body: JSON.stringify({ p_username: actor.otherUsername }),
      headers: { apikey: anonKey, Authorization: `Bearer ${actor.accessToken}`, "Content-Type": "application/json", "X-CircleBites-Load-Run": runId },
      method: "POST"
    });
  }
  const liked = await apiRequest("liked-posts", actor, "/api/me/liked?limit=24");
  if (liked.payload?.nextCursor) await apiRequest("liked-posts-page2", actor, `/api/me/liked?limit=24&cursor=${encodeURIComponent(liked.payload.nextCursor)}`);
  const saved = await apiRequest("saved-posts", actor, "/api/me/saved?limit=24");
  if (saved.payload?.nextCursor) await apiRequest("saved-posts-page2", actor, `/api/me/saved?limit=24&cursor=${encodeURIComponent(saved.payload.nextCursor)}`);
}

async function commentsScenario(actor, random) {
  const blockedPostId = actor.blockedPostIds[0];
  if (blockedPostId) {
    await apiRequest("comments-blocked-denial", actor, `/api/comments?postId=${blockedPostId}&limit=1`, { expectedStatuses: [403, 404] });
  }
  const postId = actorPost(actor);
  if (!postId) return;
  const first = await apiRequest("comments", actor, `/api/comments?postId=${postId}&limit=30`);
  if (first.payload?.nextCursor) {
    await apiRequest("comments-page2", actor, `/api/comments?postId=${postId}&limit=30&cursor=${encodeURIComponent(first.payload.nextCursor)}`);
  }
  if (random() < 0.15) {
    const created = await apiRequest("comment-create", actor, "/api/comments", {
      body: JSON.stringify({ content: `Synthetic load comment ${runId.slice(0, 8)}`, postId }),
      method: "POST"
    });
    if (created.payload?.id) {
      await apiRequest("comment-delete", actor, `/api/comments/${created.payload.id}`, { method: "DELETE" });
    }
  }
  const foreignCommentId = actor.foreignCommentIds[0];
  if (foreignCommentId && random() < 0.1) {
    await apiRequest("comment-foreign-delete-denial", actor, `/api/comments/${foreignCommentId}`, { expectedStatuses: [403], method: "DELETE" });
  }
}

async function notificationsScenario(actor, random) {
  const list = await apiRequest("notifications", actor, "/api/notifications?limit=30");
  await apiRequest("notification-unread", actor, "/api/notifications/unread-count");
  const unread = (list.payload?.notifications ?? []).find((notification) => (notification.is_read ?? notification.read) === false);
  if (unread?.id && random() < 0.1) {
    await apiRequest("notification-mark-read", actor, `/api/notifications/${unread.id}/read`, { method: "PATCH" });
  }
}

async function memoryRoomsScenario(actor) {
  await apiRequest("memory-room-list", actor, "/api/mobile/memories/read?action=rooms&limit=50");
  const roomId = actorRoom(actor);
  if (roomId) await apiRequest("memory-room-detail", actor, `/api/mobile/memories/read?action=detail&roomId=${roomId}&limit=50`);
}

async function memoryChatScenario(actor) {
  const roomId = actorRoom(actor);
  if (!roomId) return;
  const first = await apiRequest("memory-chat", actor, `/api/mobile/memories/read?action=chat&roomId=${roomId}&limit=50`);
  if (first.payload?.nextCursor) {
    await apiRequest("memory-chat-page2", actor, `/api/mobile/memories/read?action=chat&roomId=${roomId}&limit=50&cursor=${encodeURIComponent(first.payload.nextCursor)}`);
  }
  await apiRequest("memory-media", actor, `/api/mobile/memories/read?action=media&roomId=${roomId}&limit=30`);
}

async function mutationScenario(actor, random) {
  const postId = engagementPost(actor);
  if (!postId) return;
  await apiRequest("post-view", actor, "/api/post-views", {
    body: JSON.stringify({ postIds: [postId] }),
    expectedStatuses: [200],
    method: "POST"
  });
  const action = Math.floor(random() * 3);
  if (action === 0) {
    await apiRequest("like-create", actor, "/api/likes", { body: JSON.stringify({ postId }), method: "POST" });
    await apiRequest("like-delete", actor, "/api/likes", { body: JSON.stringify({ postId }), method: "DELETE" });
  } else if (action === 1) {
    const body = JSON.stringify({ postId, restaurantName: "Synthetic Load Restaurant" });
    await apiRequest("bookmark-create", actor, "/api/wishlist", { body, method: "POST" });
    await apiRequest("bookmark-delete", actor, "/api/wishlist", { body, method: "DELETE" });
  } else {
    await apiRequest("reaction-create", actor, "/api/recommendation-feedback", {
      body: JSON.stringify({ feedbackLabel: random() < 0.8 ? "Helpful" : "Disagree", postId }),
      method: "POST"
    });
    await apiRequest("reaction-delete", actor, `/api/recommendation-feedback?postId=${postId}`, { method: "DELETE" });
  }
}

async function mediaIntentScenario(actor) {
  const roomId = actorRoom(actor);
  if (!roomId) return;
  await apiRequest("media-intent", actor, "/api/mobile/memories/upload-intent", {
    body: JSON.stringify({
      durationMs: null,
      fileName: `load-${runId}.jpg`,
      fileSizeBytes: 631,
      height: 1,
      mediaKind: "image",
      mimeType: "image/jpeg",
      roomId,
      width: 1
    }),
    method: "POST"
  });
}

const scenarioFunctions = {
  auth: authScenario,
  circle: circleScenario,
  explore: exploreScenario,
  restaurantDish: restaurantDishScenario,
  profile: profileScenario,
  comments: commentsScenario,
  notifications: notificationsScenario,
  memoryRooms: memoryRoomsScenario,
  memoryChat: memoryChatScenario,
  mutations: mutationScenario,
  mediaIntent: mediaIntentScenario
};

async function iteration(actor, random) {
  const selected = weightedChoice(config.launchModel.scenarioWeights, random);
  await scenarioFunctions[selected](actor, random);
}

async function runClosed() {
  const sessionSeconds = config.launchModel.sessionDurationMinutes * 60;
  const targetRequestsPerActor = Math.max(1, Math.ceil(config.launchModel.requestsPerSession * durationSeconds / sessionSeconds));
  await Promise.all(actors.map(async (actor, index) => {
    const random = deterministicRandom(`${runId}:${index}`);
    let iterations = 0;
    while (
      Date.now() < deadline &&
      iterations < maximumIterations &&
      (scenario === "smoke" || (actorRequestCounts.get(actor.username) ?? 0) < targetRequestsPerActor) &&
      !abortReason
    ) {
      await iteration(actor, random);
      await checkSafetyAbort();
      iterations += 1;
      if (scenario !== "smoke" && !abortReason) {
        const completedRequests = actorRequestCounts.get(actor.username) ?? 0;
        const nextDueAt = Date.parse(startedAt) + Math.min(1, completedRequests / targetRequestsPerActor) * durationSeconds * 1000;
        const waitMs = Math.min(Math.max(0, nextDueAt - Date.now()), Math.max(0, deadline - Date.now()));
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }));
}

async function runArrival() {
  const rate = Number(tier.arrivalRatePerSecond);
  invariant(Number.isFinite(rate) && rate > 0, "load_arrival_rate_invalid");
  const active = new Set();
  let cursor = 0;
  const intervalMs = 1000 / rate;
  while (Date.now() < deadline && !abortReason) {
    if (active.size < concurrentUsers) {
      const actor = actors[cursor % actors.length];
      const random = deterministicRandom(`${runId}:arrival:${cursor}`);
      const task = iteration(actor, random).then(checkSafetyAbort).finally(() => active.delete(task));
      active.add(task);
      cursor += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  await Promise.all(active);
}

const health = await timedRequest(metrics, "release-health", `${apiBase}/api/health`, {
  headers: { "X-CircleBites-Load-Run": runId }
});
if (health.payload?.release && health.payload.release !== target.apiRelease) metrics.violation("api_release_mismatch");
await checkSafetyAbort(true);
if (tier.mode === "arrival") await runArrival();
else await runClosed();
await checkSafetyAbort(true);

const metricSummary = metrics.summary();
const thresholds = config.thresholds[tier.thresholdProfile];
const thresholdFailures = evaluateThresholds(metricSummary, thresholds, metrics.correctness.length);
const actorRequestValues = actors.map((actor) => actorRequestCounts.get(actor.username) ?? 0);
const targetRequestsPerActor = tier.mode === "closed" && scenario !== "smoke"
  ? Math.max(1, Math.ceil(config.launchModel.requestsPerSession * durationSeconds / (config.launchModel.sessionDurationMinutes * 60)))
  : null;
if (targetRequestsPerActor !== null && Math.min(...actorRequestValues) < targetRequestsPerActor) {
  thresholdFailures.push(`request_model_incomplete:${Math.min(...actorRequestValues)}<${targetRequestsPerActor}`);
}
if (abortReason) thresholdFailures.push(`safety_abort:${abortReason}`);
const actualDurationSeconds = Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 1000));
const result = {
  schemaVersion: config.harness.resultSchemaVersion,
  harness: config.harness,
  runId,
  environment: target,
  release: { api: target.apiRelease, worker: target.workerRelease },
  migrationHead: target.migrationHead,
  scenario,
  workload: {
    ...tier,
    concurrentUsers,
    requestedDurationSeconds: durationSeconds,
    targetRequestsPerActor,
    actualActorRequests: {
      minimum: Math.min(...actorRequestValues),
      maximum: Math.max(...actorRequestValues),
      total: actorRequestValues.reduce((sum, value) => sum + value, 0)
    }
  },
  startedAt,
  completedAt: new Date().toISOString(),
  durationSeconds: actualDurationSeconds,
  metrics: metricSummary,
  safetyTelemetry: safety.summary(),
  thresholds,
  thresholdFailures,
  correctness: { violations: metrics.correctness.length, codes: [...new Set(metrics.correctness)], safetyAbort: abortReason },
  capacityConclusion: capacityConclusion(false)
};
const resultFile = await writeResult(result, scenario);
console.log(JSON.stringify({ resultFile, scenario, thresholdFailures: thresholdFailures.length, status: thresholdFailures.length ? "failed" : "passed" }, null, 2));
if (thresholdFailures.length) process.exitCode = 2;
