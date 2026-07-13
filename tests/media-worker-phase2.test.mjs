import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import sharp from "sharp";
import ts from "typescript";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function loadTs(relativePath, requireModule, globals = {}) {
  const { outputText } = ts.transpileModule(source(relativePath), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    AbortController,
    Blob,
    Buffer,
    clearInterval,
    clearTimeout,
    console,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Promise,
    Set,
    setInterval,
    setTimeout,
    module: mod,
    exports: mod.exports,
    process: { env: {}, pid: 1234 },
    require: requireModule,
    ...globals
  });
  return mod.exports;
}

function loadPipeline() {
  return loadTs("lib/server/media-pipeline.ts", (id) => {
    if (id === "node:crypto") return crypto;
    if (id === "node:fs/promises") return fsPromises;
    if (id === "node:os") return os;
    if (id === "node:path") return path;
    if (id === "node:child_process") return childProcess;
    if (id === "sharp") return sharp;
    throw new Error(`Unexpected import: ${id}`);
  });
}

test("Phase 2 canonical migration defines fenced atomic leases and terminal states", () => {
  const root = source("supabase/migrations/202607130003_media_worker_reliability.sql");
  assert.match(root, /create or replace function public\.claim_media_processing_jobs/);
  assert.match(root, /for update of job skip locked/);
  assert.match(root, /lock_expires_at <= now\(\)/);
  assert.match(root, /lease_generation = job\.lease_generation \+ 1/);
  assert.match(root, /claim_token = gen_random_uuid\(\)/);
  assert.match(root, /complete_media_processing_job[\s\S]*v_job\.claim_token <> p_claim_token/);
  assert.match(root, /heartbeat_media_processing_job/);
  assert.match(root, /retry_wait[\s\S]*dead_letter[\s\S]*cancelled/);
  assert.match(root, /digest\([\s\S]*power\(2,/);
  assert.match(root, /ensure_media_processing_job_after_upload_trigger/);
  assert.match(root, /cancel_media_jobs_for_frozen_account_trigger/);
  assert.match(root, /claim_media_cleanup_assets/);
  assert.match(root, /revoke all on function public\.claim_media_processing_jobs[\s\S]*grant execute[\s\S]*service_role/);
});

test("failure classification separates retryable infrastructure from permanent media rejection", () => {
  const pipeline = loadPipeline();
  assert.deepEqual(
    { ...pipeline.classifyMediaProcessingFailure(new Error("media_signature_not_allowed")) },
    { code: "invalid_file_signature", failureClass: "permanent" }
  );
  assert.deepEqual(
    { ...pipeline.classifyMediaProcessingFailure(new Error("media_video_too_long")) },
    { code: "duration_exceeded", failureClass: "permanent" }
  );
  assert.deepEqual(
    { ...pipeline.classifyMediaProcessingFailure(new Error("derivative_upload_timeout")) },
    { code: "derivative_upload_timeout", failureClass: "retryable" }
  );
  assert.deepEqual(
    { ...pipeline.classifyMediaProcessingFailure(new Error("database password=private")) },
    { code: "media_processing_failed", failureClass: "retryable" }
  );
  assert.throws(
    () => pipeline.mediaWorkerConfig({ MEDIA_WORKER_CONCURRENCY: "0" }),
    /media_worker_concurrency_invalid/
  );
});

function chainResult(result) {
  const chain = {
    eq() { return chain; },
    in() { return chain; },
    maybeSingle: async () => result,
    select() { return chain; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    update() { return chain; }
  };
  return chain;
}

async function imageWorkerAdmin({ attempts = 1, completeLease = true, failAt = null, failureCode = "storage_temporarily_unavailable", claimOnce = true, maxAttempts = 5 } = {}) {
  const pipeline = loadPipeline();
  const image = await sharp({
    create: { background: { r: 20, g: 80, b: 160 }, channels: 3, height: 600, width: 800 }
  }).jpeg().toBuffer();
  const calls = {
    claims: 0,
    completion: 0,
    failures: [],
    uploads: [],
    upserts: new Map()
  };
  const asset = {
    access_class: "public_post",
    consumed_at: null,
    crop_rect: { height: 1, targetAspect: 0.8, width: 1, x: 0, y: 0 },
    duration_ms: null,
    id: "22222222-2222-4222-8222-222222222222",
    media_type: "image",
    original_extension: "jpg",
    original_file_size_bytes: image.byteLength,
    original_height: 600,
    original_mime_type: "image/jpeg",
    original_width: 800,
    owner_id: "11111111-1111-4111-8111-111111111111",
    owner_name: "alice",
    source_bucket_id: pipeline.MEDIA_SOURCE_BUCKET,
    source_storage_path: "sources/post/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/original.jpg",
    status: "uploaded",
    surface: "post",
    visibility: "private"
  };
  const job = {
    asset_id: asset.id,
    attempts,
    claim_token: "33333333-3333-4333-8333-333333333333",
    id: "44444444-4444-4444-8444-444444444444",
    job_type: "image_derivatives",
    lease_generation: 1,
    lock_expires_at: new Date(Date.now() + 180_000).toISOString(),
    max_attempts: maxAttempts,
    stale_reclaimed: false
  };
  const admin = {
    async rpc(name, args) {
      if (name === "claim_media_processing_jobs") {
        calls.claims += 1;
        return { data: !claimOnce || calls.claims === 1 ? [job] : [], error: null };
      }
      if (name === "media_processing_lease_is_current" || name === "heartbeat_media_processing_job") {
        return { data: true, error: null };
      }
      if (name === "complete_media_processing_job") {
        calls.completion += 1;
        return { data: completeLease, error: null };
      }
      if (name === "fail_media_processing_job") {
        calls.failures.push(args);
        return {
          data: args.p_failure_class === "permanent" ? "rejected" : attempts >= maxAttempts ? "dead_letter" : "retry_wait",
          error: null
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      if (table === "media_assets") {
        return {
          select() { return chainResult({ data: asset, error: null }); },
          update() { return chainResult({ data: null, error: null }); }
        };
      }
      if (table === "media_derivatives") {
        return {
          async upsert(row) {
            calls.upserts.set(`${row.asset_id}:${row.kind}`, row);
            return { error: null };
          }
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    storage: {
      from(bucket) {
        return {
          async download() {
            assert.equal(bucket, pipeline.MEDIA_SOURCE_BUCKET);
            return { data: new Blob([image]), error: null };
          },
          getPublicUrl() {
            return { data: { publicUrl: null } };
          },
          async upload(storagePath) {
            calls.uploads.push(storagePath);
            return { data: null, error: null };
          }
        };
      }
    }
  };
  const config = {
    concurrency: 1,
    downloadTimeoutMs: 5000,
    ffmpegTimeoutMs: 10_000,
    ffprobeTimeoutMs: 5000,
    heartbeatIntervalMs: 5000,
    leaseSeconds: 180,
    maxAttempts: 5,
    maxTempBytes: 512 * 1024 * 1024,
    retryBaseSeconds: 1,
    retryMaxSeconds: 30,
    tempRoot: path.join(os.tmpdir(), "media-worker-test"),
    uploadTimeoutMs: 5000
  };
  return { admin, calls, config, job, pipeline, failureInjector: failAt ? (stage) => {
    if (stage === failAt) throw new Error(failureCode);
  } : undefined };
}

test("partial derivative failure retries safely and a repeat execution converges to one derivative set", async () => {
  const first = await imageWorkerAdmin({ failAt: "after_first_derivative_upload" });
  const failed = await first.pipeline.runMediaProcessingBatch(first.admin, {
    config: first.config,
    failureInjector: first.failureInjector,
    limit: 1,
    workerId: "worker-a"
  });
  assert.equal(failed.retried, 1);
  assert.equal(first.calls.completion, 0);
  assert.equal(first.calls.failures[0].p_failure_code, "storage_temporarily_unavailable");

  const second = await imageWorkerAdmin();
  const completed = await second.pipeline.runMediaProcessingBatch(second.admin, {
    config: second.config,
    limit: 1,
    workerId: "worker-b"
  });
  assert.equal(completed.succeeded, 1);
  assert.equal(second.calls.completion, 1);
  assert.equal(second.calls.upserts.size, 2);
  assert.deepEqual(Array.from(second.calls.upserts.values()).map((row) => row.kind).sort(), ["canonical", "thumbnail"]);
});

test("two worker batches racing receive only one claimed execution", async () => {
  const fixture = await imageWorkerAdmin();
  const [a, b] = await Promise.all([
    fixture.pipeline.runMediaProcessingBatch(fixture.admin, { config: fixture.config, limit: 1, workerId: "worker-a" }),
    fixture.pipeline.runMediaProcessingBatch(fixture.admin, { config: fixture.config, limit: 1, workerId: "worker-b" })
  ]);
  assert.equal(a.processed + b.processed, 1);
  assert.equal(a.succeeded + b.succeeded, 1);
});

test("a stale completion token cannot make an asset authoritative", async () => {
  const fixture = await imageWorkerAdmin({ completeLease: false });
  const result = await fixture.pipeline.runMediaProcessingBatch(fixture.admin, {
    config: fixture.config,
    limit: 1,
    workerId: "stale-worker"
  });
  assert.equal(result.leaseLost, 1);
  assert.equal(result.succeeded, 0);
  assert.equal(fixture.calls.completion, 1);
});

test("all image crash checkpoints recover, including crash after authoritative completion", async () => {
  const stages = [
    "after_claim",
    "before_source_download",
    "after_source_validation",
    "after_canonical_creation",
    "after_thumbnail_creation",
    "after_first_derivative_upload",
    "after_all_derivative_uploads",
    "after_derivative_metadata",
    "before_metadata_finalization",
    "after_metadata_finalization"
  ];
  for (const stage of stages) {
    const fixture = await imageWorkerAdmin({ failAt: stage });
    const result = await fixture.pipeline.runMediaProcessingBatch(fixture.admin, {
      config: fixture.config,
      failureInjector: fixture.failureInjector,
      limit: 1,
      workerId: `crash-${stage}`
    });
    if (stage === "after_metadata_finalization") {
      assert.equal(result.succeeded, 1, stage);
      assert.equal(fixture.calls.failures.length, 0, stage);
    } else {
      assert.equal(result.retried, 1, stage);
    }
  }
});

async function videoWorkerAdmin({ failAt = null } = {}) {
  const pipeline = loadPipeline();
  const fixtureDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "phase2-video-fixture-"));
  const fixturePath = path.join(fixtureDir, "source.mp4");
  const generated = childProcess.spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=blue:s=320x400:d=1",
    "-pix_fmt", "yuv420p", "-c:v", "libx264", fixturePath
  ], { encoding: "utf8", timeout: 20_000 });
  assert.equal(generated.status, 0, generated.stderr || "video fixture generation failed");
  const video = await fsPromises.readFile(fixturePath);
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "phase2-video-worker-"));
  const calls = { completion: 0, failures: [], uploads: [], upserts: new Map() };
  const asset = {
    access_class: "private_post",
    consumed_at: null,
    crop_rect: { height: 1, targetAspect: 0.8, width: 1, x: 0, y: 0 },
    duration_ms: 1000,
    id: "66666666-6666-4666-8666-666666666666",
    media_type: "video",
    original_extension: "mp4",
    original_file_size_bytes: video.byteLength,
    original_height: 400,
    original_mime_type: "video/mp4",
    original_width: 320,
    owner_id: "11111111-1111-4111-8111-111111111111",
    owner_name: "alice",
    source_bucket_id: pipeline.MEDIA_SOURCE_BUCKET,
    source_storage_path: "sources/post/11111111-1111-4111-8111-111111111111/66666666-6666-4666-8666-666666666666/original.mp4",
    status: "uploaded",
    surface: "post",
    visibility: "private"
  };
  const job = {
    asset_id: asset.id,
    attempts: 1,
    claim_token: "77777777-7777-4777-8777-777777777777",
    id: "88888888-8888-4888-8888-888888888888",
    job_type: "video_derivatives",
    lease_generation: 1,
    lock_expires_at: new Date(Date.now() + 180_000).toISOString(),
    max_attempts: 5,
    stale_reclaimed: false
  };
  const admin = {
    async rpc(name, args) {
      if (name === "claim_media_processing_jobs") return { data: [job], error: null };
      if (name === "media_processing_lease_is_current" || name === "heartbeat_media_processing_job") {
        return { data: true, error: null };
      }
      if (name === "complete_media_processing_job") {
        calls.completion += 1;
        return { data: true, error: null };
      }
      if (name === "fail_media_processing_job") {
        calls.failures.push(args);
        return { data: "retry_wait", error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      if (table === "media_assets") {
        return {
          select() { return chainResult({ data: asset, error: null }); },
          update() { return chainResult({ data: null, error: null }); }
        };
      }
      if (table === "media_derivatives") {
        return {
          async upsert(row) {
            calls.upserts.set(`${row.asset_id}:${row.kind}`, row);
            return { error: null };
          }
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    storage: {
      from(bucket) {
        return {
          async download() {
            assert.equal(bucket, pipeline.MEDIA_SOURCE_BUCKET);
            return { data: new Blob([video]), error: null };
          },
          getPublicUrl() { return { data: { publicUrl: null } }; },
          async upload(storagePath) {
            calls.uploads.push(storagePath);
            return { data: null, error: null };
          }
        };
      }
    }
  };
  const config = {
    concurrency: 1,
    downloadTimeoutMs: 5000,
    ffmpegTimeoutMs: 20_000,
    ffprobeTimeoutMs: 5000,
    heartbeatIntervalMs: 5000,
    leaseSeconds: 180,
    maxAttempts: 5,
    maxTempBytes: 512 * 1024 * 1024,
    retryBaseSeconds: 1,
    retryMaxSeconds: 30,
    tempRoot,
    uploadTimeoutMs: 5000
  };
  return {
    admin,
    calls,
    config,
    pipeline,
    tempRoot,
    async cleanup() {
      await fsPromises.rm(fixtureDir, { force: true, recursive: true });
      await fsPromises.rm(tempRoot, { force: true, recursive: true });
    },
    failureInjector: failAt ? (stage) => {
      if (stage === failAt) throw new Error("worker_shutdown");
    } : undefined
  };
}

test("real ffmpeg video processing creates canonical and poster output and cleans crash temp files", async () => {
  const crashed = await videoWorkerAdmin({ failAt: "after_poster_creation" });
  try {
    const failed = await crashed.pipeline.runMediaProcessingBatch(crashed.admin, {
      config: crashed.config,
      failureInjector: crashed.failureInjector,
      workerId: "video-worker-crashed"
    });
    assert.equal(failed.retried, 1);
    assert.deepEqual(await fsPromises.readdir(crashed.tempRoot), []);
  } finally {
    await crashed.cleanup();
  }

  const recovered = await videoWorkerAdmin();
  try {
    const completed = await recovered.pipeline.runMediaProcessingBatch(recovered.admin, {
      config: recovered.config,
      workerId: "video-worker-recovered"
    });
    assert.equal(completed.succeeded, 1);
    assert.equal(recovered.calls.completion, 1);
    assert.deepEqual(Array.from(recovered.calls.upserts.values()).map((row) => row.kind).sort(), ["canonical", "poster"]);
    assert.equal(recovered.calls.uploads.some((storagePath) => storagePath.endsWith("canonical.mp4")), true);
    assert.equal(recovered.calls.uploads.some((storagePath) => storagePath.endsWith("poster.jpg")), true);
    assert.deepEqual(await fsPromises.readdir(recovered.tempRoot), []);
  } finally {
    await recovered.cleanup();
  }
});

test("permanent validation rejects immediately and retry exhaustion dead-letters", async () => {
  const permanent = await imageWorkerAdmin({ failAt: "after_claim", failureCode: "media_signature_not_allowed" });
  const rejected = await permanent.pipeline.runMediaProcessingBatch(permanent.admin, {
    config: permanent.config,
    failureInjector: permanent.failureInjector,
    workerId: "worker-permanent"
  });
  assert.equal(rejected.rejected, 1);
  assert.equal(permanent.calls.failures[0].p_failure_class, "permanent");

  const exhausted = await imageWorkerAdmin({ attempts: 5, failAt: "after_claim", maxAttempts: 5 });
  const dead = await exhausted.pipeline.runMediaProcessingBatch(exhausted.admin, {
    config: exhausted.config,
    failureInjector: exhausted.failureInjector,
    workerId: "worker-exhausted"
  });
  assert.equal(dead.deadLettered, 1);
});

test("owner-scoped mobile recovery survives same-owner restart and isolates account switch", () => {
  const ownership = loadTs("mobile/src/security/cacheOwnership.ts", () => {
    throw new Error("Unexpected ownership import");
  });
  const stores = new Map();
  const mmkv = (id) => {
    const values = stores.get(id) ?? new Map();
    stores.set(id, values);
    return {
      clearAll: () => values.clear(),
      getString: (key) => values.get(key),
      set: (key, value) => values.set(key, value)
    };
  };
  const recovery = loadTs("mobile/src/services/mediaUploadRecovery.ts", (id) => {
    if (id === "@/security/cacheOwnership") return ownership;
    if (id === "@/security/localMMKV") return { createLocalMMKV: mmkv };
    if (id === "@/services/accountFileStore") return {
      discardOwnedAccountFile: async () => {},
      isOwnedAccountFileUri: (uri, scope) => uri.startsWith(`file:///private/${scope}/`)
    };
    throw new Error(`Unexpected import: ${id}`);
  });

  const alice = ownership.cacheOwnerForUserId("11111111-1111-4111-8111-111111111111");
  const bob = ownership.cacheOwnerForUserId("22222222-2222-4222-8222-222222222222");
  ownership.setActiveCacheOwner(alice);
  const aliceRecord = recovery.createPendingMediaUpload({
    accessClass: "private_post",
    assetId: null,
    cropRect: { height: 1, targetAspect: 0.8, width: 1, x: 0, y: 0 },
    durationMs: null,
    expiresAt: null,
    fileSizeBytes: 100,
    height: 100,
    mediaKind: "image",
    mimeType: "image/jpeg",
    preparedUri: `file:///private/${alice.scope}/prepared.jpg`,
    sourceUri: `file:///private/${alice.scope}/source.jpg`,
    uploadBucket: null,
    uploadPath: null,
    width: 100
  });
  assert.equal(recovery.pendingMediaUploads().length, 1);
  ownership.setActiveCacheOwner(bob);
  assert.equal(recovery.pendingMediaUploads().length, 0);
  ownership.setActiveCacheOwner(alice);
  assert.equal(recovery.pendingMediaUploads()[0].localUploadId, aliceRecord.localUploadId);
  recovery.clearMediaUploadRecoveryForScope(alice.scope);
  assert.equal(recovery.pendingMediaUploads().length, 0);
});

test("mobile foreground recovery resumes prepared and uploaded phases and preserves terminal safety", async () => {
  const assetId = "33333333-3333-4333-8333-333333333333";
  const owner = { scope: "user-11111111-1111-4111-8111-111111111111", userId: "11111111-1111-4111-8111-111111111111" };

  async function scenario(initialState, serverStatus = "ready") {
    const calls = { finalize: 0, intent: 0, removed: 0, status: 0, upload: 0 };
    let record = {
      accessClass: "private_post",
      assetId: initialState === "prepared" ? null : assetId,
      createdAt: Date.now(),
      cropRect: { height: 1, targetAspect: 0.8, width: 1, x: 0, y: 0 },
      durationMs: null,
      expiresAt: initialState === "prepared" ? null : new Date(Date.now() + 60_000).toISOString(),
      fileSizeBytes: 4,
      height: 100,
      lastCheckedAt: null,
      localUploadId: "upload-recovery-test",
      mediaKind: "image",
      mimeType: "image/jpeg",
      ownerScope: owner.scope,
      preparedUri: `file:///private/${owner.scope}/prepared.jpg`,
      readyResult: null,
      schemaVersion: 2,
      sourceUri: `file:///private/${owner.scope}/source.jpg`,
      state: initialState,
      uploadBucket: initialState === "prepared" ? null : "media-sources",
      uploadPath: initialState === "prepared" ? null : `sources/post/${owner.userId}/${assetId}/original.jpg`,
      width: 100
    };
    const recovery = {
      createPendingMediaUpload: () => record,
      findPendingMediaUpload: () => null,
      pendingMediaUploads: () => record ? [record] : [],
      prunePendingMediaUploads: async () => record ? [record] : [],
      removePendingMediaUpload: async () => {
        calls.removed += 1;
        record = null;
      },
      updatePendingMediaUpload: (_id, patch) => {
        record = { ...record, ...patch };
        return record;
      }
    };
    const supabase = {
      auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } }, error: null }) },
      storage: {
        from: () => ({
          upload: async (_path, body) => {
            calls.upload += 1;
            assert.equal(body.byteLength, 4);
            return { error: null };
          }
        })
      }
    };
    const statusAsset = {
      assetId,
      derivatives: serverStatus === "ready" ? [{
        file_size_bytes: 250,
        height: 1350,
        kind: "canonical",
        mime_type: "image/jpeg",
        width: 1080
      }] : [],
      failureCode: serverStatus === "rejected" ? "invalid_file_signature" : null,
      failureReason: serverStatus === "rejected" ? "Selected media is invalid or corrupted." : null,
      job: { attempts: 1, maxAttempts: 5, nextAttemptAt: null, status: serverStatus === "rejected" ? "rejected" : "succeeded" },
      mediaType: "image",
      status: serverStatus,
      surface: "post"
    };
    const fetch = async (url) => {
      if (String(url).startsWith("file:///")) {
        return { arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer, ok: true };
      }
      if (String(url).includes("/api/media/upload-intent")) {
        calls.intent += 1;
        return { json: async () => ({
          accessClass: "private_post",
          assetId,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          maxAllowedSize: 1024,
          mediaType: "image",
          mimeType: "image/jpeg",
          surface: "post",
          uploadBucket: "media-sources",
          uploadPath: `sources/post/${owner.userId}/${assetId}/original.jpg`
        }), ok: true };
      }
      if (String(url).includes("/api/media/finalize-upload")) {
        calls.finalize += 1;
        return { json: async () => ({ assetId, status: "uploaded" }), ok: true };
      }
      if (String(url).includes("/api/media/status")) {
        calls.status += 1;
        return { json: async () => ({ assets: [statusAsset] }), ok: true };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const pipeline = loadTs("mobile/src/services/mediaPipeline.ts", (id) => {
      if (id === "expo-image-manipulator") return { ImageManipulator: {}, SaveFormat: { JPEG: "jpeg" } };
      if (id === "@/api/config") return { apiBaseUrl: "http://local.test", apiUrl: (value) => value };
      if (id === "@/api/supabase") return { resolvedSupabaseAnonKey: "anon", resolvedSupabaseUrl: "http://supabase.test", supabase };
      if (id === "@/services/accountFileStore") return { stageAccountFile: async (uri) => uri };
      if (id === "@/services/mediaUploadRecovery") return recovery;
      if (id === "@/security/cacheOwnership") return {
        getActiveCacheGeneration: () => 9,
        getActiveCacheOwner: () => owner,
        isCacheGenerationActive: (generation) => generation === 9
      };
      if (id === "@/security/sensitiveResourceRegistry") return { registerSensitiveResourceCleanup: () => {} };
      throw new Error(`Unexpected import: ${id}`);
    }, { fetch });
    const result = await pipeline.reconcilePendingPostMediaUploads();
    return { calls, record, result };
  }

  const prepared = await scenario("prepared");
  assert.deepEqual({ ...prepared.result }, { pending: 0, ready: 1, terminal: 0 });
  assert.deepEqual({ ...prepared.calls }, { finalize: 1, intent: 1, removed: 0, status: 1, upload: 1 });
  assert.equal(prepared.record.state, "ready");

  const alreadyUploaded = await scenario("source_uploaded");
  assert.deepEqual({ ...alreadyUploaded.result }, { pending: 0, ready: 1, terminal: 0 });
  assert.deepEqual({ ...alreadyUploaded.calls }, { finalize: 1, intent: 0, removed: 0, status: 1, upload: 0 });

  const terminal = await scenario("processing", "rejected");
  assert.deepEqual({ ...terminal.result }, { pending: 0, ready: 0, terminal: 1 });
  assert.equal(terminal.calls.removed, 1);
  assert.equal(terminal.record, null);
});

test("worker artifact, internal routes, and reconciliation tooling are production bounded", () => {
  const dockerfile = source("Dockerfile.media-worker");
  const worker = source("scripts/media-worker.mjs");
  const auth = source("lib/server/internal-media-auth.ts");
  const reconcile = source("scripts/media-reconcile.mjs");
  const mobile = source("mobile/src/services/mediaPipeline.ts");
  assert.match(dockerfile, /node:20\.19\.4-bookworm-slim/);
  assert.match(dockerfile, /apt-get install[\s\S]*ffmpeg/);
  assert.match(dockerfile, /USER mediaworker/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.doesNotMatch(dockerfile, /SUPABASE_SERVICE_ROLE_KEY=/);
  assert.match(worker, /SIGTERM/);
  assert.match(worker, /MEDIA_WORKER_BATCH_LIMIT/);
  assert.match(auth, /timingSafeEqual/);
  assert.doesNotMatch(auth, /ACCOUNT_MEDIA_CLEANUP_SECRET|MEMORY_UPLOAD_CLEANUP_SECRET/);
  assert.match(reconcile, /--apply|args\.get\("apply"\)/);
  assert.match(reconcile, /MEDIA_PIPELINE_RECOVERY/);
  assert.match(mobile, /reconcilePendingPostMediaUploads/);
  assert.match(mobile, /isCacheGenerationActive/);
  assert.match(mobile, /still processing/);
});
