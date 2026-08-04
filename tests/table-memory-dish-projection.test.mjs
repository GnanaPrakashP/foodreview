import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { optimisticMemoryDish } from "../mobile/src/services/memoryDishDraft.mjs";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function loadMemoryMapper() {
  const { outputText } = ts.transpileModule(source("mobile/src/services/memoryMapper.ts"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    Date,
    Error,
    Math,
    Number,
    Object,
    Set,
    exports: mod.exports,
    module: mod,
    require: (id) => {
      // Room-level helpers only; none of them touch dish projection.
      if (id === "@/services/memoryShared") {
        return {
          normalizeStatus: (value) => value,
          occasionConfidenceForRoom: () => null,
          occasionConfirmedForRoom: () => false,
          occasionTypeForRoom: () => "other",
          themeKeyForRoom: () => "default",
          titleForRoom: (room) => room.title ?? ""
        };
      }
      if (id === "@/services/memoryMessageReconciliation.mjs") {
        return { sortMemoryMessages: (messages) => [...messages] };
      }
      throw new Error(`Unexpected import: ${id}`);
    }
  });
  return mod.exports;
}

// The mapper runs in its own realm, so its arrays and objects have different
// prototypes than this file's. Compare values, not intrinsics.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const mapper = loadMemoryMapper();
const ROOM_ID = "8f2f4d61-91cc-4b28-9c0f-2a0d8b0b7a10";
const DISH_ID = "3a71a5cc-0ac2-4c4a-9d61-5f9a1c2e4b77";

function dishRow(overrides) {
  return {
    added_by: "gnana",
    created_at: "2026-08-05T10:00:00.000Z",
    dish_name: "Ghee roast",
    id: DISH_ID,
    note: "crispy",
    rating: null,
    room_id: ROOM_ID,
    stop_id: null,
    ...overrides
  };
}

function ratingRow(overrides) {
  return {
    created_at: "2026-08-05T10:00:00.000Z",
    dish_id: DISH_ID,
    id: "0a2f9d31-2c88-4a4e-b0f1-6c1b2d3e4f50",
    rated_by: "gnana",
    rating: 4,
    room_id: ROOM_ID,
    updated_at: "2026-08-05T10:00:00.000Z",
    ...overrides
  };
}

test("a dish with per-member ratings reports the average, the count and the viewer's own score", () => {
  const dish = mapper.mapMemoryDish({
    dish: dishRow(),
    namesByUsername: { gnana: "Gnana P", peer: "Peer P" },
    ratingRows: [ratingRow(), ratingRow({ id: "b", rated_by: "peer", rating: 2 })],
    viewerName: "gnana"
  });

  assert.equal(dish.averageRating, 3);
  assert.equal(dish.ratingCount, 2);
  assert.equal(dish.myRating, 4);
  assert.equal(dish.addedByDisplayName, "Gnana P");
  assert.equal(dish.ratings[1].ratedByDisplayName, "Peer P");
  // The legacy column stays untouched when real rating rows exist.
  assert.equal(dish.rating, null);
});

test("a dish with only the legacy rating column still shows one rating from its author", () => {
  const dish = mapper.mapMemoryDish({
    dish: dishRow({ rating: "5" }),
    namesByUsername: {},
    ratingRows: [],
    viewerName: "gnana"
  });

  assert.equal(dish.averageRating, 5);
  assert.equal(dish.ratingCount, 1);
  assert.equal(dish.myRating, 5);
  assert.equal(dish.ratings[0].id, `legacy:${DISH_ID}:gnana`);
  assert.equal(dish.addedByDisplayName, "gnana");
});

test("an unrated dish reports no rating rather than zero", () => {
  const dish = mapper.mapMemoryDish({
    dish: dishRow(),
    namesByUsername: {},
    ratingRows: [],
    viewerName: "gnana"
  });

  assert.equal(dish.averageRating, null);
  assert.equal(dish.ratingCount, 0);
  assert.equal(dish.myRating, null);
  assert.deepEqual(plain(dish.ratings), []);
});

test("the room read and a freshly created dish project identically", () => {
  // The mapper was extracted from mapMemoryRoom so that adding a dish can build
  // the same object the next room read will. If these ever diverge, the card
  // would visibly change the moment the server snapshot lands.
  const dishes = [dishRow(), dishRow({ id: "c0ffee00-0000-4000-8000-000000000001", rating: 3 })];
  const dishRatings = [ratingRow()];
  const room = mapper.mapMemoryRoom({
    dishes,
    dishRatings,
    lastReadAt: null,
    members: [],
    messages: [],
    namesByUsername: { gnana: "Gnana P" },
    photos: [],
    room: { created_at: "2026-08-05T09:00:00.000Z", created_by: "gnana", id: ROOM_ID, status: "published", title: "Table" },
    stops: [],
    viewerName: "gnana"
  });

  const ratingsByDishId = { [DISH_ID]: dishRatings };
  assert.deepEqual(plain(room.dishes), plain(dishes.map((dish) => mapper.mapMemoryDish({
    dish,
    namesByUsername: { gnana: "Gnana P" },
    ratingRows: ratingsByDishId[dish.id] ?? [],
    viewerName: "gnana"
  }))));
  assert.equal(room.dishes.length, 2);
});

