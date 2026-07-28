import assert from "node:assert/strict";
import test from "node:test";
import {
  configureMemoryRoomJourneyDiagnostics,
  createMemoryRoomRequestCoordinator,
  createMemoryRoomJourneySession,
  createMemoryRoomJourneyState,
  memoryRoomJourneySnapshot,
  recordMemoryRoomJourney,
  reduceMemoryRoomJourney,
  resetMemoryRoomJourneyDiagnostics
} from "../mobile/src/services/memoryRoomJourneyDiagnostics.mjs";

function runJourney(roomSessionId, events) {
  return events.reduce(
    (state, event) => reduceMemoryRoomJourney(state, { roomSessionId, ...event }),
    createMemoryRoomJourneyState(roomSessionId)
  );
}

test.beforeEach(() => {
  resetMemoryRoomJourneyDiagnostics();
  configureMemoryRoomJourneyDiagnostics({ enabled: true, sink: () => {} });
});

test("Journey A reaches every room surface and exits with no live resource owner", () => {
  const roomSessionId = "journey-a-room";
  const final = runJourney(roomSessionId, [
    { action: "ROOM_SCREEN_MOUNT", tab: "overview" },
    { action: "LOCAL_SNAPSHOT_RENDERED", tab: "overview" },
    { action: "SERVER_REFRESH_STARTED", tab: "overview" },
    { action: "REALTIME_SUBSCRIBED", tab: "overview" },
    { action: "SERVER_REFRESH_APPLIED", tab: "overview" },
    { action: "TAB_USABLE", tab: "media" },
    { action: "MEDIA_VIEWER_OPENED", tab: "media" },
    { action: "PLAYER_CREATED", playerKind: "video", tab: "media" },
    { action: "PLAYER_RELEASED", playerKind: "video", tab: "media" },
    { action: "MEDIA_VIEWER_CLOSED", tab: "media" },
    { action: "TAB_USABLE", tab: "dishes" },
    { action: "DISH_MUTATION_STARTED", tab: "dishes" },
    { action: "DISH_MUTATION_FINISHED", tab: "dishes" },
    { action: "TAB_USABLE", tab: "chat" },
    { action: "MESSAGE_OPTIMISTIC", tab: "chat" },
    { action: "MESSAGE_CONFIRMED", tab: "chat" },
    { action: "REPLY_OPENED", tab: "chat" },
    { action: "MESSAGE_OPTIMISTIC", tab: "chat" },
    { action: "MESSAGE_CONFIRMED", tab: "chat" },
    { action: "TAB_USABLE", tab: "overview" },
    { action: "ROOM_EXIT_STARTED", tab: "overview" },
    { action: "REALTIME_UNSUBSCRIBED", tab: "overview" },
    { action: "ROOM_EXIT_FINISHED", tab: "overview" }
  ]);

  assert.equal(final.active, false);
  assert.equal(final.activeTab, "overview");
  assert.equal(final.pendingDurableWork, 0);
  assert.equal(final.playerCount, 0);
  assert.equal(final.realtimeChannelCount, 0);
  assert.equal(final.replyOpen, false);
  assert.equal(final.screenState, "unmounted");
});

test("Journey C preserves durable pending work across exit and clears transient reply/player state", () => {
  const roomSessionId = "journey-c-room";
  const exited = runJourney(roomSessionId, [
    { action: "ROOM_SCREEN_MOUNT", tab: "chat" },
    { action: "LOCAL_SNAPSHOT_RENDERED", tab: "chat" },
    { action: "REALTIME_SUBSCRIBED", tab: "chat" },
    { action: "MESSAGE_OPTIMISTIC", tab: "chat" },
    { action: "REPLY_OPENED", tab: "chat" },
    { action: "PLAYER_CREATED", playerKind: "audio", tab: "chat" },
    { action: "ROOM_EXIT_STARTED", tab: "chat" },
    { action: "ROOM_EXIT_FINISHED", tab: "chat" }
  ]);

  assert.equal(exited.pendingDurableWork, 1, "durable outbox work must survive route exit");
  assert.equal(exited.replyOpen, false);
  assert.equal(exited.playerCount, 0);
  assert.equal(exited.keyboardState, "closed");
});

