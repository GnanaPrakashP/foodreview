import type { Review } from "./types";

/* ─── Keying ─────────────────────────────────────── */

export function visitKey(reviewer: string, restaurant: string): string {
  return `${reviewer}\x00${restaurant}`;
}

/* ─── Visit prompt ───────────────────────────────── */

export interface VisitPrompt {
  visitLabel: string;
  placeholder: string;
  isRegular: boolean;
}

export function getVisitPrompt(existingCount: number): VisitPrompt {
  if (existingCount === 0) return {
    visitLabel: "First time here",
    placeholder: "What's your first impression?",
    isRegular: false,
  };
  if (existingCount === 1) return {
    visitLabel: "You came back",
    placeholder: "What brought you back?",
    isRegular: false,
  };
  if (existingCount === 2) return {
    visitLabel: "Third visit",
    placeholder: "Becoming a regular? What should friends order?",
    isRegular: false,
  };
  if (existingCount === 3) return {
    visitLabel: `Visit #${existingCount + 1}`,
    placeholder: "What's your go-to order now?",
    isRegular: false,
  };
  return {
    visitLabel: `Visit #${existingCount + 1} — You're a Regular`,
    placeholder: "You know this place best — what's the move?",
    isRegular: true,
  };
}

/* ─── Visit counts from review array ────────────── */

export function buildVisitMap(reviews: Review[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of reviews) {
    const k = visitKey(r.reviewer_name, r.restaurant_name);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

/* ─── Per-restaurant dishes tried ───────────────── */

export function buildMyDishMap(myReviews: Review[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const r of myReviews) {
    const set = map.get(r.restaurant_name) ?? new Set<string>();
    for (const item of r.items) {
      if (item.name.trim()) set.add(item.name.trim());
    }
    map.set(r.restaurant_name, set);
  }
  return map;
}

export function buildAllDishMap(allReviews: Review[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const r of allReviews) {
    const set = map.get(r.restaurant_name) ?? new Set<string>();
    for (const item of r.items) {
      if (item.name.trim()) set.add(item.name.trim());
    }
    map.set(r.restaurant_name, set);
  }
  return map;
}

/* ─── Regulars list ──────────────────────────────── */

export interface RegularEntry {
  restaurant: string;
  visits: number;
}

export function getRegulars(
  myReviews: Review[],
  minVisits = 5
): RegularEntry[] {
  const counts = new Map<string, number>();
  for (const r of myReviews) {
    counts.set(r.restaurant_name, (counts.get(r.restaurant_name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, n]) => n >= minVisits)
    .sort((a, b) => b[1] - a[1])
    .map(([restaurant, visits]) => ({ restaurant, visits }));
}

/* ─── Menu Explorer ──────────────────────────────── */

export interface MenuExplorerEntry {
  restaurant: string;
  dishCount: number;
}

export function getMenuExplorers(
  myReviews: Review[],
  minDishes = 5
): MenuExplorerEntry[] {
  const dishMap = buildMyDishMap(myReviews);
  return Array.from(dishMap.entries())
    .filter(([, set]) => set.size >= minDishes)
    .sort((a, b) => b[1].size - a[1].size)
    .map(([restaurant, set]) => ({ restaurant, dishCount: set.size }));
}
