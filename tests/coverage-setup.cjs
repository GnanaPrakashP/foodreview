const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { syncBuiltinESMExports } = require("node:module");
const vm = require("node:vm");

const originalReadFileSync = fs.readFileSync;
const originalRunInNewContext = vm.runInNewContext;

function sourceFilename(file) {
  const filename = file instanceof URL ? fileURLToPath(file) : path.resolve(String(file));
  return /\.[cm]?tsx?$/.test(filename) ? filename.replaceAll("\\", "/") : null;
}

function appendSourceUrl(content, filename) {
  if (typeof content !== "string" || content.includes("sourceURL=")) return content;
  return `${content}\n//# sourceURL=${filename}\n`;
}

fs.readFileSync = function readFileSyncWithCoverageSource(file, options) {
  const content = originalReadFileSync.apply(this, arguments);
  const encoding = typeof options === "string" ? options : options?.encoding;
  const filename = sourceFilename(file);

  if (!filename || !encoding || !Buffer.isEncoding(encoding)) return content;
  return appendSourceUrl(content, filename);
};

vm.runInNewContext = function runInNewContextWithCoverageFilename(code, contextObject, options) {
  const match = typeof code === "string" ? code.match(/\/\/# sourceURL=(.+)\s*$/m) : null;
  const filename = match?.[1];

  if (!filename) return originalRunInNewContext.apply(this, arguments);
  const nextOptions = typeof options === "string"
    ? { filename: options }
    : { ...(options ?? {}), filename };
  return originalRunInNewContext.call(this, code, contextObject, nextOptions);
};

syncBuiltinESMExports();