test("failure injection keeps cached content usable and isolates failed operations", () => {
  const roomSessionId = "journey-failure-room";
  const degraded = runJourney(roomSessionId, [
    { action: "ROOM_SCREEN_MOUNT", tab: "overview" },
    { action: "LOCAL_SNAPSHOT_RENDERED", tab: "overview" },
    { action: "SERVER_REFRESH_STARTED", tab: "overview" },
    { action: "SERVER_REFRESH_FAILED", tab: "overview" },
    { action: "TAB_USABLE", tab: "chat" },
    { action: "MESSAGE_OPTIMISTIC", tab: "chat" },
    { action: "MESSAGE_FAILED", tab: "chat" },
    { action: "TAB_USABLE", tab: "media" }
  ]);

  assert.equal(degraded.cachedContentUsable, true);
  assert.equal(degraded.queryState, "degraded_usable");
  assert.equal(degraded.pendingDurableWork, 0);
  assert.equal(degraded.activeTab, "media");
  assert.equal(degraded.active, true);
});

test("stale refresh and pagination preserve the active tab and every settled scroll position", () => {
  const roomSessionId = "journey-stale-room";
  const state = runJourney(roomSessionId, [
    { action: "LOCAL_SNAPSHOT_RENDERED", tab: "overview" },
    { action: "TAB_USABLE", tab: "chat" },
    { action: "LIST_SCROLL_SETTLED", contentOffset: 940, tab: "chat" },
    { action: "SERVER_REFRESH_STARTED", tab: "overview" },
    { action: "PAGINATION_STARTED", tab: "chat" },
    { action: "SERVER_REFRESH_APPLIED", tab: "overview" },
    { action: "PAGINATION_FINISHED", tab: "chat" }
  ]);

  assert.equal(state.activeTab, "chat");
  assert.equal(state.scrollOffsets.chat, 940);
  assert.equal(state.cachedContentUsable, true);
  assert.equal(state.queryState, "ready");
});

test("pending uploads do not block tab use and remain durable across room exit", () => {
  const roomSessionId = "journey-upload-room";
  const state = runJourney(roomSessionId, [
    { action: "ROOM_SCREEN_MOUNT", tab: "media" },
    { action: "MEDIA_UPLOAD_ENQUEUED", tab: "media" },
    { action: "TAB_USABLE", tab: "dishes" },
    { action: "DISH_MUTATION_STARTED", tab: "dishes" },
    { action: "TAB_USABLE", tab: "chat" },
    { action: "ROOM_EXIT_STARTED", tab: "chat" },
    { action: "ROOM_EXIT_FINISHED", tab: "chat" }
  ]);

  assert.equal(state.activeTab, "chat");
  assert.equal(state.pendingDurableWork, 1);
  assert.equal(state.active, false);
});

test("reply state clears on cancel, send, exit, and room-switch rejection", () => {
  const roomSessionId = "journey-reply-room";
  const cancelled = runJourney(roomSessionId, [
    { action: "REPLY_OPENED", tab: "chat" },
    { action: "REPLY_CANCELLED", tab: "chat" }
  ]);
  assert.equal(cancelled.replyOpen, false);

  const sent = reduceMemoryRoomJourney(
    reduceMemoryRoomJourney(cancelled, {
      action: "REPLY_OPENED",
      roomSessionId,
      tab: "chat"
    }),
    { action: "MESSAGE_OPTIMISTIC", roomSessionId, tab: "chat" }
  );
  assert.equal(sent.replyOpen, false);

  const exited = reduceMemoryRoomJourney(
    reduceMemoryRoomJourney(sent, {
      action: "REPLY_OPENED",
      roomSessionId,
      tab: "chat"
    }),
    { action: "ROOM_EXIT_STARTED", roomSessionId, tab: "chat" }
  );
  assert.equal(exited.replyOpen, false);

  const afterOldRoomReply = reduceMemoryRoomJourney(
    createMemoryRoomJourneyState("new-room"),
    { action: "REPLY_OPENED", roomSessionId: "old-room", tab: "chat" }
  );
  assert.equal(afterOldRoomReply.replyOpen, false);
  assert.equal(afterOldRoomReply.ignoredOldRoomCallbacks, 1);
});

