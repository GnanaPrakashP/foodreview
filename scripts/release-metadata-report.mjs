#!/usr/bin/env node
import { runtimeEnvironment, runtimeRelease } from "../lib/observability/structured-log.mjs";

try {
  const environment = runtimeEnvironment();
  const release = runtimeRelease();
  if (environment === "production" && (!process.env.SENTRY_DSN || release === "local" || release === "invalid-release")) {
    throw new Error("production_release_configuration_required");
  }
  console.log(JSON.stringify({
    applicationVersion: process.env.npm_package_version || "0.1.0",
    databaseMigrationHead: "202607290001",
    environment,
    generatedAt: new Date().toISOString(),
    release
  }, null, 2));
} catch {
  console.error("release-metadata: production observability configuration is incomplete");
  process.exitCode = 1;
}
