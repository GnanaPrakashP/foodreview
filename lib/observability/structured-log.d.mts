export type OperationalFields = Record<string, unknown>;
export function runtimeEnvironment(env?: Record<string, string | undefined>): string;
export function runtimeRelease(env?: Record<string, string | undefined>): string;
export function safeErrorCode(error: unknown): string;
export function sanitizeTelemetryValue(value: unknown, key?: string, depth?: number): any;
export function sanitizeTelemetryEvent(event: unknown): any;
export function safeCorrelationId(value: unknown): string | null;
export function createOperationalLogger(options: {
  service: string;
  captureException?: (error: Error, fields: unknown) => void;
}): {
  debug(event: string, fields?: OperationalFields): unknown;
  info(event: string, fields?: OperationalFields): unknown;
  warn(event: string, fields?: OperationalFields): unknown;
  error(event: string, error: unknown, fields?: OperationalFields): unknown;
  metadata: { deployed: boolean; environment: string; release: string; service: string };
};
