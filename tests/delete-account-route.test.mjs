import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("../app/api/delete-account/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
);

function loadRoute({ rpcData = [{ job_id: "job-1", job_status: "inventory_pending" }], rpcError = null, user = { id: "user-1" } } = {}) {
  const rpcCalls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    rpc: async (name) => {
      rpcCalls.push(name);
      return { data: rpcData, error: rpcError };
    }
  };
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    module: mod,
    exports: mod.exports,
    require(id) {
      if (id === "next/server") {
        return {
          NextResponse: {
            json(body, options) {
              return { body, headers: options?.headers ?? {}, status: options?.status ?? 200 };
            }
          }
        };
      }
      if (id === "@/lib/server/memory-observability") {
        return { memoryErrorKind: () => "test", memoryOperationDurationMs: () => 1, recordMemoryOperation: () => {} };
      }
      if (id === "@/lib/server/route-supabase") return { createRouteSupabase: async () => client };
      throw new Error(`Unexpected require: ${id}`);
    }
  });
  return { route: mod.exports, rpcCalls };
}

test("delete account route rejects an unauthenticated request", async () => {
  const { route, rpcCalls } = loadRoute({ user: null });
  const response = await route.POST({});
  assert.equal(response.status, 401);
  assert.equal(response.body.error, "Not authenticated");
  assert.equal(rpcCalls.length, 0);
});

test("delete account route atomically requests the durable job and returns accepted", async () => {
  const { route, rpcCalls } = loadRoute();
  const response = await route.POST({});
  assert.equal(response.status, 202);
  assert.equal(response.body.accepted, true);
  assert.equal(response.body.jobId, "job-1");
  assert.equal(response.body.status, "inventory_pending");
  assert.equal(response.headers["Cache-Control"], "private, no-store");
  assert.deepEqual(rpcCalls, ["request_account_deletion"]);
});

test("delete account route never invokes the retired auth-first RPC", async () => {
  const { route, rpcCalls } = loadRoute();
  await route.POST({});
  assert.equal(rpcCalls.includes("delete_current_account"), false);
});

test("delete account route returns a generic failure without exposing database details", async () => {
  const { route } = loadRoute({ rpcError: { message: "private database detail" } });
  const response = await route.POST({});
  assert.equal(response.status, 500);
  assert.equal(response.body.error, "Unable to start account deletion");
  assert.doesNotMatch(response.body.error, /database detail/);
});
