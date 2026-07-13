const DEPLOYED_ENVIRONMENTS = new Set(["production", "staging"]);
const SAFE_ENVIRONMENTS = new Set(["local", "test", "development", "preview", "staging", "production"]);
const SAFE_NAME = /^[a-z0-9][a-z0-9._:-]{0,119}$/;
const SECRET_KEY = /(authorization|cookie|credential|password|secret|token|dsn|api.?key|service.?role|private.?key|signed.?url|storage.?path|room.?name|message|body|content|email|ip.?address|expo.?push)/i;
const SECRET_VALUE = /(bearer\s+[a-z0-9._~-]+|eyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}|(?:Expo|Exponent)PushToken\[|[?&](?:token|signature|expires)=|service_role|supabase[_-]service|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;

export function runtimeEnvironment(env = process.env) {
  const value = (env.APP_ENVIRONMENT || env.VERCEL_ENV || (env.NODE_ENV === "test" ? "test" : "local")).trim().toLowerCase();
  return SAFE_ENVIRONMENTS.has(value) ? value : "local";
}

export function runtimeRelease(env = process.env) {
  const value = (env.APP_RELEASE || env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || "local").trim();
  return /^[A-Za-z0-9._-]{1,120}$/.test(value) ? value : "invalid-release";
}

export function safeErrorCode(error) {
  const value = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/timeout|timed out|abort/i.test(value)) return "temporary_timeout";
  if (/429|rate.?limit/i.test(value)) return "rate_limited";
  if (/permission|forbidden|unauthor|401|403/i.test(value)) return "authorization_failed";
  if (/network|fetch|connect|unavailable|503/i.test(value)) return "dependency_unavailable";
  if (/database|postgres|postgrest|sql/i.test(value)) return "database_failure";
  if (/storage|bucket|object/i.test(value)) return "storage_failure";
  if (/provider/i.test(value)) return "provider_failure";
  return "operation_failed";
}

function redactString(value) {
  const trimmed = value.slice(0, 256);
  if (SECRET_VALUE.test(trimmed)) return "[REDACTED]";
  try {
    const parsed = new URL(trimmed);
    return `${parsed.origin}${parsed.pathname}`.slice(0, 160);
  } catch {
    return trimmed;
  }
}

export function sanitizeTelemetryValue(value, key = "", depth = 0) {
  if (value === null || value === undefined || typeof value === "boolean") return value ?? null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (depth >= 5) return "[TRUNCATED]";
  if (value instanceof Error) return { error_code: safeErrorCode(value), error_type: value.name.slice(0, 80) };
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeTelemetryValue(item, "item", depth + 1));
  if (typeof value === "object") {
    const output = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 40)) {
      output[childKey] = sanitizeTelemetryValue(childValue, childKey, depth + 1);
    }
    return output;
  }
  return String(value).slice(0, 80);
}

export function sanitizeTelemetryEvent(event) {
  const sanitized = sanitizeTelemetryValue(event);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return null;
  const output = { ...sanitized };
  delete output.user;
  delete output.request;
  if (Array.isArray(output.breadcrumbs)) {
    output.breadcrumbs = output.breadcrumbs.slice(-30).map((breadcrumb) => ({
      category: sanitizeTelemetryValue(breadcrumb?.category, "category"),
      level: sanitizeTelemetryValue(breadcrumb?.level, "level"),
      timestamp: sanitizeTelemetryValue(breadcrumb?.timestamp, "timestamp"),
      type: sanitizeTelemetryValue(breadcrumb?.type, "type")
    }));
  }
  if (output.exception && typeof output.exception === "object" && Array.isArray(output.exception.values)) {
    output.exception = {
      ...output.exception,
      values: output.exception.values.slice(0, 5).map((entry) => ({
        mechanism: sanitizeTelemetryValue(entry?.mechanism, "mechanism"),
        stacktrace: sanitizeTelemetryValue(entry?.stacktrace, "stacktrace"),
        type: sanitizeTelemetryValue(entry?.type, "type"),
        value: safeErrorCode(String(entry?.value ?? ""))
      }))
    };
  }
  if (typeof output.message === "string") output.message = safeErrorCode(output.message);
  return output;
}

export function safeCorrelationId(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/.test(normalized) ? normalized : null;
}

export function createOperationalLogger({ service, captureException } = {}) {
  if (!SAFE_NAME.test(service || "")) throw new Error("observability_service_invalid");
  const environment = runtimeEnvironment();
  const release = runtimeRelease();

  function emit(severity, event, fields = {}) {
    try {
      const safeEvent = SAFE_NAME.test(event || "") ? event : "invalid_event";
      const record = sanitizeTelemetryValue({
        timestamp: new Date().toISOString(),
        severity,
        environment,
        service,
        release,
        event: safeEvent,
        ...fields
      });
      const line = JSON.stringify(record);
      if (severity === "error" || severity === "fatal") console.error(line);
      else if (severity === "warn") console.warn(line);
      else console.info(line);
      return record;
    } catch {
      try {
        console.error(JSON.stringify({ severity: "error", service, event: "logger_failure" }));
      } catch {
        // Logging must never fail the application path.
      }
      return null;
    }
  }

  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error(event, error, fields = {}) {
      const errorCode = safeErrorCode(error);
      const record = emit("error", event, { ...fields, error_code: errorCode });
      try {
        captureException?.(new Error(errorCode), sanitizeTelemetryValue(fields));
      } catch {
        emit("warn", "telemetry_provider_unavailable", { original_event: event });
      }
      return record;
    },
    metadata: { environment, release, service, deployed: DEPLOYED_ENVIRONMENTS.has(environment) }
  };
}
