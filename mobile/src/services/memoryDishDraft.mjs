// Relative, not aliased: this module is imported directly by node tests.

// The card an added dish shows before the insert is acknowledged. It has to be
// the row the next read will produce, not an approximation: the id is minted on
// the device and sent as the primary key, and the rating is shaped the way
// mapMemoryDish shapes the dish table's own `rating` column. Anything that
// differs here is something the user watches change under them at confirmation.
export function optimisticMemoryDish({
  addedBy,
  addedByDisplayName,
  createdAt,
  dishId,
  dishName,
  note = null,
  rating = null,
  roomId
}) {
  const score = rating && rating > 0 ? rating : null;
  return {
    addedBy,
    addedByDisplayName: addedByDisplayName || addedBy,
    averageRating: score,
    createdAt,
    dishName: dishName.trim(),
    id: dishId,
    myRating: score,
    note: note?.trim() || null,
    rating: score,
    ratingCount: score === null ? 0 : 1,
    ratings: score === null ? [] : [{
      createdAt,
      dishId,
      id: `legacy:${dishId}:${addedBy}`,
      ratedBy: addedBy,
      ratedByDisplayName: addedByDisplayName || addedBy,
      rating: score,
      roomId,
      updatedAt: createdAt
    }],
    roomId,
    stopId: null
  };
}
