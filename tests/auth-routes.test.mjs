/**
 * Tests for GET /auth/callback (OAuth code exchange).
 *
 * POST /api/delete-account is covered in tests/delete-account-route.test.mjs.
 * login/signup form, profile edit, and the public/private toggle are handled
 * by client components (localStorage + browser Supabase client) and cannot be
 * tested in this VM style.  Those paths are enforced at the RLS layer
 * (tests/rls-schema.test.mjs) and by the actor-derivation tests in
 * tests/circle-auth.test.mjs.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// ── transpile ─────────────────────────────────────────────────────────────────

function transpile(src) {
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  return outputText;
}

const callbackSrc = transpile(
  readFileSync(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8")
);

// ── shared mock ───────────────────────────────────────────────────────────────

const mockNextResponse = {
  json(b, opts) { return { _body: b, _status: opts?.status ?? 200 }; },
  redirect(url) { return { _redirectUrl: String(url) }; },
};

function redirectUrl(res) { return res._redirectUrl; }

// ── loader ────────────────────────────────────────────────────────────────────

function loadCallback(code, {
  complete = true,
  exchangeResult = { data: { user: { id: "11111111-1111-4111-8111-111111111111" } }, error: null }
} = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    console,
    process: { env: {} },
    URL,
    require(id) {
      if (id === "@supabase/ssr") {
        return {
          createServerClient: () => ({
            auth: {
              exchangeCodeForSession: async () => exchangeResult,
              signOut: async () => ({ error: null })
            },
          }),
        };
      }
      if (id === "next/headers") {
        return { cookies: async () => ({ getAll: () => [], set: () => {} }) };
      }
      if (id === "next/server") {
        return { NextRequest: class {}, NextResponse: mockNextResponse };
      }
      if (id === "@/lib/supabase/admin") {
        return {
          createAdminClient: () => ({
            rpc: async () => ({ data: complete, error: null })
          })
        };
      }
      throw new Error(`Unexpected require in callback: ${id}`);
    },
  });
  return mod.exports;
}

// ── GET /auth/callback ────────────────────────────────────────────────────────

test("callback: no code param redirects to /login?error=auth_failed", async () => {
  const { GET } = loadCallback(callbackSrc);
  const res = await GET({ url: "http://localhost:3000/auth/callback" });
  assert.ok(redirectUrl(res).includes("login?error=auth_failed"),
    `Expected login error redirect, got: ${redirectUrl(res)}`);
});

test("callback: valid code + successful exchange redirects to /", async () => {
  const { GET } = loadCallback(callbackSrc);
  const res = await GET({ url: "http://localhost:3000/auth/callback?code=abc123" });
  assert.equal(redirectUrl(res), "http://localhost:3000/");
});

test("callback: valid code + custom next param redirects to that path", async () => {
  const { GET } = loadCallback(callbackSrc);
  const res = await GET({ url: "http://localhost:3000/auth/callback?code=abc&next=/onboarding" });
  assert.equal(redirectUrl(res), "http://localhost:3000/onboarding");
});

test("callback: incomplete profile always redirects to onboarding", async () => {
  const { GET } = loadCallback(callbackSrc, { complete: false });
  const res = await GET({ url: "http://localhost:3000/auth/callback?code=abc&next=/reviews/one" });
  assert.equal(redirectUrl(res), "http://localhost:3000/onboarding");
});

test("callback: code present but exchange fails → redirects to /login?error=auth_failed", async () => {
  const { GET } = loadCallback(callbackSrc, {
    exchangeResult: { error: { message: "invalid token" } },
  });
  const res = await GET({ url: "http://localhost:3000/auth/callback?code=bad" });
  assert.ok(redirectUrl(res).includes("login?error=auth_failed"));
});

test("callback: origin is preserved in the redirect URL", async () => {
  const { GET } = loadCallback(callbackSrc);
  const res = await GET({ url: "https://myapp.vercel.app/auth/callback?code=xyz" });
  assert.ok(redirectUrl(res).startsWith("https://myapp.vercel.app/"));
});

test("callback: next param is used even when exchange fails", async () => {
  const { GET } = loadCallback(callbackSrc, {
    exchangeResult: { error: { message: "expired" } },
  });
  const res = await GET({ url: "http://localhost:3000/auth/callback?code=x&next=/home" });
  // exchange failed → should still land on the error page, not /home
  assert.ok(redirectUrl(res).includes("login?error=auth_failed"));
});
