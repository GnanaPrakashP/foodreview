import { runtimeEnvironment, runtimeRelease } from "@/lib/observability/structured-log.mjs";

const SAMPLE_RATE = /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/;

function sampleRate(value: string | undefined, fallback: number) {
  const normalized = value?.trim() ?? "";
  return SAMPLE_RATE.test(normalized) ? Number(normalized) : fallback;
}

export function serverObservabilityConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const environment = runtimeEnvironment(env);
  const release = runtimeRelease(env);
  const dsn = env.SENTRY_DSN?.trim() || "";
  if (environment === "production") {
    if (!dsn) throw new Error("production_sentry_dsn_required");
    if (release === "local" || release === "invalid-release") throw new Error("production_release_required");
  }
  return {
    dsn,
    enabled: Boolean(dsn) && environment !== "local" && environment !== "test" && environment !== "development",
    environment,
    release,
    tracesSampleRate: sampleRate(env.SENTRY_TRACES_SAMPLE_RATE, environment === "production" ? 0.1 : 0)
  };
}

export function safeReleaseMetadata(env: NodeJS.ProcessEnv = process.env) {
  const config = serverObservabilityConfiguration(env);
  return {
    environment: config.environment,
    release: config.release,
    applicationVersion: env.npm_package_version || "0.1.0",
    databaseMigrationHead: "202607130010"
  };
}