test("duplicate Realtime subscribe callbacks retain one canonical channel owner", () => {
  const roomSessionId = "journey-realtime-room";
  const state = runJourney(roomSessionId, [
    { action: "REALTIME_SUBSCRIBED", tab: "overview" },
    { action: "REALTIME_SUBSCRIBED", tab: "chat" },
    { action: "REALTIME_UNSUBSCRIBED", tab: "chat" }
  ]);

  assert.equal(state.realtimeChannelCount, 0);
});

test("back begins exit synchronously and cleanup releases players and Realtime", () => {
  const roomSessionId = "journey-back-room";
  const exiting = runJourney(roomSessionId, [
    { action: "ROOM_SCREEN_MOUNT", tab: "media" },
    { action: "REALTIME_SUBSCRIBED", tab: "media" },
    { action: "PLAYER_CREATED", playerKind: "video", tab: "media" },
    { action: "ROOM_EXIT_STARTED", tab: "media" }
  ]);
  assert.equal(exiting.screenState, "exiting");
  assert.equal(exiting.active, true);

  const unmounted = reduceMemoryRoomJourney(exiting, {
    action: "ROOM_SCREEN_UNMOUNT",
    roomSessionId,
    tab: "media"
  });
  assert.equal(unmounted.active, false);
  assert.equal(unmounted.playerCount, 0);
  assert.equal(unmounted.realtimeChannelCount, 0);
});

test("callbacks from an old room cannot mutate the current room state", () => {
  const current = createMemoryRoomJourneyState("room-b");
  const afterOldCallback = reduceMemoryRoomJourney(current, {
    action: "MESSAGE_CONFIRMED",
    roomSessionId: "room-a",
    tab: "chat"
  });

  assert.equal(afterOldCallback.roomSessionId, "room-b");
  assert.equal(afterOldCallback.pendingDurableWork, 0);
  assert.equal(afterOldCallback.ignoredOldRoomCallbacks, 1);
});

test("scroll offsets are retained independently for every room surface", () => {
  const roomSessionId = "journey-scroll-room";
  const state = runJourney(roomSessionId, [
    { action: "LIST_SCROLL_SETTLED", contentOffset: 240, tab: "overview" },
    { action: "LIST_SCROLL_SETTLED", contentOffset: 880, tab: "media" },
    { action: "LIST_SCROLL_SETTLED", contentOffset: 420, tab: "dishes" },
    { action: "LIST_SCROLL_SETTLED", contentOffset: 1200, tab: "chat" }
  ]);

  assert.deepEqual(state.scrollOffsets, {
    chat: 1200,
    dishes: 420,
    media: 880,
    overview: 240
  });
});

test("room request coordinator deduplicates concurrent local/bootstrap work but permits later foreground refresh", async () => {
  const coordinator = createMemoryRoomRequestCoordinator();
  let localReads = 0;
  let networkRequests = 0;
  let finishBootstrap;
  const bootstrapGate = new Promise((resolve) => {
    finishBootstrap = resolve;
  });

  const localA = coordinator.readLocal("room-a", async () => {
    localReads += 1;
    return { id: "room-a" };
  });
  const localB = coordinator.readLocal("room-a", async () => {
    localReads += 1;
    return { id: "duplicate" };
  });
  assert.strictEqual(localA, localB);
  assert.deepEqual(await localA, { id: "room-a" });
  assert.equal(localReads, 1);
  await Promise.resolve();
  assert.equal(
    coordinator.snapshot().localReadRoomId,
    null,
    "a completed SQLite read must not retain the resolved room graph"
  );

  const laterLocalRead = await coordinator.readLocal("room-a", async () => {
    localReads += 1;
    return { id: "room-a", pass: 2 };
  });
  assert.deepEqual(laterLocalRead, { id: "room-a", pass: 2 });
  assert.equal(localReads, 2);

  const bootstrapA = coordinator.refresh("room-a", async () => {
    networkRequests += 1;
    await bootstrapGate;
    return "bootstrap";
  });
  const bootstrapB = coordinator.refresh("room-a", async () => {
    networkRequests += 1;
    return "duplicate";
  });
  assert.strictEqual(bootstrapA, bootstrapB);
  finishBootstrap();
  assert.equal(await bootstrapA, "bootstrap");
  await Promise.resolve();

  const foreground = coordinator.refresh("room-a", async () => {
    networkRequests += 1;
    return "foreground";
  });
  assert.equal(await foreground, "foreground");
  assert.equal(networkRequests, 2);
  assert.deepEqual(coordinator.snapshot(), {
    activeRefreshRoomId: null,
    localReadRoomId: null,
    localReadStartCount: 2,
    refreshStartCount: 2
  });
});

