#!/usr/bin/env node

import { execFile as execFileCallback, spawn } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const verifyOnly = process.argv.includes("--verify");

function withinRepository(relativePath) {
  const resolved = path.resolve(repositoryRoot, relativePath);
  if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error("preview_deploy_path_outside_repository");
  }
  return resolved;
}

async function trackedFiles() {
  const { stdout } = await execFile("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  return stdout.split("\0").filter(Boolean);
}

async function requireCleanTrackedWorktree() {
  if (verifyOnly) return;
  const { stdout } = await execFile("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  if (stdout.trim()) throw new Error("preview_deploy_requires_clean_tracked_worktree");
}

async function copyTrackedSource(stagingRoot, files) {
  for (const relativePath of files) {
    const sourcePath = withinRepository(relativePath);
    const sourceStat = await lstat(sourcePath);
    if (!sourceStat.isFile()) throw new Error("preview_deploy_non_file_source_not_supported");
    const destinationPath = path.join(stagingRoot, relativePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }
}

async function installPreviewConfig(stagingRoot) {
  const previewConfigText = await readFile(path.join(repositoryRoot, "vercel.preview.json"), "utf8");
  const previewConfig = JSON.parse(previewConfigText);
  if ("crons" in previewConfig) throw new Error("preview_deploy_config_must_not_register_crons");
  await writeFile(path.join(stagingRoot, "vercel.json"), `${JSON.stringify(previewConfig, null, 2)}\n`, { mode: 0o644 });
}

async function installProjectLink(stagingRoot) {
  const projectLink = path.join(repositoryRoot, ".vercel", "project.json");
  try {
    await mkdir(path.join(stagingRoot, ".vercel"), { recursive: true });
    await copyFile(projectLink, path.join(stagingRoot, ".vercel", "project.json"));
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("preview_deploy_requires_vercel_link");
    throw error;
  }
}

async function deploy(stagingRoot) {
  const child = spawn(
    "npx",
    ["--yes", "vercel@56.4.0", "deploy", "--yes", "--target=preview"],
    { cwd: stagingRoot, env: process.env, stdio: "inherit" }
  );
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => signal ? reject(new Error("preview_deploy_interrupted")) : resolve(code));
  });
  if (exitCode !== 0) throw new Error("preview_deploy_failed");
}

let stagingRoot;
try {
  await requireCleanTrackedWorktree();
  const files = await trackedFiles();
  stagingRoot = await mkdtemp(path.join(tmpdir(), "foodreview-vercel-preview-"));
  await copyTrackedSource(stagingRoot, files);
  await installPreviewConfig(stagingRoot);
  await installProjectLink(stagingRoot);

  if (verifyOnly) {
    console.log(JSON.stringify({ copiedTrackedFiles: files.length, status: "ok", target: "preview" }));
  } else {
    await deploy(stagingRoot);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "preview_deploy_failed");
  process.exitCode = 1;
} finally {
  if (stagingRoot) await rm(stagingRoot, { force: true, recursive: true });
}
