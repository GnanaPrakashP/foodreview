export type HomeMediaPreparationClass = "carousel-next" | "vertical-next";

export const HOME_BACKGROUND_MEDIA_PREPARATION_CONCURRENCY = 1;
export const HOME_BACKGROUND_MEDIA_PENDING_LIMIT = 2;

export function homeMediaPreparationPriority(
  preparationClass: HomeMediaPreparationClass,
  interactive = false
) {
  if (preparationClass === "carousel-next" && interactive) return 30;
  if (preparationClass === "vertical-next") return 20;
  return 10;
}

export function shouldPreemptHomeMediaPreparation(
  active: { interactive?: boolean; preparationClass: HomeMediaPreparationClass },
  incoming: { interactive?: boolean; preparationClass: HomeMediaPreparationClass }
) {
  return homeMediaPreparationPriority(incoming.preparationClass, incoming.interactive) >
    homeMediaPreparationPriority(active.preparationClass, active.interactive);
}
