const port = process.env.PORT || "3000";
const secret = process.env.MEDIA_WORKER_SECRET?.trim() ?? "";
if (!secret) process.exit(1);

// Container liveness, not fleet health. The only remedy this probe can trigger
// is a restart, and a restart cannot clear a dead letter, an unclaimed queue
// backlog, a stale lease or a missing worker heartbeat — this container is the
// thing that would work those off. Reporting them here inverted the meaning:
// one dead-lettered job inside 24h marked the container unhealthy, the restart
// re-entered the startup gate, and the media pipeline stayed down for a day.
// `startup=1` keeps the checks that describe THIS process — moderation
// provider, worker config, database reachability, ffmpeg/ffprobe, and the local
// server answering at all — and leaves queue degradation to monitoring, which
// can act on it in ways a restart cannot.
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/internal/media/health?startup=1`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(10_000)
  });
  const body = await response.json().catch(() => null);
  process.exit(response.ok && body?.ready === true ? 0 : 1);
} catch {
  process.exit(1);
}
