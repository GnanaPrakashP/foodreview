import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

export function loadServerModule(relativePath) {
  if (moduleCache.has(relativePath)) return moduleCache.get(relativePath);
  const absolutePath = path.join(rootDir, relativePath);
  const source = readFileSync(absolutePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });
  const mod = { exports: {} };
  moduleCache.set(relativePath, mod.exports);
  vm.runInNewContext(outputText, {
    console,
    Date,
    Number,
    exports: mod.exports,
    module: mod,
    process,
    require(id) {
      if (id === "@/lib/server/dish-identity") return loadServerModule("lib/server/dish-identity.ts");
      if (id === "@/lib/server/dish-identity-backfill") return loadServerModule("lib/server/dish-identity-backfill.ts");
      if (id === "@/lib/server/dish-identity-report") return loadServerModule("lib/server/dish-identity-report.ts");
      if (id === "@/lib/server/dish-candidate-review") return loadServerModule("lib/server/dish-candidate-review.ts");
      if (id === "@/lib/server/dish-orphan-repair") return loadServerModule("lib/server/dish-orphan-repair.ts");
      if (id === "@/lib/server/dish-trigram") return loadServerModule("lib/server/dish-trigram.ts");
      if (id === "@/lib/types") return {};
      throw new Error(`Unexpected require while loading ${relativePath}: ${id}`);
    },
    setTimeout,
    clearTimeout
  }, { filename: absolutePath });
  moduleCache.set(relativePath, mod.exports);
  return mod.exports;
}
