import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { apiLogger } from "@/lib/observability/server";
import { mobileEndpointLabel, requestCorrelation } from "@/lib/server/api-security";

type PerformanceStepKind = "assembly" | "auth" | "database" | "media" | "storage";

type PerformanceStep = {
  durationMs: number;
  kind: PerformanceStepKind;
  name: string;
};

const SAFE_STEP_NAME = /^[a-z0-9][a-z0-9._:-]{0,79}$/;
const requestTraces = new WeakMap<NextRequest, RequestPerformanceTrace>();

function roundedDuration(startedAt: number) {
  return Number(Math.max(0, performance.now() - startedAt).toFixed(3));
}

function safeStepName(name: string) {
  return SAFE_STEP_NAME.test(name) ? name : "invalid_step";
}

function payloadBytes(body: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(body));
  } catch {
    return 0;
  }
}

export class RequestPerformanceTrace {
  readonly enabled: boolean;
  private readonly correlationId: string;
  private readonly endpoint: string;
  private readonly method: string;
  private readonly startedAt = performance.now();
  private readonly steps: PerformanceStep[] = [];
  private finished = false;

  constructor(req: NextRequest, endpoint: string) {
    this.enabled = process.env.API_PERFORMANCE_TRACE_ENABLED === "true";
    this.correlationId = requestCorrelation(req).requestId;
    this.endpoint = safeStepName(endpoint);
    this.method = req.method;
  }

  async measure<T>(kind: PerformanceStepKind, name: string, operation: () => PromiseLike<T> | T): Promise<T> {
    if (!this.enabled) return await operation();
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      this.steps.push({ durationMs: roundedDuration(startedAt), kind, name: safeStepName(name) });
    }
  }

  database<T>(name: string, operation: () => PromiseLike<T> | T) {
    return this.measure("database", name, operation);
  }

  finish(input: { payloadBytes: number; serializationDurationMs: number; status: number }) {
    if (!this.enabled || this.finished) return;
    this.finished = true;
    const databaseSteps = this.steps.filter((step) => step.kind === "database");
    const storageSteps = this.steps.filter((step) => step.kind === "storage");
    const durationFor = (kind: PerformanceStepKind) => Number(this.steps
      .filter((step) => step.kind === kind)
      .reduce((total, step) => total + step.durationMs, 0)
      .toFixed(3));
    apiLogger.info("api_performance_trace", {
      assembly_duration_ms: durationFor("assembly"),
      auth_duration_ms: durationFor("auth"),
      connection_wait_available: false,
      correlation_id: this.correlationId,
      database_call_count: databaseSteps.length,
      database_calls: databaseSteps.map((step) => ({ duration_ms: step.durationMs, name: step.name })),
      database_duration_ms: durationFor("database"),
      duration_ms: roundedDuration(this.startedAt),
      endpoint: this.endpoint,
      media_duration_ms: durationFor("media"),
      method: this.method,
      payload_bytes: input.payloadBytes,
      serialization_duration_ms: input.serializationDurationMs,
      status: input.status,
      storage_duration_ms: durationFor("storage"),
      storage_call_count: storageSteps.length,
    });
  }
}

export function beginRequestPerformanceTrace(req: NextRequest, endpoint = mobileEndpointLabel(req.nextUrl.pathname)) {
  const existing = requestTraces.get(req);
  if (existing) return existing;
  const trace = new RequestPerformanceTrace(req, endpoint);
  requestTraces.set(req, trace);
  return trace;
}

export function requestPerformanceTrace(req: NextRequest) {
  return requestTraces.get(req) ?? null;
}

export function tracedJson(
  trace: RequestPerformanceTrace,
  body: unknown,
  init: ResponseInit = {}
) {
  if (!trace.enabled) return NextResponse.json(body, init);
  const startedAt = performance.now();
  const response = NextResponse.json(body, init);
  trace.finish({
    payloadBytes: payloadBytes(body),
    serializationDurationMs: roundedDuration(startedAt),
    status: init.status ?? 200,
  });
  return response;
}
