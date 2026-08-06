import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { applyCreatedPostInvalidations } from "@/hooks/useCreatePost";
import { captureMobileError, recordMobileFlow } from "@/observability/mobileTelemetry";
import { mediaProcessingIssueKind } from "@/services/mediaPipeline";
import { createPost } from "@/services/posts";
import { deletePendingPost, readPendingPosts } from "@/services/postingQueueStore";
import { usePostingStore } from "@/stores/postingStore";
import { useSessionStore } from "@/stores/sessionStore";

/**
 * Owns every post the composer has handed off. Sharing enqueues and walks away,
 * so the request cannot live in the screen that started it — this runs from the
 * tab layout, which outlives any single tab.
 *
 * It calls the service directly rather than through useCreatePostMutation: one
 * mutation observer holds a single set of per-call callbacks, so two posts in
 * flight would overwrite each other's completion handling. Draining one at a
 * time also keeps concurrent uploads off the same uplink; a person can still
 * queue as many posts as they like without waiting.
 */
export function PostingQueueRunner() {
  const queryClient = useQueryClient();
  const username = useSessionStore((state) => state.profile?.username ?? "");
  const jobs = usePostingStore((state) => state.jobs);
  const runningRef = useRef<string | null>(null);
  const restoredForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!username) {
      restoredForRef.current = null;
      return;
    }
    if (restoredForRef.current === username) return;
    restoredForRef.current = username;
    // A post interrupted by a process kill returns as failed rather than
    // restarting by itself: its media may already be uploaded, and a post
    // appearing minutes later without the person asking is worse than a
    // visible "didn't finish" they can retry.
    const store = usePostingStore.getState();
    for (const entry of readPendingPosts()) {
      if (store.jobs.some((job) => job.id === entry.id)) continue;
      store.enqueue({ id: entry.id, input: entry.input, mediaCount: entry.mediaCount });
      store.fail(entry.id, "This post did not finish. Tap to try again.");
    }
  }, [username]);

  useEffect(() => {
    if (runningRef.current) return;
    const next = jobs.find((job) => job.status === "queued");
    if (!next) return;

    runningRef.current = next.id;
    const startedAt = Date.now();
    const store = usePostingStore.getState();
    store.setProgress(next.id, 0);

    void createPost({
      ...next.input,
      onUploadProgress: (progress) => usePostingStore.getState().setProgress(next.id, progress)
    }).then(
      () => {
        runningRef.current = null;
        recordMobileFlow("post.background_publish", Date.now() - startedAt, "success", {
          media_count: next.mediaCount
        });
        // The snapshot exists only until the server has the post.
        deletePendingPost(next.id);
        usePostingStore.getState().remove(next.id);
        applyCreatedPostInvalidations(queryClient);
      },
      (error: unknown) => {
        runningRef.current = null;
        // A permanent media outcome — the safety review refusing it, an
        // unsupported file — will fail the same way every time, so the strip
        // must not invite a retry that cannot work.
        const kind = mediaProcessingIssueKind(error) === "permanent" ? "permanent" : "retryable";
        recordMobileFlow("post.background_publish", Date.now() - startedAt, "failure", {
          failure_kind: kind,
          media_count: next.mediaCount
        });
        captureMobileError("post.background_publish_failed", error);
        usePostingStore.getState().fail(
          next.id,
          error instanceof Error && error.message ? error.message : "Could not share this post.",
          kind
        );
      }
    );
  }, [jobs, queryClient]);

  return null;
}