test("the card shown before the insert lands is the row the next read produces", () => {
  // The optimistic dish carries the device-minted primary key, so confirmation
  // replaces it in place. If these two ever diverge, the user watches the card
  // change under them the moment the server row arrives.
  const draft = optimisticMemoryDish({
    addedBy: "gnana",
    addedByDisplayName: "Gnana P",
    createdAt: "2026-08-05T10:00:00.000Z",
    dishId: DISH_ID,
    dishName: "  Ghee roast  ",
    note: " crispy ",
    rating: 4,
    roomId: ROOM_ID
  });
  const stored = mapper.mapMemoryDish({
    dish: dishRow({ rating: 4 }),
    namesByUsername: { gnana: "Gnana P" },
    ratingRows: [],
    viewerName: "gnana"
  });

  assert.deepEqual(plain(draft), plain(stored));

  // Once the ratings table has the row, only its own id differs — the card
  // renders none of it.
  const withRatingRow = mapper.mapMemoryDish({
    dish: dishRow({ rating: 4 }),
    namesByUsername: { gnana: "Gnana P" },
    ratingRows: [ratingRow()],
    viewerName: "gnana"
  });
  const withoutRatingIds = (dish) => ({
    ...dish,
    ratings: dish.ratings.map((entry) => ({ ...entry, id: null }))
  });
  assert.deepEqual(plain(withoutRatingIds(withRatingRow)), plain(withoutRatingIds(draft)));
});

test("an unrated draft dish claims no rating", () => {
  const draft = optimisticMemoryDish({
    addedBy: "gnana",
    addedByDisplayName: "",
    createdAt: "2026-08-05T10:00:00.000Z",
    dishId: DISH_ID,
    dishName: "Ghee roast",
    note: "   ",
    rating: 0,
    roomId: ROOM_ID
  });

  assert.equal(draft.averageRating, null);
  assert.equal(draft.ratingCount, 0);
  assert.equal(draft.note, null);
  // No display name yet is not a reason to render an empty author.
  assert.equal(draft.addedByDisplayName, "gnana");
  assert.deepEqual(plain(draft), plain(mapper.mapMemoryDish({
    dish: dishRow({ note: null, rating: null }),
    namesByUsername: {},
    ratingRows: [],
    viewerName: "gnana"
  })));
});

test("adding a dish writes it into the room instead of invalidating into a stale replay", () => {
  const hooks = source("mobile/src/hooks/useMemories.ts");
  const memories = source("mobile/src/services/memories.ts");
  const addDish = hooks.slice(
    hooks.indexOf("export function useAddMemoryDishMutation"),
    hooks.indexOf("export function useDeleteMemoryDishMutation")
  );

  // The service must hand back the created row; only its id used to survive.
  assert.match(memories, /\.select\(MEMORY_DISH_SELECT\)\s*\.single<MemoryDishRow>\(\)/);
  assert.match(memories, /return mapMemoryDish\(\{[\s\S]*?viewerName: addedBy/);
  // The room projection, the durable replica and the summary all move together.
  assert.match(addDish, /dishes: upsertMemoryDish\(currentRoom\.dishes, dish\)/);
  assert.match(addDish, /queryClient\.setQueryData\(detailKey, nextRoom\)/);
  assert.match(addDish, /saveOfflineMemoryRoom\(nextRoom\)/);
  assert.match(addDish, /dishCount: memory\.dishCount \+ 1/);
  // A populated room is never invalidated: that is what replayed the
  // pre-mutation SQLite snapshot and hid the new dish.
  assert.match(addDish, /if \(!nextRoom\) \{[\s\S]*?invalidateQueries\(\{ queryKey: detailKey \}\)/);
  assert.doesNotMatch(addDish, /onSuccess: \(\) => \{[\s\S]*?invalidateQueries/);
});

test("the dish card is in the room before the request goes out, and leaves again if it fails", () => {
  const hooks = source("mobile/src/hooks/useMemories.ts");
  const memories = source("mobile/src/services/memories.ts");
  const screen = source("mobile/app/memories/[id]/add-dish.tsx");
  const addDish = hooks.slice(
    hooks.indexOf("export function useAddMemoryDishMutation"),
    hooks.indexOf("export function useDeleteMemoryDishMutation")
  );

  // One identity for the optimistic card and the stored row.
  assert.match(hooks, /const dishId = input\.dishId \?\? createUuid\(\)/);
  assert.match(memories, /\.\.\.\(input\.dishId \? \{ id: input\.dishId \} : \{\}\)/);
  assert.match(addDish, /onMutate: async \(input\)[\s\S]*?optimisticMemoryDish\(\{/);
  assert.match(addDish, /pendingMemoryDishAdds\.set\(`\$\{roomId\}:\$\{dishId\}`/);
  // Unconfirmed dishes are never persisted: there is no dish outbox to recover
  // them, so a killed app would strand a phantom card.
  assert.doesNotMatch(
    addDish.slice(addDish.indexOf("onMutate:"), addDish.indexOf("onError:")),
    /saveOfflineMemoryRoom/
  );
  // A failure takes the card back out, and stops the overlay re-applying it.
  assert.match(addDish, /onError:[\s\S]*?forgetPendingDish\(dishId\)/);
  assert.match(addDish, /onError:[\s\S]*?dishes: current\.dishes\.filter\(\(dish\) => dish\.id !== dishId\)/);
  assert.match(addDish, /onError:[\s\S]*?dishCount: Math\.max\(0, memory\.dishCount - 1\)/);
  // The overlay survives the SQLite-first replay a refetch performs.
  assert.match(hooks, /function withPendingMemoryDishAdds\(room: MemoryRoom\)/);
  assert.match(hooks, /applyPendingRatings\(withPendingMemoryDishAdds\(/);
  // The composer no longer waits on the network before handing over to Chat.
  assert.doesNotMatch(screen, /await addDish\.mutateAsync/);
  assert.match(screen, /addDish\.mutateAsync\(\{[\s\S]*?\}\)\.catch\(\(error\) => \{[\s\S]*?Alert\.alert\(/);
  assert.match(screen, /requestMemoryRoomTab\(roomId, "chat"\)/);
});
