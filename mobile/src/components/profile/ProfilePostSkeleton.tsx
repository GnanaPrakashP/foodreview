import { HomeFeedSkeleton } from "@/components/home/HomeFeedSkeleton";

export const PROFILE_POST_SPACING = 10;

/** Uses the production Home-shaped skeleton and matching inter-card rhythm. */
export function ProfilePostSkeleton() {
  return (
    <HomeFeedSkeleton
      accessibilityLabel="Loading profile posts"
      postSpacing={PROFILE_POST_SPACING}
    />
  );
}
