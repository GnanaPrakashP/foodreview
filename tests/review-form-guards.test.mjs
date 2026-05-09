import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/reviews/ReviewForm.tsx", import.meta.url),
  "utf8",
);

test("ReviewForm: restaurant validation requires a selected dropdown suggestion", () => {
  assert.match(source, /const selectedRestaurantName = pickedRestaurantNameRef\.current\?\.trim\(\)\.toLowerCase\(\)/);
  assert.match(source, /const currentRestaurantName = restaurantName\.trim\(\)\.toLowerCase\(\)/);
  assert.match(source, /!restaurantId \|\| selectedRestaurantName !== currentRestaurantName/);
  assert.match(source, /Select a restaurant from the dropdown list\./);
});

test("ReviewForm: typing after selection clears stale place metadata", () => {
  assert.match(source, /function handleRestaurantInput\(v: string\)/);
  assert.match(source, /pickedRestaurantNameRef\.current = null/);
  assert.match(source, /setRestaurantId\(null\)/);
  assert.match(source, /setRestaurantArea\(null\)/);
  assert.match(source, /setRestaurantAddress\(null\)/);
  assert.match(source, /setRestaurantLat\(null\)/);
  assert.match(source, /setRestaurantLng\(null\)/);
});

test("ReviewForm: selected restaurant details are saved into the review payload", () => {
  assert.match(source, /setRestaurantArea\(details\.shortFormattedAddress \|\| suggestion\.secondaryText \|\| null\)/);
  assert.match(source, /setRestaurantAddress\(details\.formattedAddress \|\| null\)/);
  assert.match(source, /setRestaurantLat\(details\.latitude\)/);
  assert.match(source, /setRestaurantLng\(details\.longitude\)/);
  assert.match(source, /if \(restaurantId\) reviewPayload\.restaurant_id = restaurantId/);
  assert.match(source, /if \(restaurantArea\) reviewPayload\.area = restaurantArea/);
  assert.match(source, /if \(restaurantAddress\) reviewPayload\.restaurant_address = restaurantAddress/);
  assert.match(source, /if \(restaurantLat !== null\) reviewPayload\.restaurant_lat = restaurantLat/);
  assert.match(source, /if \(restaurantLng !== null\) reviewPayload\.restaurant_lng = restaurantLng/);
});

test("ReviewForm: post button remains disabled while submit is in progress", () => {
  assert.match(source, /if \(submitting\) return/);
  assert.match(source, /setSubmitting\(true\)/);
  assert.match(source, /disabled=\{submitting\}/);
  assert.match(source, /\{submitting \? "Posting…" : "Post it"\}/);
  assert.match(source, /catch \(err: unknown\)[\s\S]*setSubmitting\(false\)/);
});
