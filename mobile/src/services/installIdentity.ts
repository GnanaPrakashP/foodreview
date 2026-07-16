import * as SecureStore from "expo-secure-store";
import { getRandomValues } from "expo-crypto";

const INSTALL_ID_KEY = "circlebites.security.install-id.v1";
const AUTH_FLOW_PREFIX = "circlebites.security.auth-flow.v1.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE_RE = /^[a-f0-9]{64}$/;
const FLOW_TTL_MS = 30 * 60_000;

export type AuthFlowKind = "oauth";

function secureRandomBytes(length: number) {
  const bytes = new Uint8Array(length);
  try {
    return getRandomValues(bytes);
  } catch {
    throw new Error("secure_random_unavailable");
  }
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createUuid() {
  const bytes = secureRandomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = hex(bytes);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function getInstallId() {
  const existing = await SecureStore.getItemAsync(INSTALL_ID_KEY);
  if (existing && UUID_RE.test(existing)) return existing.toLowerCase();
  const installId = createUuid();
  await SecureStore.setItemAsync(INSTALL_ID_KEY, installId);
  return installId;
}

export function createRequestId() {
  return hex(secureRandomBytes(32));
}

export async function beginAuthFlow(kind: AuthFlowKind) {
  const nonce = createRequestId();
  await SecureStore.setItemAsync(
    `${AUTH_FLOW_PREFIX}${kind}`,
    JSON.stringify({ expiresAt: Date.now() + FLOW_TTL_MS, nonce })
  );
  return nonce;
}

export async function consumeAuthFlow(kind: AuthFlowKind, nonce: string) {
  const key = `${AUTH_FLOW_PREFIX}${kind}`;
  const stored = await SecureStore.getItemAsync(key);
  await SecureStore.deleteItemAsync(key);
  if (!NONCE_RE.test(nonce) || !stored) return false;
  try {
    const parsed = JSON.parse(stored) as { expiresAt?: unknown; nonce?: unknown };
    return typeof parsed.expiresAt === "number"
      && parsed.expiresAt >= Date.now()
      && parsed.nonce === nonce;
  } catch {
    return false;
  }
}

export async function clearAuthFlow(kind: AuthFlowKind) {
  await SecureStore.deleteItemAsync(`${AUTH_FLOW_PREFIX}${kind}`);
}

export async function clearInstallScopedSecureState() {
  await Promise.all([
    SecureStore.deleteItemAsync(INSTALL_ID_KEY),
    SecureStore.deleteItemAsync(`${AUTH_FLOW_PREFIX}oauth`),
    // Legacy OTP/password releases used these keys. Continue deleting them at
    // the installation boundary without exposing a recovery flow.
    SecureStore.deleteItemAsync(`${AUTH_FLOW_PREFIX}recovery`),
    SecureStore.deleteItemAsync(`${AUTH_FLOW_PREFIX}signup`),
    SecureStore.deleteItemAsync("circlebites.security.recovery-session.v1")
  ]);
}
