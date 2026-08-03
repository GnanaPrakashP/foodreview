import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function loadRatingCoordinator(setMemoryDishRating, outbox = new Map()) {
  let requestSequence = 0;
  const registeredCleanups = [];
  class MobileApiError extends Error {
    constructor(message, code, status) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  const { outputText } = ts.transpileModule(
    source("mobile/src/services/memoryDishRatingCoordinator.ts"),
    {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }
  );
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    Date,
    Error,
    Map,
    Math,
    Promise,
    clearTimeout,
    exports: mod.exports,
    module: mod,
    require: (id) => {
      if (id === "@/api/client") return { MobileApiError };
      if (id === "@/services/installIdentity") {
        return { createUuid: () => `00000000-0000-4000-8000-${String(++requestSequence).padStart(12, "0")}` };
      }
      if (id === "@/services/memoryOfflineStore") {
        return {
          deleteOfflineMemoryDishRatingOutbox: async (roomId, dishId, sequence) => {
            const key = `${roomId}:${dishId}`;
            const entry = outbox.get(key);
            if (!entry || sequence === undefined || entry.clientSequence <= sequence) outbox.delete(key);
          },
          readOfflineMemoryDishRatingOutbox: async (roomId) => (
            [...outbox.values()].filter((entry) => !roomId || entry.roomId === roomId)
          ),
          saveOfflineMemoryDishRatingOutbox: async (entry) => {
            outbox.set(`${entry.roomId}:${entry.dishId}`, { ...entry });
          }
        };
      }
      if (id === "@/services/memories") return { setMemoryDishRating };
      if (id === "@/security/sensitiveResourceRegistry") {
        return { registerSensitiveResourceCleanup: (cleanup) => registeredCleanups.push(cleanup) };
      }
      throw new Error(`Unexpected import: ${id}`);
    },
    setTimeout
  });
  return { ...mod.exports, MobileApiError, outbox, registeredCleanups };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("rapid dish rating taps coalesce to one request carrying only the latest value", async () => {
  const calls = [];
  const coordinator = loadRatingCoordinator(async (input) => { calls.push(input); });
  const taps = [1, 2, 3, 4, 5].map((rating) => coordinator.queueMemoryDishRating({
    confirmedRating: null,
    dishId: "dish",
    rating,
    roomId: "room"
  }));
  await Promise.all(taps);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].rating, 5);
  assert.match(calls[0].clientMutationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(coordinator.outbox.size, 0);
});

test("a new rating never overlaps an in-flight request and is sent immediately after it", async () => {
  const calls = [];
  let releaseFirst;
  const firstRequest = new Promise((resolve) => { releaseFirst = resolve; });
  const coordinator = loadRatingCoordinator(async (input) => {
    calls.push(input);
    if (calls.length === 1) await firstRequest;
  });

  const first = coordinator.queueMemoryDishRating({ confirmedRating: null, dishId: "dish", rating: 2, roomId: "room" });
  await delay(340);
  const latest = coordinator.queueMemoryDishRating({ confirmedRating: 2, dishId: "dish", rating: 5, roomId: "room" });
  await delay(30);
  assert.equal(calls.length, 1);
  releaseFirst();
  await Promise.all([first, latest]);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].rating, 2);
  assert.equal(calls[1].rating, 5);
});

test("permanent rating denial rejects and removes the durable intent", async () => {
  const coordinator = loadRatingCoordinator(async () => {
    throw new coordinator.MobileApiError("Room unavailable", "permanent_denial", 403);
  });
  const intent = coordinator.queueMemoryDishRating({ confirmedRating: 3, dishId: "dish", rating: 5, roomId: "room" });
  await assert.rejects(intent, (error) => (
    error instanceof coordinator.PermanentMemoryDishRatingError && error.confirmedRating === 3
  ));
  assert.equal(coordinator.outbox.size, 0);
});

test("temporary rating failure keeps the latest intent and retries automatically", async () => {
  let attempts = 0;
  const coordinator = loadRatingCoordinator(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary network failure");
  });
  const intent = coordinator.queueMemoryDishRating({ confirmedRating: 2, dishId: "dish", rating: 4, roomId: "room" });
  await delay(380);
  assert.equal(attempts, 1);
  assert.equal(coordinator.outbox.get("room:dish").desiredRating, 4);
  await intent;
  assert.equal(attempts, 2);
  assert.equal(coordinator.outbox.size, 0);
});

