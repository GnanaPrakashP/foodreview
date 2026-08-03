import { MobileApiError } from "@/api/client";
import { createRequestId } from "@/services/installIdentity";
import {
  deleteOfflineMemoryDishRatingOutbox,
  readOfflineMemoryDishRatingOutbox,
  saveOfflineMemoryDishRatingOutbox,
  type MemoryDishRatingOutboxEntry
} from "@/services/memoryOfflineStore";
import { setMemoryDishRating } from "@/services/memories";
import { registerSensitiveResourceCleanup } from "@/security/sensitiveResourceRegistry";
import type { MemoryDish, MemoryDishRating, MemoryRoom } from "@/types/models";

const RATING_DEBOUNCE_MS = 140;
const MAX_AUTOMATIC_ATTEMPTS = 5;
const ratingFlights = new Map<string, RatingFlight>();
let lastRatingSequence = 0;

type RatingWaiter = {
  reject: (error: unknown) => void;
  resolve: () => void;
};

type RatingFlight = {
  attempt: number;
  confirmedRating: number | null;
  inFlight: boolean;
  intent: MemoryDishRatingOutboxEntry;
  timer: ReturnType<typeof setTimeout> | null;
  waiters: RatingWaiter[];
};

export class PermanentMemoryDishRatingError extends Error {
  constructor(message: string, readonly confirmedRating: number | null) {
    super(message);
    this.name = "PermanentMemoryDishRatingError";
  }
}

function ratingKey(roomId: string, dishId: string) {
  return `${roomId}:${dishId}`;
}

function nextRatingSequence() {
  lastRatingSequence = Math.max(lastRatingSequence + 1, Date.now());
  return lastRatingSequence;
}

function isPermanentRatingFailure(error: unknown) {
  return error instanceof MobileApiError && (
    error.status === 400 || error.status === 401 || error.status === 403 || error.status === 404
  );
}

function scheduleFlight(flight: RatingFlight, delayMs: number) {
  if (flight.timer || flight.inFlight) return;
  flight.timer = setTimeout(() => {
    flight.timer = null;
    void flushFlight(flight);
  }, delayMs);
}

async function flushFlight(flight: RatingFlight) {
  if (flight.inFlight) return;
  flight.inFlight = true;
  const sent = flight.intent;
  const key = ratingKey(sent.roomId, sent.dishId);
  let retryDelay: number | null = null;
  try {
    await setMemoryDishRating({
      clientMutationId: sent.clientMutationId,
      clientSequence: sent.clientSequence,
      dishId: sent.dishId,
      rating: sent.desiredRating,
      roomId: sent.roomId
    });
    flight.attempt = 0;
    flight.confirmedRating = sent.desiredRating;

    if (flight.intent.clientSequence === sent.clientSequence) {
      await deleteOfflineMemoryDishRatingOutbox(sent.roomId, sent.dishId, sent.clientSequence);
      if (flight.intent.clientSequence !== sent.clientSequence) {
        flight.intent = { ...flight.intent, confirmedRating: sent.desiredRating };
        await saveOfflineMemoryDishRatingOutbox(flight.intent);
        return;
      }
      ratingFlights.delete(key);
      const waiters = flight.waiters.splice(0);
      waiters.forEach((waiter) => waiter.resolve());
      return;
    }

    flight.intent = { ...flight.intent, confirmedRating: sent.desiredRating };
    await saveOfflineMemoryDishRatingOutbox(flight.intent);
  } catch (error) {
    if (isPermanentRatingFailure(error) && flight.intent.clientSequence === sent.clientSequence) {
      await deleteOfflineMemoryDishRatingOutbox(sent.roomId, sent.dishId, sent.clientSequence).catch(() => undefined);
      if (flight.intent.clientSequence !== sent.clientSequence) return;
      ratingFlights.delete(key);
      const permanentError = new PermanentMemoryDishRatingError(
        error instanceof Error ? error.message : "This rating could not be saved.",
        flight.confirmedRating
      );
      const waiters = flight.waiters.splice(0);
      waiters.forEach((waiter) => waiter.reject(permanentError));
      return;
    }

    flight.attempt += 1;
    if (flight.intent.clientSequence === sent.clientSequence && flight.attempt < MAX_AUTOMATIC_ATTEMPTS) {
      retryDelay = Math.min(1_000 * (2 ** (flight.attempt - 1)), 15_000);
    }
  } finally {
    flight.inFlight = false;
    if (ratingFlights.get(key) === flight) {
      if (flight.intent.clientSequence !== sent.clientSequence) scheduleFlight(flight, 0);
      else if (retryDelay !== null) scheduleFlight(flight, retryDelay);
    }
  }
}

