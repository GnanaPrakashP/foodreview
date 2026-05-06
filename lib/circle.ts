import type { AccountType, CircleRelationshipState, Review } from "@/lib/types";
import { canShowInCircleTrending } from "@/lib/visibility";

export const DEFAULT_ACCOUNT_TYPE: AccountType = "private";

export function normalizeAccountType(value: string | null | undefined): AccountType {
  return value === "public" ? "public" : "private";
}

export function accountTypeLabel(accountType: AccountType): string {
  return accountType === "public" ? "Public Account" : "Private Account";
}

export function relationshipLabel(state: CircleRelationshipState): string {
  if (state === "PENDING") return "Requested";
  if (state === "CIRCLE_MUTUAL") return "Mutual Circle";
  if (state === "CIRCLE_ONE_WAY") return "In Circle";
  return "Not in Circle";
}

export function canShowInCircleFeed(
  review: Review,
  viewerName: string,
  joinedCircles: Set<string>,
  _mutualMembers?: Set<string>
): boolean {
  return canShowInCircleTrending(review, {
    viewerName,
    circleOwnerNames: joinedCircles,
  });
}
