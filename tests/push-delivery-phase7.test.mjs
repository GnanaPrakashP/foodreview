import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadPushDelivery() {
  const source = readFileSync(new URL("../lib/server/push-delivery.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    AbortController,
    Date,
    Error,
    Headers,
    JSON,
    Math,
    Promise,
    Set,
    clearTimeout,
    console,
    exports: mod.exports,
    module: mod,
    process: { env: {}, pid: 100 },
    require(id) {
      if (id === "node:crypto") return crypto;
      if (id === "@/lib/supabase/admin") return { createAdminClient() { throw new Error("unexpected_admin_factory"); } };
      if (id === "@/lib/observability/server") return { pushLogger: { error() {}, info() {}, warn() {} } };
      if (id === "@/lib/observability/structured-log.mjs") return { safeCorrelationId: () => null };
      throw new Error(`unexpected import ${id}`);
    },
    setTimeout
  });
  return mod.exports;
}

function job(id, attempts = 1, maxAttempts = 5) {
  return {
    attempts,
    claim_token: `claim-${id}`,
    correlation_id: null,
    id,
    max_attempts: maxAttempts,
    notification_id: `notification-${id}`,
    notification_type: "social",
    provider_ticket_id: null,
    push_token_id: `token-${id}`,
    receipt_attempts: 0,
    user_id: `user-${id}`
  };
}

function adminFor(jobs, failStatus = "retry_wait") {
  const calls = { disabled: [], failures: [], tickets: [] };
  const admin = {
    from(table) {
      if (table === "push_tokens") return {
        select() {
          return { eq(_key, value) {
            const id = String(value).replace("token-", "");
            return { maybeSingle: async () => ({ data: { disabled_at: null, expo_push_token: `ExponentPushToken[${id}]`, id: value, user_id: `user-${id}` }, error: null }) };
          } };
        },
        update(value) {
          return { eq: async (_key, id) => { calls.disabled.push({ id, reason: value.disabled_reason }); return { error: null }; } };
        }
      };
      if (table === "notifications") return {
        select() {
          return { eq(_key, value) {
            const id = String(value).replace("notification-", "");
            return { maybeSingle: async () => ({ data: { actor_name: null, entity_id: null, entity_type: "SYSTEM", id: value, message: "safe fixture", post_id: null, recipient_name: "fixture", recipient_user_id: `user-${id}`, title: "CircleBites", type: "social" }, error: null }) };
          } };
        }
      };
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      if (name === "claim_push_delivery_jobs") return { data: jobs, error: null };
      if (name === "complete_push_delivery_ticket") {
        calls.tickets.push(args.p_provider_ticket_id);
        return { data: true, error: null };
      }
      if (name === "fail_push_delivery_send") {
        calls.failures.push(args.p_error_code);
        return { data: typeof failStatus === "function" ? failStatus(args) : failStatus, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    }
  };
  return { admin, calls };
}

function response(payload, status = 200) {
  return { headers: new Headers(), json: async () => payload, ok: status >= 200 && status < 300, status };
}

test("successful Expo tickets are persisted for later receipt polling", async () => {
  const { processPushSendBatch } = loadPushDelivery();
  const state = adminFor([job("one")]);
  const result = await processPushSendBatch({ admin: state.admin, fetchImpl: async () => response({ data: [{ id: "ticket-one", status: "ok" }] }), workerId: "test" });
  assert.deepEqual({ ...result }, { claimed: 1, deadLettered: 0, permanentFailed: 0, receiptPending: 1, retried: 0 });
  assert.deepEqual(state.calls.tickets, ["ticket-one"]);
});

test("successful Expo receipts durably complete delivery", async () => {
  const { processPushReceiptBatch } = loadPushDelivery();
  const receiptJob = { ...job("receipt"), provider_ticket_id: "ticket-receipt" };
  const calls = [];
  const admin = {
    async rpc(name, args) {
      if (name === "claim_push_receipt_jobs") return { data: [receiptJob], error: null };
      if (name === "complete_push_delivery_receipt") {
        calls.push(args);
        return { data: "delivered", error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    }
  };
  const result = await processPushReceiptBatch({
    admin,
    fetchImpl: async () => response({ data: { "ticket-receipt": { status: "ok" } } }),
    workerId: "test"
  });
  assert.deepEqual({ ...result }, { claimed: 1, deadLettered: 0, delivered: 1, permanentFailed: 0, retried: 0 });
  assert.equal(calls[0].p_outcome, "delivered");
});

test("temporary provider failure is durably retried", async () => {
  const { processPushSendBatch } = loadPushDelivery();
  const state = adminFor([job("temporary")]);
  const result = await processPushSendBatch({ admin: state.admin, fetchImpl: async () => response({}, 503), workerId: "test" });
  assert.equal(result.retried, 1);
  assert.deepEqual(state.calls.failures, ["provider_unavailable"]);
});

test("invalid device tickets disable the token and terminate delivery", async () => {
  const { processPushSendBatch } = loadPushDelivery();
  const state = adminFor([job("invalid")], "permanent_failure");
  const result = await processPushSendBatch({ admin: state.admin, fetchImpl: async () => response({ data: [{ details: { error: "DeviceNotRegistered" }, status: "error" }] }), workerId: "test" });
  assert.equal(result.permanentFailed, 1);
  assert.deepEqual(state.calls.disabled, [{ id: "token-invalid", reason: "device_not_registered" }]);
});

test("duplicate provider ticket IDs cannot create duplicate receipt work", async () => {
  const { processPushSendBatch } = loadPushDelivery();
  const state = adminFor([job("first"), job("second")], "permanent_failure");
  const result = await processPushSendBatch({ admin: state.admin, fetchImpl: async () => response({ data: [{ id: "same-ticket", status: "ok" }, { id: "same-ticket", status: "ok" }] }), workerId: "test" });
  assert.equal(result.receiptPending, 1);
  assert.equal(result.permanentFailed, 1);
  assert.deepEqual(state.calls.failures, ["duplicate_ticket"]);
});

test("provider timeout is classified as bounded retry", async () => {
  const { processPushSendBatch } = loadPushDelivery();
  const state = adminFor([job("timeout")]);
  const fetchImpl = async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; };
  const result = await processPushSendBatch({ admin: state.admin, fetchImpl, workerId: "test" });
  assert.equal(result.retried, 1);
  assert.deepEqual(state.calls.failures, ["provider_timeout"]);
});

test("retry exhaustion is surfaced as a dead letter", async () => {
  const { processPushSendBatch } = loadPushDelivery();
  const state = adminFor([job("exhausted", 5, 5)], "dead_letter");
  const result = await processPushSendBatch({ admin: state.admin, fetchImpl: async () => response({}, 503), workerId: "test" });
  assert.equal(result.deadLettered, 1);
  assert.equal(result.retried, 0);
});