export function queueMemoryDishRating(input: {
  confirmedRating: number | null;
  deferUntilOnline?: boolean;
  dishId: string;
  rating: number;
  roomId: string;
}) {
  const key = ratingKey(input.roomId, input.dishId);
  const current = ratingFlights.get(key);
  const intent: MemoryDishRatingOutboxEntry = {
    clientMutationId: createRequestId(),
    clientSequence: nextRatingSequence(),
    confirmedRating: current?.confirmedRating ?? input.confirmedRating,
    desiredRating: input.rating,
    dishId: input.dishId,
    roomId: input.roomId,
    updatedAt: Date.now()
  };
  const flight = current ?? {
    attempt: 0,
    confirmedRating: input.confirmedRating,
    inFlight: false,
    intent,
    timer: null,
    waiters: []
  };
  flight.intent = intent;
  flight.attempt = 0;
  ratingFlights.set(key, flight);

  void saveOfflineMemoryDishRatingOutbox(intent).then(() => {
    if (!input.deferUntilOnline && ratingFlights.get(key) === flight) {
      scheduleFlight(flight, RATING_DEBOUNCE_MS);
    }
  }).catch((error) => {
    const waiters = flight.waiters.splice(0);
    ratingFlights.delete(key);
    waiters.forEach((waiter) => waiter.reject(error));
  });

  return new Promise<void>((resolve, reject) => {
    flight.waiters.push({ reject, resolve });
  });
}

export async function recoverPendingMemoryDishRatings(
  roomId: string,
  options: { flush?: boolean } = {}
) {
  const stored = await readOfflineMemoryDishRatingOutbox(roomId);
  for (const intent of stored) {
    const key = ratingKey(intent.roomId, intent.dishId);
    const current = ratingFlights.get(key);
    if (current && current.intent.clientSequence >= intent.clientSequence) {
      if (options.flush) scheduleFlight(current, 0);
      continue;
    }
    lastRatingSequence = Math.max(lastRatingSequence, intent.clientSequence);
    const flight: RatingFlight = {
      attempt: 0,
      confirmedRating: intent.confirmedRating,
      inFlight: false,
      intent,
      timer: null,
      waiters: []
    };
    ratingFlights.set(key, flight);
    if (options.flush) scheduleFlight(flight, 0);
  }
  return stored;
}

export function pendingMemoryDishRating(roomId: string, dishId: string) {
  return ratingFlights.get(ratingKey(roomId, dishId))?.intent.desiredRating ?? null;
}

function sameUsername(first: string, second: string) {
  return first.trim().toLowerCase() === second.trim().toLowerCase();
}

export function applyMemoryDishRating(
  room: MemoryRoom,
  dishId: string,
  username: string,
  displayName: string,
  rating: number
): MemoryRoom {
  const now = new Date().toISOString();
  return {
    ...room,
    dishes: room.dishes.map((dish): MemoryDish => {
      if (dish.id !== dishId) return dish;
      const existing = dish.ratings.find((item) => sameUsername(item.ratedBy, username));
      const ownRating: MemoryDishRating = existing
        ? { ...existing, ratedByDisplayName: displayName || existing.ratedByDisplayName, rating, updatedAt: now }
        : {
          createdAt: now,
          dishId,
          id: `optimistic-rating:${dishId}:${username}`,
          ratedBy: username,
          ratedByDisplayName: displayName || username,
          rating,
          roomId: room.id,
          updatedAt: now
        };
      const ratings = [...dish.ratings.filter((item) => !sameUsername(item.ratedBy, username)), ownRating];
      const averageRating = ratings.length > 0
        ? ratings.reduce((total, item) => total + item.rating, 0) / ratings.length
        : null;
      return {
        ...dish,
        averageRating,
        myRating: rating,
        ratingCount: ratings.length,
        ratings
      };
    })
  };
}

export function applyConfirmedMemoryDishRating(
  room: MemoryRoom,
  dishId: string,
  username: string,
  displayName: string,
  confirmedRating: number | null
) {
  if (confirmedRating !== null) {
    return applyMemoryDishRating(room, dishId, username, displayName, confirmedRating);
  }
  return {
    ...room,
    dishes: room.dishes.map((dish) => {
      if (dish.id !== dishId) return dish;
      const ratings = dish.ratings.filter((item) => !sameUsername(item.ratedBy, username));
      return {
        ...dish,
        averageRating: ratings.length > 0
          ? ratings.reduce((total, item) => total + item.rating, 0) / ratings.length
          : null,
        myRating: null,
        ratingCount: ratings.length,
        ratings
      };
    })
  };
}

export function overlayPendingMemoryDishRatings(
  room: MemoryRoom,
  username: string,
  displayName: string
) {
  let next = room;
  for (const flight of ratingFlights.values()) {
    if (flight.intent.roomId !== room.id) continue;
    next = applyMemoryDishRating(
      next,
      flight.intent.dishId,
      username,
      displayName,
      flight.intent.desiredRating
    );
  }
  return next;
}

registerSensitiveResourceCleanup(() => {
  for (const flight of ratingFlights.values()) {
    if (flight.timer) clearTimeout(flight.timer);
    const waiters = flight.waiters.splice(0);
    waiters.forEach((waiter) => waiter.reject(new Error("rating_session_ended")));
  }
  ratingFlights.clear();
  lastRatingSequence = 0;
});
