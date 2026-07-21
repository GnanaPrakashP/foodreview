import { HomeFeedSkeleton } from "@/components/home/HomeFeedSkeleton";

/** Uses the production PostCard-shaped skeleton without Home's inter-card gap. */
export function ProfilePostSkeleton() {
  return (
    <HomeFeedSkeleton
      accessibilityLabel="Loading profile posts"
      postSpacing={0}
    />
  );
}
