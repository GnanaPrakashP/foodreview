import { create } from "zustand";
import type { CreatePostInput } from "@/services/posts";

export type PostingStatus = "queued" | "uploading" | "processing" | "failed";

// A rejection by the safety review will fail identically forever, so it must
// not be offered as something to retry.
export type PostingFailureKind = "permanent" | "retryable";

export type PostingJob = {
  error: string | null;
  failureKind: PostingFailureKind;
  id: string;
  input: Omit<CreatePostInput, "onUploadProgress">;
  mediaCount: number;
  progress: number;
  startedAt: number;
  status: PostingStatus;
};

type PostingState = {
  // A list, not a slot. Sharing hands the post off and returns an empty
  // composer, so a second post can be started while the first is still on its
  // way — the bar has to describe several at once.
  jobs: PostingJob[];
  enqueue: (job: Pick<PostingJob, "id" | "input" | "mediaCount">) => void;
  fail: (id: string, error: string, failureKind?: PostingFailureKind) => void;
  remove: (id: string) => void;
  requeue: (id: string) => void;
  setProgress: (id: string, progress: number) => void;
  reset: () => void;
};

// The upload phase reports 0..0.9 and the shared processing wait fills the
// rest, so the bar keeps moving through a stage that has no byte count.
const PROCESSING_THRESHOLD = 0.9;

function patch(jobs: PostingJob[], id: string, change: Partial<PostingJob>) {
  return jobs.map((job) => (job.id === id ? { ...job, ...change } : job));
}

export const usePostingStore = create<PostingState>((set) => ({
  jobs: [],
  enqueue: ({ id, input, mediaCount }) => set((state) => ({
    jobs: [
      ...state.jobs.filter((job) => job.id !== id),
      {
        error: null,
        failureKind: "retryable",
        id,
        input,
        mediaCount,
        progress: 0,
        startedAt: Date.now(),
        status: "queued"
      }
    ]
  })),
  fail: (id, error, failureKind = "retryable") => set((state) => ({
    jobs: patch(state.jobs, id, { error, failureKind, status: "failed" })
  })),
  remove: (id) => set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) })),
  requeue: (id) => set((state) => ({
    jobs: patch(state.jobs, id, {
      error: null,
      failureKind: "retryable",
      progress: 0,
      startedAt: Date.now(),
      status: "queued"
    })
  })),
  setProgress: (id, progress) => set((state) => {
    const bounded = Math.max(0, Math.min(progress, 1));
    return {
      jobs: patch(state.jobs, id, {
        progress: bounded,
        status: bounded >= PROCESSING_THRESHOLD ? "processing" : "uploading"
      })
    };
  }),
  reset: () => set({ jobs: [] })
}));

export function postingJobsInFlight(jobs: PostingJob[]) {
  return jobs.filter((job) => job.status !== "failed");
}

export function postingOverallProgress(jobs: PostingJob[]) {
  const active = postingJobsInFlight(jobs);
  if (active.length === 0) return 0;
  return active.reduce((total, job) => total + job.progress, 0) / active.length;
}
