type PostViewsDb = {
  from: (table: string) => any;
};

const MAX_SERVER_SEEN_POSTS = 700;

export async function loadSeenPostIdsForUser(
  db: PostViewsDb,
  userId: string | null | undefined,
  extraPostIds: string[] = []
): Promise<Set<string>> {
  const postIds = new Set(extraPostIds.map((id) => id.trim()).filter(Boolean));
  if (!userId) return postIds;

  try {
    const { data, error } = await db
      .from("post_views")
      .select("post_id")
      .eq("user_id", userId)
      .order("viewed_at", { ascending: false })
      .limit(MAX_SERVER_SEEN_POSTS);

    if (error) return postIds;
    for (const row of (data ?? []) as { post_id?: string | null }[]) {
      if (row.post_id) postIds.add(row.post_id);
    }
  } catch {
    // The migration may not be applied yet in local/dev environments.
  }

  return postIds;
}

export async function recordSeenPostIdsForUser(db: PostViewsDb, userId: string, postIds: string[]) {
  const uniquePostIds = Array.from(new Set(postIds.map((id) => id.trim()).filter(Boolean))).slice(0, 100);
  if (!userId || uniquePostIds.length === 0) return { ok: true, count: 0 };

  const viewedAt = new Date().toISOString();
  const rows = uniquePostIds.map((postId) => ({
    user_id: userId,
    post_id: postId,
    viewed_at: viewedAt,
  }));

  const { error } = await db
    .from("post_views")
    .upsert(rows, { onConflict: "user_id,post_id" });

  if (error) return { ok: false, count: 0, error };
  return { ok: true, count: uniquePostIds.length };
}
