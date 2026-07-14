#!/usr/bin/env node
import { createServer } from "node:http";
import { strict as assert } from "node:assert";
import { MetricRegistry, evaluateThresholds, loadCapacityConfig, timedRequest } from "./lib.mjs";

const config = await loadCapacityConfig();
const server = createServer((request, response) => {
  const requestId = request.headers["x-request-id"];
  if (!requestId) {
    response.writeHead(400, { "Content-Type": "application/json" }).end('{"error":"request-id-required"}');
    return;
  }
  if (request.url === "/unauthorized") {
    response.writeHead(401, { "Content-Type": "application/json" }).end('{"error":"unauthorized"}');
    return;
  }
  if (request.url === "/limited") {
    response.writeHead(429, { "Content-Type": "application/json", "Retry-After": "1" }).end('{"error":"limited"}');
    return;
  }
  setTimeout(() => response.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}'), 4);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const registry = new MetricRegistry();
try {
  await Promise.all(Array.from({ length: 60 }, (_, index) => timedRequest(registry, "ci-smoke", `http://127.0.0.1:${port}/ok?i=${index}`)));
  await timedRequest(registry, "ci-auth", `http://127.0.0.1:${port}/unauthorized`, { expectedStatuses: [401] });
  await timedRequest(registry, "ci-rate-limit", `http://127.0.0.1:${port}/limited`, { expectedStatuses: [429] });
  const summary = registry.summary();
  const failures = evaluateThresholds(summary, config.thresholds.launch, registry.correctness.length);
  assert.equal(summary.aggregate.requests, 62);
  assert.equal(summary.aggregate.unexpectedErrors, 0);
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ requests: 62, status: "passed", thresholdFailures: 0 }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
