import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import { Platform } from "react-native";

const SAFE_ENVIRONMENTS = new Set(["local", "development", "preview", "staging", "production", "test"]);
const SENSITIVE_KEY = /(authorization|cookie|credential|password|secret|token|dsn|api.?key|service.?role|signed.?url|storage.?path|message|body|content|email|ip.?address)/i;
const SENSITIVE_VALUE = /(bearer\s+|eyJ[a-z0-9_-]{8,}\.|(?:Expo|Exponent)PushToken\[|[?&](?:token|signature|expires)=|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;

function boundedRate(value: string | undefined, fallback: number) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 && numberValue <= 1 ? numberValue : fallback;
}

export function safeMobileErrorCode(error: unknown) {
  const value = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/timeout|timed out|abort/i.test(value)) return "temporary_timeout";
  if (/network|fetch|connect|unavailable/i.test(value)) return "network_unavailable";
  if (/auth|session|jwt|401|403/i.test(value)) return "authentication_failure";
  if (/storage|upload|media/i.test(value)) return "media_operation_failure";
  if (/cache|hydrate|cleanup/i.test(value)) return "local_state_failure";
  if (/realtime|socket|channel/i.test(value)) return "realtime_failure";
  return "mobile_operation_failure";
}

export function sanitizeMobileTelemetry(value: unknown, key = "", depth = 0): unknown {
  if (value === null || value === undefined || typeof value === "boolean") return value ?? null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return SENSITIVE_VALUE.test(value) ? "[REDACTED]" : value.slice(0, 160);
  if (depth >= 4) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => sanitizeMobileTelemetry(entry, "item", depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 30).map(([childKey, childValue]) => [
      childKey,
      sanitizeMobileTelemetry(childValue, childKey, depth + 1)
    ]));
  }
  return null;
}

const environmentValue = (process.env.EXPO_PUBLIC_APP_ENVIRONMENT || "local").trim().toLowerCase();
const environment = SAFE_ENVIRONMENTS.has(environmentValue) ? environmentValue : "local";
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() || "";
const configuredRelease = process.env.EXPO_PUBLIC_RELEASE_ID?.trim() || "local";
const applicationVersion = Constants.expoConfig?.version || "0.1.0";
const buildNumber = Platform.OS === "ios"
  ? Constants.expoConfig?.ios?.buildNumber || "1"
  : String(Constants.expoConfig?.android?.versionCode || 1);
const release = `com.circlebites.mobile@${applicationVersion}+${configuredRelease}`;
const enabled = Boolean(dsn) && !__DEV__ && environment !== "local" && environment !== "test";

if (environment === "production" && (!dsn || configuredRelease === "local")) {
  throw new Error("production_mobile_observability_configuration_required");
}

Sentry.init({
  dsn: dsn || undefined,
  enabled,
  environment,
  release,
  dist: buildNumber,
  sendDefaultPii: false,
  tracesSampleRate: boundedRate(process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE, environment === "production" ? 0.1 : 0),
  enableNative: true,
  enableNativeCrashHandling: true,
  enableNdk: true,
  enableAppHangTracking: true,
  enableWatchdogTerminationTracking: true,
  enableAutoSessionTracking: true,
  enableAppStartTracking: true,
  enableNativeFramesTracking: true,
  attachScreenshot: false,
  attachViewHierarchy: false,
  beforeSend(event) {
    const sanitized = sanitizeMobileTelemetry(event) as typeof event;
    if (!sanitized) return null;
    delete sanitized.user;
    delete sanitized.request;
    if (sanitized.exception?.values) {
      sanitized.exception.values = sanitized.exception.values.map((entry) => ({
        ...entry,
        value: safeMobileErrorCode(entry.value)
      }));
    }
    sanitized.breadcrumbs = sanitized.breadcrumbs?.slice(-30).map((entry) => ({
      category: entry.category,
      level: entry.level,
      timestamp: entry.timestamp,
      type: entry.type
    }));
    return sanitized;
  },
  initialScope: {
    tags: {
      app_environment: environment,
      app_platform: Platform.OS,
      app_release: configuredRelease
    }
  }
});

export const MOBILE_TELEMETRY_ENABLED = enabled;
export const MOBILE_RELEASE_METADATA = Object.freeze({
  applicationVersion,
  buildNumber,
  environment,
  platform: Platform.OS,
  release: configuredRelease
});

export function captureMobileError(event: string, error: unknown, context: Record<string, unknown> = {}) {
  if (!enabled) return;
  try {
    const code = safeMobileErrorCode(error);
    Sentry.withScope((scope) => {
      scope.setTag("mobile_event", event.replace(/[^a-z0-9._-]/gi, "_").slice(0, 80));
      scope.setContext("mobile_operation", sanitizeMobileTelemetry(context) as Record<string, unknown>);
      Sentry.captureException(new Error(code));
    });
  } catch {
    // Telemetry is never part of the application success path.
  }
}

export function recordMobileFlow(
  name: string,
  durationMs: number,
  outcome: "success" | "failure",
  attributes: Record<string, string | number | boolean> = {}
) {
  if (!enabled || !Number.isFinite(durationMs) || durationMs < 0) return;
  try {
    const span = Sentry.startInactiveSpan({
      attributes: sanitizeMobileTelemetry({ ...attributes, outcome }) as Record<string, string | number | boolean>,
      forceTransaction: true,
      name: name.replace(/[^a-z0-9._-]/gi, "_").slice(0, 80),
      op: "mobile.flow",
      startTime: new Date(Date.now() - durationMs)
    });
    span.setStatus({ code: outcome === "success" ? 1 : 2 });
    span.end();
  } catch {
    // Performance reporting must remain fail-open.
  }
}

export function clearMobileTelemetryIdentity() {
  try {
    Sentry.setUser(null);
    Sentry.getCurrentScope().setContext("account", null);
  } catch {
    // No identity is set by default; clearing is best effort during teardown.
  }
}

export const wrapRootLayout = Sentry.wrap;
