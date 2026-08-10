import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushLogger } from "@/lib/observability/server";
import { safeCorrelationId } from "@/lib/observability/structured-log.mjs";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const PUSH_BATCH_SIZE = 100;
const RECEIPT_BATCH_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RECEIPT_DELAY_SECONDS = 15 * 60;
const RETIRED_PUSH_NOTIFICATION_TYPES = new Set(["THREAD_REPLY", "also_commented"]);

type AdminClient = ReturnType<typeof createAdminClient>;
type FetchImplementation = typeof fetch;

type PushJob = {
  attempts: number;
  claim_token: string;
  correlation_id: string | null;
  id: string;
  max_attempts: number;
  notification_id: string | null;
  notification_type: string;
  provider_ticket_id: string | null;
  push_token_id: string;
  receipt_attempts: number;
  user_id: string;
};

type PushToken = {
  disabled_at: string | null;
  expo_push_token: string;
  id: string;
  user_id: string;
};

type NotificationRow = {
  actor_name: string | null;
  entity_id: string | null;
  entity_type: string | null;
  id: string;
  message: string | null;
  post_id: string | null;
  recipient_name: string;
  recipient_user_id: string | null;
  title: string | null;
  type: string;
};

function dedupeKey(notificationId: string, pushTokenId: string) {
  return createHash("sha256").update(`${notificationId}\0${pushTokenId}`).digest("hex");
}

