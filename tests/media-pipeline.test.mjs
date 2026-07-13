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
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

function loadMediaPipelineModule() {
  const { outputText } = ts.transpileModule(source("lib/server/media-pipeline.ts"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    AbortController,
    Buffer,
    Blob,
    clearInterval,
    clearTimeout,
    console,
    setInterval,
    setTimeout,
    process: { env: {}, pid: 1234 },
    module: mod,
    exports: mod.exports,
    require(id) {
      if (id === "node:crypto") return crypto;
      if (id === "node:fs/promises") return fsPromises;
      if (id === "node:os") return os;
      if (id === "node:path") return path;
      if (id === "node:child_process") return childProcess;
      if (id === "sharp") return sharp;
      if (id === "@/lib/observability/server") return {
        mediaWorkerLogger: { error: () => {}, info: () => {}, warn: () => {} }
      };
      throw new Error(`Unexpected require in media pipeline tests: ${id}`);
    }
  });
  return mod.exports;
}

test("media pipeline migration creates generic assets, derivatives, jobs, buckets, and scoped source uploads", () => {
  const migration = source("supabase/migrations/202607100001_media_pipeline.sql");

  assert.match(migration, /create table if not exists public\.media_assets/);
  assert.match(migration, /create table if not exists public\.media_derivatives/);
  assert.match(migration, /create table if not exists public\.media_processing_jobs/);
  assert.match(migration, /surface in \('post', 'avatar', 'memory'\)/);
  assert.match(migration, /media_type in \('image', 'video'\)/);
  assert.match(migration, /source_storage_path ~ \('\^sources\/' \|\| surface/);
  assert.match(migration, /'media-sources'[\s\S]*false/);
  assert.match(migration, /'media-public'[\s\S]*true/);
  assert.match(migration, /'media-private'[\s\S]*false/);
  assert.match(migration, /Authenticated users can upload scoped media sources/);
  assert.match(migration, /asset\.source_storage_path = storage\.objects\.name/);
  assert.match(migration, /add column if not exists media_asset_id/);
  assert.match(migration, /avatar_media_asset_id/);
  assert.match(migration, /media-sources', 'media-public', 'media-private/);
  const visibilityMigration = source("supabase/migrations/202607130001_visibility_aware_post_media.sql");
  assert.match(visibilityMigration, /access_class/);
  assert.match(visibilityMigration, /private_media_derivative_requires_private_bucket/);
});

test("media pipeline routes expose intent, finalize, status, and worker processing", () => {
  const upload = source("app/api/media/upload-intent/route.ts");
  const finalize = source("app/api/media/finalize-upload/route.ts");
  const status = source("app/api/media/status/route.ts");
  const worker = source("app/api/internal/media/process/route.ts");
  const script = source("scripts/media-worker.mjs");
  const pkg = source("package.json");

  assert.match(upload, /normalizeMediaIntentInput/);
  assert.match(upload, /MEDIA_SOURCE_BUCKET/);
  assert.doesNotMatch(upload, /body\?\.sourceStoragePath|body\?\.storagePath|body\?\.ownerId/);
  assert.match(finalize, /storageObjectMetadata/);
  assert.doesNotMatch(finalize, /Buffer\.from\(await blob\.arrayBuffer\(\)\)/);
  assert.match(finalize, /enqueueMediaProcessingJob/);
  const access = source("app/api/media/access/route.ts");
  assert.doesNotMatch(status, /createSignedUrl/);
  assert.match(access, /resolvePostMediaAccess/);
  assert.match(worker, /runMediaProcessingBatch/);
  assert.match(script, /\/api\/internal\/media\/process/);
  assert.match(pkg, /"media:worker": "node scripts\/media-worker\.mjs"/);
});

test("media crop math centers a full-frame 4:5 post crop", () => {
  const { cropPixelsForRect, normalizeCropRect } = loadMediaPipelineModule();
  const crop = normalizeCropRect("post", { x: 0, y: 0, width: 1, height: 1, targetAspect: 4 / 5 });
  const pixels = cropPixelsForRect(crop, 4000, 3000);

  assert.equal(pixels.height, 3000);
  assert.equal(pixels.left, 800);
  assert.equal(pixels.top, 0);
  assert.equal(pixels.width, 2400);
});

test("post upload intents bind explicit visibility and default uncertainty to private", () => {
  const { normalizeMediaIntentInput } = loadMediaPipelineModule();
  const base = { fileName: "photo.jpg", fileSizeBytes: 100, mediaType: "image", mimeType: "image/jpeg", surface: "post" };
  assert.equal(normalizeMediaIntentInput({ ...base, intendedVisibility: "public" }).accessClass, "public_post");
  assert.equal(normalizeMediaIntentInput({ ...base, intendedVisibility: "circle" }).accessClass, "circle_post");
  assert.equal(normalizeMediaIntentInput({ ...base, intendedVisibility: "me" }).accessClass, "private_post");
  assert.equal(normalizeMediaIntentInput(base).accessClass, "private_post");
  assert.throws(() => normalizeMediaIntentInput({ ...base, intendedVisibility: "everyone" }), /media_post_visibility_invalid/);
});

test("image processing creates exact 4:5 post canonical and thumbnail derivatives", async () => {
  const { MEDIA_SOURCE_BUCKET, processMediaAsset } = loadMediaPipelineModule();
  const sourceBuffer = await sharp({
    create: {
      background: { r: 230, g: 120, b: 40 },
      channels: 3,
      height: 600,
      width: 800
    }
  }).jpeg().toBuffer();

  const uploads = [];
  const derivatives = [];
  const admin = {
    storage: {
      from(bucket) {
        return {
          download: async (storagePath) => {
            assert.equal(bucket, MEDIA_SOURCE_BUCKET);
            assert.equal(storagePath, "sources/post/user-1/asset-1/original.jpg");
            return { data: new Blob([sourceBuffer]), error: null };
          },
          getPublicUrl: (storagePath) => ({ data: { publicUrl: `https://media.test/${bucket}/${storagePath}` } }),
          upload: async (storagePath, body, options) => {
            uploads.push({ body, bucket, options, storagePath });
            return { data: null, error: null };
          }
        };
      }
    },
    from(table) {
      assert.equal(table, "media_derivatives");
      return {
        upsert(row) {
          derivatives.push(row);
          return { error: null };
        }
      };
    }
  };

  await processMediaAsset(admin, {
    crop_rect: { x: 0, y: 0, width: 1, height: 1, targetAspect: 4 / 5 },
    duration_ms: null,
    id: "asset-1",
    media_type: "image",
    original_extension: "jpg",
    original_file_size_bytes: sourceBuffer.byteLength,
    original_height: 600,
    original_mime_type: "image/jpeg",
    original_width: 800,
    owner_id: "user-1",
    owner_name: "User One",
    source_bucket_id: MEDIA_SOURCE_BUCKET,
    source_storage_path: "sources/post/user-1/asset-1/original.jpg",
    status: "uploaded",
    surface: "post",
    access_class: "public_post",
    visibility: "public"
  });

  const canonical = derivatives.find((row) => row.kind === "canonical");
  const thumbnail = derivatives.find((row) => row.kind === "thumbnail");
  assert.equal(canonical.width, 1080);
  assert.equal(canonical.height, 1350);
  assert.equal(canonical.mime_type, "image/jpeg");
  assert.equal(canonical.bucket_id, "media-private");
  assert.equal(canonical.public_url, null);
  assert.match(canonical.storage_path, /^private-posts\//);
  assert.match(canonical.blurhash, /^.{6}$/);
  assert.equal(thumbnail.width, 360);
  assert.equal(thumbnail.height, 450);
  assert.equal(uploads.length, 2);
  assert.deepEqual(uploads.map((upload) => upload.options.cacheControl), ["300", "300"]);
});