test("offline rapid ratings survive coordinator restart and replay only the latest value", async () => {
  const durableOutbox = new Map();
  const beforeRestartCalls = [];
  const beforeRestart = loadRatingCoordinator(async (input) => { beforeRestartCalls.push(input); }, durableOutbox);
  const pending = beforeRestart.queueMemoryDishRating({
    confirmedRating: 1,
    deferUntilOnline: true,
    dishId: "dish",
    rating: 2,
    roomId: "room"
  });
  const pendingLatest = beforeRestart.queueMemoryDishRating({
    confirmedRating: 2,
    deferUntilOnline: true,
    dishId: "dish",
    rating: 5,
    roomId: "room"
  });
  await delay(20);
  assert.equal(beforeRestartCalls.length, 0);
  assert.equal(durableOutbox.get("room:dish").desiredRating, 5);

  const sessionEnded = Promise.all([
    pending.catch(() => undefined),
    pendingLatest.catch(() => undefined)
  ]);
  beforeRestart.registeredCleanups.forEach((cleanup) => cleanup());
  await sessionEnded;

  const afterRestartCalls = [];
  const afterRestart = loadRatingCoordinator(async (input) => { afterRestartCalls.push(input); }, durableOutbox);
  await afterRestart.recoverPendingMemoryDishRatings("room", { flush: true });
  await delay(30);
  assert.equal(afterRestartCalls.length, 1);
  assert.equal(afterRestartCalls[0].rating, 5);
  assert.equal(durableOutbox.size, 0);
});

test("optimistic rating projection replaces only the current user's row and recomputes aggregate", () => {
  const coordinator = loadRatingCoordinator(async () => {});
  const room = {
    dishes: [{
      averageRating: 3,
      id: "dish",
      myRating: 2,
      ratingCount: 2,
      ratings: [
        { id: "mine", ratedBy: "user-a", ratedByDisplayName: "User A", rating: 2 },
        { id: "theirs", ratedBy: "user-b", ratedByDisplayName: "User B", rating: 4 }
      ]
    }],
    id: "room"
  };
  const next = coordinator.applyMemoryDishRating(room, "dish", "user-a", "User A", 5);

  assert.equal(next.dishes[0].myRating, 5);
  assert.equal(next.dishes[0].ratingCount, 2);
  assert.equal(next.dishes[0].averageRating, 4.5);
  assert.equal(next.dishes[0].ratings.find((rating) => rating.ratedBy === "user-b").rating, 4);
});

test("tapping the selected rating clears only the current user's row", async () => {
  const calls = [];
  const coordinator = loadRatingCoordinator(async (input) => { calls.push(input); });
  const room = {
    dishes: [{
      averageRating: 4,
      id: "dish",
      myRating: 5,
      ratingCount: 2,
      ratings: [
        { id: "mine", ratedBy: "user-a", ratedByDisplayName: "User A", rating: 5 },
        { id: "theirs", ratedBy: "user-b", ratedByDisplayName: "User B", rating: 3 }
      ]
    }],
    id: "room"
  };
  const cleared = coordinator.applyMemoryDishRating(room, "dish", "user-a", "User A", null);
  assert.equal(cleared.dishes[0].myRating, null);
  assert.equal(cleared.dishes[0].ratingCount, 1);
  assert.equal(cleared.dishes[0].averageRating, 3);

  await coordinator.queueMemoryDishRating({ confirmedRating: 5, dishId: "dish", rating: null, roomId: "room" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].rating, null);
});

test("place and dish mutations use the hardened idempotent member-authorized endpoint", () => {
  const route = source("app/api/mobile/memories/[roomId]/entities/route.ts");
  const messageRoute = source("app/api/mobile/memories/[roomId]/messages/route.ts");
  const migration = source("supabase/migrations/202608030003_table_memory_entity_mutations.sql");
  const interactionsMigration = source("supabase/migrations/202608030005_table_memory_dish_interactions.sql");
  const screen = source("mobile/app/memories/[id].tsx");
  const placeForm = source("mobile/app/memories/[id]/add-place.tsx");
  const coordinator = source("mobile/src/services/memoryDishRatingCoordinator.ts");

  assert.match(route, /assertMemoryRoomMutationAllowed/);
  assert.match(route, /claimIdempotency\(req, "memory\.place\.update"/);
  assert.match(route, /claimIdempotency\(req, `memory\.\$\{kind\}\.delete`/);
  assert.match(route, /claimIdempotency\(req, "memory\.dish\.rating"/);
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /shared_memory_dish_ratings\.client_sequence <= excluded\.client_sequence/);
  assert.match(migration, /revoke all on function public\.set_shared_memory_dish_rating_v2[\s\S]*from public, anon, authenticated/);
  assert.match(screen, /type: "dish"; value: MemoryDish/);
  assert.match(screen, /dishCount === 1 \? "dish"/);
  assert.match(screen, /accessibilityLabel="Place actions"/);
  assert.match(placeForm, /editing \? "Update" : "Add"/);
  assert.match(placeForm, /Alert\.alert\("Discard changes\?"/);
  assert.match(coordinator, /const RATING_DEBOUNCE_MS = 300/);
  assert.match(coordinator, /if \(flight\.inFlight\) return/);
  assert.match(route, /Only the person who added this dish can delete it/);
  assert.match(messageRoute, /from\("shared_memory_dishes"\)[\s\S]*Invalid reply/);
  assert.match(interactionsMigration, /rating is null or \(rating >= 1 and rating <= 5\)/);
  assert.match(interactionsMigration, /select dish\.room_id[\s\S]*where dish\.id = new\.reply_to_message_id/);
  assert.match(screen, /memoryDishReplyTarget\(singleSelectedDish\)/);
  assert.match(screen, /sameUsername\(target\.value\.addedBy, myUsername\)/);
  assert.match(screen, /visualRatingRef\.current === star \? null : star/);
});
