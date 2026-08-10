# Production observability

Witoh uses three bounded signal layers: Sentry for application crashes/errors/traces, structured JSON logs for searchable operational events, and service-role-only database health functions for durable queue, scheduler, and database state. The database is the source of truth for jobs; telemetry loss never changes a job outcome.

## Services and release identity

Services are `foodreview-api`, `foodreview-scheduler`, `foodreview-push`, `foodreview-media-worker`, `foodreview-account-deletion`, and the React Native release `com.circlebites.mobile@<app-version>+<release-id>`. Every deployed signal includes environment and release. API logs additionally include a generated or validated request/correlation ID, bounded endpoint label, status category, duration, and payload-size category.

Production startup is rejected unless a non-local release and Sentry DSN are configured. Sentry is fail-open after initialization: provider failure cannot fail an API, worker, cleanup, or UI path.

## Mobile coverage

Native crashes, Android NDK crashes, iOS watchdog terminations, app hangs/ANRs, sessions, app start, and native frame tracking are enabled in production builds. Critical aggregate flows include session resolution, owner-cache hydration and cleanup, cold boundary readiness, warm resume, connectivity changes, API requests, feed markers, media intent/source/finalize/processing, Memory room/chat/realtime, comments, and account-deletion request.

No user identity is attached. Screenshots, view hierarchy, default PII, content, message bodies, room names, email, push tokens, storage paths, signed URLs, cookies, authorization headers, credentials, and precise IP data are excluded or redacted.

## API and worker coverage

Mobile middleware overwrites the internal start time, accepts only bounded safe request IDs, and returns `X-Request-Id` and `X-Correlation-Id`. Mobile clients create a request ID and carry it into safe error context. API completion emits once per request. Expected 4xx outcomes are warnings; 5xx and unexpected failures are captured.

Worker logs are aggregate JSON. Media processing and account deletion record durable service heartbeats. Scheduled API jobs record started/succeeded/failed rows and update a one-row heartbeat. Push stores ticket and receipt state without duplicating notification text or Expo tokens.

## Operator commands

All reports are read-only unless their command explicitly contains `:apply` and a confirmation token.

- `npm run operations:health` — full sanitized health and threshold evaluation.
- `npm run operations:health:media` — media queue subsection.
- `npm run operations:health:deletion` — deletion subsection.
- `npm run operations:health:push` — push subsection.
- `npm run operations:health:scheduler` — scheduler subsection.
- `npm run operations:release` — environment/release/migration identity.
- `npm run push:reconcile` — dry-run stale lease count.
- `npm run push:reconcile:apply` — explicitly confirmed stale lease requeue.
- `npm run backup:restore-drill:local` — destructive only to a generated temporary local database.

Exit code `2` from operations health means a critical threshold or migration-head mismatch. Exit code `1` means health could not be read or configuration is incomplete.

## Dashboards

Create Sentry views for mobile crash-free sessions, ANR/app-hang rate, cold-start p95, API 5xx rate, endpoint p95/p99, and errors grouped by environment/release. Create database panels from `production_operations_health()` for connections/waits, invalid indexes/constraints, media/push/moderation/deletion age and terminal counts, and scheduler missed/failing jobs. Never place raw notification, profile, Memory, review, or storage records on an operational dashboard.
