import type { ImageSourcePropType } from "react-native";

export const achievementBadgeImages: Record<string, ImageSourcePropType> = {
  first_bite: require("../../assets/badges/achievements-transparent-ui/first-bite.png"),
  photo_first: require("../../assets/badges/achievements-transparent-ui/photo-first.png"),
  good_call: require("../../assets/badges/achievements-transparent-ui/good-call.png"),
  food_explorer: require("../../assets/badges/achievements-transparent-ui/food-explorer.png"),
  area_explorer: require("../../assets/badges/achievements-transparent-ui/area-explorer.png"),
  cuisine_explorer: require("../../assets/badges/achievements-transparent-ui/cuisine-explorer.png"),
  cuisine_expert: require("../../assets/badges/achievements-transparent-ui/cuisine-expert.png"),
  crowd_approved: require("../../assets/badges/achievements-transparent-ui/crowd-approved.png"),
  hidden_gem_finder: require("../../assets/badges/achievements-transparent-ui/hidden-gem-finder.png"),
  visit_driver: require("../../assets/badges/achievements-transparent-ui/visit-driver.png"),
  dozen_reviews: require("../../assets/badges/achievements-transparent-ui/dozen-reviews.png"),
  twenty_five_reviews: require("../../assets/badges/achievements-transparent-ui/twenty-five-reviews.png"),
  hundred_reviews: require("../../assets/badges/achievements-transparent-ui/hundred-reviews.png"),
  save_magnet: require("../../assets/badges/achievements-transparent-ui/save-magnet.png"),
  must_try: require("../../assets/badges/achievements-transparent-ui/must-try.png"),
  taste_pioneer: require("../../assets/badges/achievements-transparent-ui/taste-pioneer.png"),
  regular: require("../../assets/badges/achievements-transparent-ui/regular.png"),
  neighborhood_guide: require("../../assets/badges/achievements-transparent-ui/neighborhood-guide.png"),
  multi_photo: require("../../assets/badges/achievements-transparent-ui/multi-photo.png"),
  detail_master: require("../../assets/badges/achievements-transparent-ui/detail-master.png"),
  weekly_explorer: require("../../assets/badges/achievements-transparent-ui/weekly-explorer.png"),
  monthly_explorer: require("../../assets/badges/achievements-transparent-ui/monthly-explorer.png")
};

export const tierBadgeImages: Record<string, ImageSourcePropType> = {
  "New Taster": require("../../assets/badges/tiers-transparent-ui/tier-01-new-taster.png"),
  "Rising Taster": require("../../assets/badges/tiers-transparent-ui/tier-02-rising-taster.png"),
  "Food Regular": require("../../assets/badges/tiers-transparent-ui/tier-03-food-regular.png"),
  "Known Regular": require("../../assets/badges/tiers-transparent-ui/tier-04-known-regular.png"),
  "Trusted Palate": require("../../assets/badges/tiers-transparent-ui/tier-05-trusted-palate.png"),
  "Sharp Palate": require("../../assets/badges/tiers-transparent-ui/tier-06-sharp-palate.png"),
  Tastemaker: require("../../assets/badges/tiers-transparent-ui/tier-07-tastemaker.png"),
  "Local Tastemaker": require("../../assets/badges/tiers-transparent-ui/tier-08-local-tastemaker.png"),
  "Food Authority": require("../../assets/badges/tiers-transparent-ui/tier-09-food-authority.png"),
  "Top Food Authority": require("../../assets/badges/tiers-transparent-ui/tier-10-top-food-authority.png"),
  "Culinary Legend": require("../../assets/badges/tiers-transparent-ui/tier-11-culinary-legend.png")
};

export function achievementImageForBadge(badgeId?: string) {
  if (!badgeId) return null;
  const baseId = badgeId.split(":")[0];
  return achievementBadgeImages[baseId] ?? null;
}

export function tierImageForName(tierName: string) {
  return tierBadgeImages[tierName] ?? tierBadgeImages["New Taster"];
}
