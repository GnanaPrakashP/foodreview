import type { MemoryDish } from "@/types/models";

export function optimisticMemoryDish(input: {
  addedBy: string;
  addedByDisplayName?: string | null;
  createdAt: string;
  dishId: string;
  dishName: string;
  note?: string | null;
  rating?: number | null;
  roomId: string;
}): MemoryDish;
