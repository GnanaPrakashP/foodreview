import { hasCircleAccess } from "@/lib/circle-db";

type ReviewAccessDb = {
  from: (table: string) => any;
};

type ReviewAccessResult =
  | { allowed: true }
  | { allowed: false; status: 403 | 404; error: string };

type ReviewAccessRow = {
  reviewer_name: string;
  visibility: string | null;
  deleted_at: string | null;
  hidden_at: string | null;
  reported_at: string | null;
  status: string | null;
};

function isSuppressed(review: ReviewAccessRow) {
  return Boolean(review.deleted_at || review.hidden_at || review.reported_at) ||
    ["deleted", "hidden", "reported", "removed"].includes((review.status ?? "").toLowerCase());
}

export async function canActorReadPost(
  db: ReviewAccessDb,
  postId: string,
  actorName: string
): Promise<ReviewAccessResult> {
  const { data: review, error } = await db
    .from("reviews")
    .select("reviewer_name, visibility, deleted_at, hidden_at, reported_at, status")
    .eq("id", postId)
    .maybeSingle();

  if (error) return { allowed: false, status: 404, error: "Post not found" };
  if (!review) return { allowed: false, status: 404, error: "Post not found" };

  const row = review as ReviewAccessRow;
  if (isSuppressed(row)) return { allowed: false, status: 404, error: "Post not found" };
  if (row.reviewer_name === actorName) return { allowed: true };

  const visibility = row.visibility === "circle" || row.visibility === "me" ? row.visibility : "public";
  if (visibility === "public") return { allowed: true };
  if (visibility === "circle" && await hasCircleAccess(db, row.reviewer_name, actorName)) {
    return { allowed: true };
  }

  return { allowed: false, status: 403, error: "Post is not visible to this user" };
}
