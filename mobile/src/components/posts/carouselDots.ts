export type CarouselDot = { index: number; scale: "current" | "near" | "far" };

export function carouselDotWindow(total: number, currentIndex: number): CarouselDot[] {
  if (total <= 1) return [];
  const safeCurrent = Math.max(0, Math.min(currentIndex, total - 1));
  if (total <= 5) {
    return Array.from({ length: total }, (_, index) => ({
      index,
      scale: index === safeCurrent ? "current" as const : "near" as const
    }));
  }
  const start = Math.max(0, Math.min(safeCurrent - 2, total - 5));
  return Array.from({ length: 5 }, (_, offset) => {
    const index = start + offset;
    return {
      index,
      scale: index === safeCurrent
        ? "current" as const
        : (offset === 0 && start > 0) || (offset === 4 && start + 5 < total)
          ? "far" as const
          : "near" as const
    };
  });
}
