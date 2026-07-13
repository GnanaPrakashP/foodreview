const port = process.env.PORT || "3000";
const secret = process.env.MEDIA_WORKER_SECRET?.trim() ?? "";
if (!secret) process.exit(1);

try {
  const response = await fetch(`http://127.0.0.1:${port}/api/internal/media/health`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(10_000)
  });
  const body = await response.json().catch(() => null);
  process.exit(response.ok && body?.ready === true ? 0 : 1);
} catch {
  process.exit(1);
}
