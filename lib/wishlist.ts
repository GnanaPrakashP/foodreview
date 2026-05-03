export interface WishlistItem {
  id: string;
  restaurant_name: string;
  dish_name?: string;
  added_at: string;
}

const KEY = "fc_wishlist";

export function getWishlist(): WishlistItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function addToWishlist(item: Omit<WishlistItem, "added_at">): void {
  const list = getWishlist();
  if (list.some((i) => i.id === item.id)) return;
  list.unshift({ ...item, added_at: new Date().toISOString() });
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function removeFromWishlist(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(getWishlist().filter((i) => i.id !== id)));
}

export function isWishlisted(id: string): boolean {
  return getWishlist().some((i) => i.id === id);
}

export function toggleWishlist(item: Omit<WishlistItem, "added_at">): boolean {
  if (isWishlisted(item.id)) {
    removeFromWishlist(item.id);
    return false;
  }
  addToWishlist(item);
  return true;
}

export function daysSince(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
}