test("failed coordinated refresh releases ownership so retry can reconcile", async () => {
  const coordinator = createMemoryRoomRequestCoordinator();
  await assert.rejects(
    coordinator.refresh("room-a", async () => {
      throw new Error("offline");
    }),
    /offline/
  );
  await Promise.resolve();

  const recovered = await coordinator.refresh("room-a", async () => "recovered");
  assert.equal(recovered, "recovered");
  assert.equal(coordinator.snapshot().refreshStartCount, 2);
});

test("failed coordinated SQLite read releases ownership so retry can recover local state", async () => {
  const coordinator = createMemoryRoomRequestCoordinator();
  await assert.rejects(
    coordinator.readLocal("room-a", async () => {
      throw new Error("sqlite unavailable");
    }),
    /sqlite unavailable/
  );
  await Promise.resolve();

  const recovered = await coordinator.readLocal("room-a", async () => ({ id: "room-a" }));
  assert.deepEqual(recovered, { id: "room-a" });
  assert.equal(coordinator.snapshot().localReadStartCount, 2);
});

test("diagnostics are inert when the development-only switch is disabled", () => {
  const events = [];
  configureMemoryRoomJourneyDiagnostics({ enabled: false, sink: (event) => events.push(event) });
  const session = createMemoryRoomJourneySession({
    journeyRunId: "disabled-run",
    roomSessionId: "disabled-room"
  });

  assert.equal(recordMemoryRoomJourney(session, "ROOM_TAP", { tab: "overview" }), null);
  assert.equal(memoryRoomJourneySnapshot(session.roomSessionId), null);
  assert.deepEqual(events, []);
});

test("runtime diagnostics are bounded and redact private or identifying fields", () => {
  const events = [];
  configureMemoryRoomJourneyDiagnostics({ enabled: true, sink: (event) => events.push(event) });
  const session = createMemoryRoomJourneySession({
    journeyRunId: "privacy-run",
    roomSessionId: "privacy-room"
  });
  recordMemoryRoomJourney(session, "MESSAGE_OPTIMISTIC", {
    body: "private body",
    participantName: "Private Person",
    signedUrl: "https://private.example.test/signed",
    storagePath: "memories/private/path",
    tab: "chat",
    token: "private-token"
  });
  for (let index = 0; index < 2200; index += 1) {
    recordMemoryRoomJourney(session, "SURFACE_RENDER", { surface: "chat", tab: "chat" });
  }

  const snapshot = memoryRoomJourneySnapshot(session.roomSessionId);
  assert.equal(snapshot.events.length, 2048);
  assert.equal(snapshot.renderCount, 2200);
  for (const forbidden of ["body", "participantName", "signedUrl", "storagePath", "token"]) {
    assert.equal(Object.hasOwn(events[0], forbidden), false);
  }
  for (const required of [
    "action",
    "journeyRunId",
    "roomSessionId",
    "monotonicTimestampMs",
    "screenState",
    "queryState",
    "sqliteState",
    "realtimeState",
    "keyboardState",
    "contentOffset",
    "renderCount",
    "mountCount",
    "networkRequestCategory",
    "playerCount",
    "memorySampleKb"
  ]) {
    assert.equal(Object.hasOwn(events[0], required), true, `missing required diagnostic field: ${required}`);
  }
});
