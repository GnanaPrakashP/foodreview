import * as Sentry from "@sentry/nextjs";
import { createOperationalLogger, sanitizeTelemetryValue } from "@/lib/observability/structured-log.mjs";

function captureException(error: Error, fields: unknown) {
  Sentry.withScope((scope) => {
    scope.setContext("operation", sanitizeTelemetryValue(fields));
    Sentry.captureException(error);
  });
}

export const apiLogger = createOperationalLogger({ service: "foodreview-api", captureException });
export const schedulerLogger = createOperationalLogger({ service: "foodreview-scheduler", captureException });
export const pushLogger = createOperationalLogger({ service: "foodreview-push", captureException });
export const mediaWorkerLogger = createOperationalLogger({ service: "foodreview-media-worker", captureException });
export const accountDeletionLogger = createOperationalLogger({ service: "foodreview-account-deletion", captureException });

export function captureServerException(event: string, error: unknown, fields: Record<string, unknown> = {}) {
  return apiLogger.error(event, error, fields);
}
