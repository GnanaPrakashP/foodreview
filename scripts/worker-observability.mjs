import * as Sentry from "@sentry/node";
import {
  createOperationalLogger,
  runtimeEnvironment,
  runtimeRelease,
  sanitizeTelemetryEvent,
  sanitizeTelemetryValue
} from "../lib/observability/structured-log.mjs";

const environment = runtimeEnvironment();
const release = runtimeRelease();
const dsn = process.env.SENTRY_DSN?.trim() || "";
if (environment === "production" && (!dsn || release === "local" || release === "invalid-release")) {
  throw new Error("production_worker_observability_configuration_required");
}
const parsedRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE);
Sentry.init({
  beforeSend: (event) => sanitizeTelemetryEvent(event),
  dsn: dsn || undefined,
  enabled: Boolean(dsn) && !["local", "test", "development"].includes(environment),
  environment,
  release,
  sendDefaultPii: false,
  tracesSampleRate: Number.isFinite(parsedRate) && parsedRate >= 0 && parsedRate <= 1 ? parsedRate : environment === "production" ? 0.1 : 0
});

export function workerLogger(service) {
  return createOperationalLogger({
    service,
    captureException(error, fields) {
      Sentry.withScope((scope) => {
        scope.setContext("operation", sanitizeTelemetryValue(fields));
        Sentry.captureException(error);
      });
    }
  });
}

export async function flushWorkerTelemetry(timeoutMs = 2000) {
  try {
    return await Sentry.flush(timeoutMs);
  } catch {
    return false;
  }
}