function safeWorkerId(value: string | undefined) {
  const candidate = value?.trim() || `push-worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(candidate)) throw new Error("push_worker_id_invalid");
  return candidate;
}

function safeProviderError(value: unknown) {
  const normalized = typeof value === "string" ? value : "";
  if (normalized === "DeviceNotRegistered") return "device_not_registered";
  if (normalized === "MessageTooBig") return "message_too_big";
  if (normalized === "MessageRateExceeded") return "message_rate_exceeded";
  if (normalized === "InvalidCredentials") return "invalid_provider_credentials";
  return "provider_rejected";
}

function providerErrorRetryable(code: string) {
  return code === "message_rate_exceeded" || code === "provider_timeout" || code === "provider_unavailable" || code === "provider_rate_limited";
}

async function providerRequest(
  fetchImpl: FetchImplementation,
  url: string,
  body: unknown,
  timeoutMs = REQUEST_TIMEOUT_MS
) {
  const startedAt = Date.now();
  const providerOperation = url === EXPO_RECEIPTS_URL ? "receipts" : "send";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      body: JSON.stringify(body),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const error = new Error(response.status === 429 ? "provider_rate_limited" : response.status >= 500 ? "provider_unavailable" : "provider_rejected");
      (error as Error & { retryAfter?: string | null }).retryAfter = response.headers.get("retry-after");
      throw error;
    }
    pushLogger.info("push_provider_request_completed", { duration_ms: Date.now() - startedAt, provider_operation: providerOperation });
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      pushLogger.warn("push_provider_request_failed", { duration_ms: Date.now() - startedAt, error_code: "provider_timeout", provider_operation: providerOperation });
      throw new Error("provider_timeout");
    }
    pushLogger.warn("push_provider_request_failed", { duration_ms: Date.now() - startedAt, error_code: "provider_failure", provider_operation: providerOperation });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function enqueuePushDeliveries(input: {
  correlationId?: string | null;
  notificationId: string;
  notificationType: string;
  recipientName: string;
  recipientUserId?: string | null;
}, admin: AdminClient = createAdminClient()) {
  let userId = input.recipientUserId ?? null;
  if (!userId) {
    const { data: profile, error } = await admin.from("profiles").select("id").eq("username", input.recipientName).maybeSingle<{ id: string }>();
    if (error) throw new Error("push_recipient_lookup_failed");
    userId = profile?.id ?? null;
  }
  if (!userId) return { enqueued: 0 };

  const { data: tokens, error: tokenError } = await admin
    .from("push_tokens")
    .select("id, user_id")
    .eq("user_id", userId)
    .is("disabled_at", null)
    .limit(100);
  if (tokenError) throw new Error("push_token_lookup_failed");

  const rows = (tokens ?? []).map((token: { id: string; user_id: string }) => ({
    correlation_id: safeCorrelationId(input.correlationId) ?? randomUUID(),
    dedupe_key: dedupeKey(input.notificationId, token.id),
    notification_id: input.notificationId,
    notification_type: input.notificationType,
    push_token_id: token.id,
    status: "queued",
    user_id: token.user_id
  }));
  if (rows.length === 0) return { enqueued: 0 };
  const { error } = await admin.from("push_delivery_jobs").upsert(rows, {
    ignoreDuplicates: true,
    onConflict: "dedupe_key"
  });
  if (error) throw new Error("push_job_enqueue_failed");
  pushLogger.info("push_jobs_enqueued", { count: rows.length, notification_type: input.notificationType });
  return { enqueued: rows.length };
}

async function failSend(admin: AdminClient, job: PushJob, code: string, retryable = providerErrorRetryable(code)) {
  const { data, error } = await admin.rpc("fail_push_delivery_send", {
    p_claim_token: job.claim_token,
    p_error_code: code,
    p_job_id: job.id,
    p_retryable: retryable
  });
  if (error) throw new Error("push_send_failure_persist_failed");
  return String(data ?? "");
}

async function disableToken(admin: AdminClient, tokenId: string, reason: string) {
  await admin.from("push_tokens").update({
    disabled_at: new Date().toISOString(),
    disabled_reason: reason,
    updated_at: new Date().toISOString()
  }).eq("id", tokenId);
}

function notificationPayload(notification: NotificationRow, token: string) {
  const data: Record<string, string> = {
    entityType: notification.entity_type || "SYSTEM",
    notificationId: notification.id,
    notificationType: notification.type,
    recipientName: notification.recipient_name,
    recipientUserId: notification.recipient_user_id || "",
    type: notification.entity_type === "TABLE_MEMORY" ? "table-memory" : "social-notification"
  };
  if (notification.entity_id) data.entityId = notification.entity_id;
  if (notification.post_id) data.postId = notification.post_id;
  return {
    body: notification.message || "You have a new Witoh notification",
    data,
    sound: "default",
    title: notification.title || "Witoh",
    to: token
  };
}

export async function processPushSendBatch(options: {
  admin?: AdminClient;
  fetchImpl?: FetchImplementation;
  limit?: number;
  receiptDelaySeconds?: number;
  workerId?: string;
} = {}) {
  const admin = options.admin ?? createAdminClient();
  const fetchImpl = options.fetchImpl ?? fetch;
  const workerId = safeWorkerId(options.workerId);
  const { data, error } = await admin.rpc("claim_push_delivery_jobs", {
    p_lease_seconds: 120,
    p_limit: Math.min(Math.max(options.limit ?? PUSH_BATCH_SIZE, 1), PUSH_BATCH_SIZE),
    p_worker_id: workerId
  });
  if (error) throw new Error("push_send_claim_failed");
  const jobs = (Array.isArray(data) ? data : []) as PushJob[];
  if (jobs.length === 0) return { claimed: 0, deadLettered: 0, permanentFailed: 0, receiptPending: 0, retried: 0 };

  const prepared: Array<{ job: PushJob; message: ReturnType<typeof notificationPayload> }> = [];
  let permanentFailed = 0;
  let retried = 0;
  let deadLettered = 0;
  for (const job of jobs) {
    if (RETIRED_PUSH_NOTIFICATION_TYPES.has(job.notification_type)) {
      await failSend(admin, job, "notification_type_retired", false);
      permanentFailed += 1;
      continue;
    }
    const [{ data: token }, { data: notification }] = await Promise.all([
      admin.from("push_tokens").select("id, user_id, expo_push_token, disabled_at").eq("id", job.push_token_id).maybeSingle<PushToken>(),
      job.notification_id
        ? admin.from("notifications").select("id, recipient_user_id, recipient_name, actor_name, type, title, message, entity_type, entity_id, post_id").eq("id", job.notification_id).maybeSingle<NotificationRow>()
        : Promise.resolve({ data: null })
    ]);
    if (!token || token.user_id !== job.user_id || token.disabled_at || !notification || RETIRED_PUSH_NOTIFICATION_TYPES.has(notification.type)) {
      await failSend(admin, job, token?.disabled_at ? "token_disabled" : "delivery_target_missing", false);
      permanentFailed += 1;
      continue;
    }
    prepared.push({ job, message: notificationPayload(notification, token.expo_push_token) });
  }

  if (prepared.length === 0) return { claimed: jobs.length, deadLettered, permanentFailed, receiptPending: 0, retried };

  let payload: any;
  try {
    payload = await providerRequest(fetchImpl, EXPO_PUSH_URL, prepared.map((entry) => entry.message));
  } catch (providerError) {
    const code = providerError instanceof Error && /^[a-z0-9_]{1,80}$/.test(providerError.message)
      ? providerError.message
      : "provider_unavailable";
    for (const { job } of prepared) {
      const status = await failSend(admin, job, code, providerErrorRetryable(code));
      if (status === "retry_wait") retried += 1;
      else if (status === "dead_letter") deadLettered += 1;
      else permanentFailed += 1;
    }
    pushLogger.error("push_send_batch_failed", providerError, { claimed: jobs.length, error_code: code });
    return { claimed: jobs.length, deadLettered, permanentFailed, receiptPending: 0, retried };
  }

  const tickets = Array.isArray(payload?.data) ? payload.data : [];
  let receiptPending = 0;
  const seenTicketIds = new Set<string>();
  for (let index = 0; index < prepared.length; index += 1) {
    const { job } = prepared[index];
    const ticket = tickets[index];
    if (ticket?.status === "ok" && typeof ticket.id === "string" && !seenTicketIds.has(ticket.id)) {
      seenTicketIds.add(ticket.id);
      const { data: completed, error: completeError } = await admin.rpc("complete_push_delivery_ticket", {
        p_claim_token: job.claim_token,
        p_job_id: job.id,
        p_provider_ticket_id: ticket.id,
        p_receipt_delay_seconds: options.receiptDelaySeconds ?? DEFAULT_RECEIPT_DELAY_SECONDS
      });
      if (completeError || completed !== true) {
        const status = await failSend(admin, job, completeError ? "duplicate_ticket" : "push_lease_lost", false).catch(() => "permanent_failure");
        if (status === "dead_letter") deadLettered += 1; else permanentFailed += 1;
      } else {
        receiptPending += 1;
      }
      continue;
    }
    const code = ticket?.status === "ok" ? "duplicate_ticket" : safeProviderError(ticket?.details?.error);
    if (code === "device_not_registered") await disableToken(admin, job.push_token_id, code);
    const status = await failSend(admin, job, code, providerErrorRetryable(code));
    if (status === "retry_wait") retried += 1;
    else if (status === "dead_letter") deadLettered += 1;
    else permanentFailed += 1;
  }
  pushLogger.info("push_send_batch_completed", { claimed: jobs.length, dead_lettered: deadLettered, permanent_failed: permanentFailed, receipt_pending: receiptPending, retried });
  return { claimed: jobs.length, deadLettered, permanentFailed, receiptPending, retried };
}

export async function processPushReceiptBatch(options: {
  admin?: AdminClient;
  fetchImpl?: FetchImplementation;
  limit?: number;
  workerId?: string;
} = {}) {
  const admin = options.admin ?? createAdminClient();
  const fetchImpl = options.fetchImpl ?? fetch;
  const workerId = safeWorkerId(options.workerId);
  const { data, error } = await admin.rpc("claim_push_receipt_jobs", {
    p_lease_seconds: 120,
    p_limit: Math.min(Math.max(options.limit ?? RECEIPT_BATCH_SIZE, 1), RECEIPT_BATCH_SIZE),
    p_worker_id: workerId
  });
  if (error) throw new Error("push_receipt_claim_failed");
  const jobs = (Array.isArray(data) ? data : []) as PushJob[];
  if (jobs.length === 0) return { claimed: 0, deadLettered: 0, delivered: 0, permanentFailed: 0, retried: 0 };

  let receipts: Record<string, any> = {};
  try {
    const payload = await providerRequest(fetchImpl, EXPO_RECEIPTS_URL, { ids: jobs.map((job) => job.provider_ticket_id) });
    receipts = payload?.data && typeof payload.data === "object" ? payload.data : {};
  } catch (providerError) {
    receipts = {};
    pushLogger.error("push_receipt_batch_failed", providerError, { claimed: jobs.length });
  }

  let delivered = 0;
  let retried = 0;
  let permanentFailed = 0;
  let deadLettered = 0;
  for (const job of jobs) {
    const receipt = job.provider_ticket_id ? receipts[job.provider_ticket_id] : null;
    let outcome = "temporary_failure";
    let code: string | null = receipt ? null : "receipt_unavailable";
    if (receipt?.status === "ok") outcome = "delivered";
    else if (receipt?.status === "error") {
      code = safeProviderError(receipt?.details?.error);
      outcome = code === "device_not_registered" ? "device_not_registered" : providerErrorRetryable(code) ? "temporary_failure" : "permanent_failure";
    }
    const { data: status, error: completeError } = await admin.rpc("complete_push_delivery_receipt", {
      p_claim_token: job.claim_token,
      p_error_code: code,
      p_job_id: job.id,
      p_outcome: outcome
    });
    if (completeError) throw new Error("push_receipt_persist_failed");
    if (status === "delivered") delivered += 1;
    else if (status === "receipt_pending") retried += 1;
    else if (status === "dead_letter") deadLettered += 1;
    else permanentFailed += 1;
  }
  pushLogger.info("push_receipt_batch_completed", { claimed: jobs.length, dead_lettered: deadLettered, delivered, permanent_failed: permanentFailed, retried });
  return { claimed: jobs.length, deadLettered, delivered, permanentFailed, retried };
}
