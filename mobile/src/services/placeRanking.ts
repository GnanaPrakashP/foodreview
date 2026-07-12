// Prototype ranking for the Explore "Places" tab.
//
// Instead of ordering strictly by distance, we bucket places into distance rings
// and order by a quality score *within* each ring, nearest ring first. So a far
// 5-star place never outranks nearby places, but within a ring quality decides.
// Weights and ring edges are deliberately simple constants — tune with real data.

export type RankablePlace = {
  averageRating: number | null;
  ratingCount: number;
  postCount: number;
  circleCount: number;
  distanceKm: number | null;
  name: string;
};

// Distance ring edges in km. A place beyond the last edge is dropped when a
// location is set (see rankPlaces). Tighten these for dense metros.
export const PLACE_DISTANCE_BANDS_KM = [10, 30, 60, 100];

// Everything is still shown — nearer rings just come first. Places past the last
// ring go to the very bottom, and places with no coordinates just after them.
// (Dropping far places starved the sparse-RPC backfill and left the tab nearly
// empty, so we demote instead of drop.)
const TOO_FAR_BAND = PLACE_DISTANCE_BANDS_KM.length;
const UNKNOWN_DISTANCE_BAND = PLACE_DISTANCE_BANDS_KM.length + 1;

// Bayesian smoothing pulls sparse ratings toward the global mean so a single
// 5-star review can't beat a 4.6 with hundreds of reviews.
const RATING_PRIOR_WEIGHT = 5;
const GLOBAL_MEAN_FALLBACK = 4;

// Quality-score weights. Rating dominates; visits and circle proof nudge.
const WEIGHT_RATING = 1;
const WEIGHT_VISITS = 0.55;
const WEIGHT_CIRCLE = 0.5;
const MAX_CIRCLE_PROOF = 3;

// The feed stores a squared "degree distance" (equirectangular, longitude scaled).
// 1° ≈ 111 km, so sqrt(score) × 111 is a good-enough km estimate for banding.
export function distanceKmFromRankScore(rankScore: number | null): number | null {
  if (rankScore === null || !Number.isFinite(rankScore)) return null;
  return Math.sqrt(rankScore) * 111;
}

export function placeDistanceBand(distanceKm: number | null): number {
  if (distanceKm === null) return UNKNOWN_DISTANCE_BAND;
  for (let index = 0; index < PLACE_DISTANCE_BANDS_KM.length; index += 1) {
    if (distanceKm <= PLACE_DISTANCE_BANDS_KM[index]) return index;
  }
  return TOO_FAR_BAND;
}

export function bayesianRating(averageRating: number | null, ratingCount: number, globalMean: number): number {
  if (averageRating === null || ratingCount <= 0) return globalMean;
  const weight = ratingCount / (ratingCount + RATING_PRIOR_WEIGHT);
  return weight * averageRating + (1 - weight) * globalMean;
}

export function globalMeanRating(places: RankablePlace[]): number {
  let sum = 0;
  let count = 0;
  for (const place of places) {
    if (place.averageRating !== null && place.ratingCount > 0) {
      sum += place.averageRating * place.ratingCount;
      count += place.ratingCount;
    }
  }
  return count > 0 ? sum / count : GLOBAL_MEAN_FALLBACK;
}

export function placeQualityScore(place: RankablePlace, globalMean: number): number {
  const rating = bayesianRating(place.averageRating, place.ratingCount, globalMean);
  const visits = Math.log1p(Math.max(0, place.postCount));
  const circle = Math.min(Math.max(0, place.circleCount), MAX_CIRCLE_PROOF);
  return WEIGHT_RATING * rating + WEIGHT_VISITS * visits + WEIGHT_CIRCLE * circle;
}

// Orders places for the Places tab. With a location: bucket by distance ring
// (nearest first), order by quality within each ring, and drop anything beyond
// the last ring. Without a location: fall back to pure quality ranking.
export function rankPlaces<T extends RankablePlace>(places: T[], hasLocation: boolean): T[] {
  const globalMean = globalMeanRating(places);
  return places
    .map((place) => ({
      place,
      band: hasLocation ? placeDistanceBand(place.distanceKm) : 0,
      score: placeQualityScore(place, globalMean)
    }))
    .sort((a, b) =>
      a.band - b.band
      || b.score - a.score
      || (a.place.distanceKm ?? Number.POSITIVE_INFINITY) - (b.place.distanceKm ?? Number.POSITIVE_INFINITY)
      || a.place.name.localeCompare(b.place.name)
    )
    .map((entry) => entry.place);
}
