import * as Sentry from "@sentry/nextjs";
import { serverObservabilityConfiguration } from "@/lib/observability/config";
import { sanitizeTelemetryEvent } from "@/lib/observability/structured-log.mjs";

const config = serverObservabilityConfiguration();

Sentry.init({
  dsn: config.dsn || undefined,
  enabled: config.enabled,
  environment: config.environment,
  release: config.release,
  sendDefaultPii: false,
  tracesSampleRate: config.tracesSampleRate,
  beforeSend: (event) => sanitizeTelemetryEvent(event)
});
