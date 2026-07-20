#!/usr/bin/env node

import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function isLoopbackUrl(value) {
  try {
    return ["127.0.0.1", "localhost", "::1"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

function localSupabaseEnvironment() {
  const url = "http://127.0.0.1:54321";
  if (!isLoopbackUrl(url)) throw new Error("Refusing Home media integrity report outside loopback");
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "supabase-demo", role: "service_role", exp: 1983812996 })).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", "super-secret-jwt-token-with-at-least-32-characters-long")
    .update(unsigned)
    .digest("base64url");
  return { serviceKey: `${unsigned}.${signature}`, url };
}

const environment = localSupabaseEnvironment();
const admin = createClient(environment.url, environment.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const { data, error } = await admin.rpc("home_media_integrity_report_v1");
if (error) throw new Error("Home media integrity report RPC is unavailable; apply the latest local migration first");

const report = data ?? {};
const summary = {
  brokenMediaLinks: Array.isArray(report.brokenMediaLinks) ? report.brokenMediaLinks.length : 0,
  missingFeedDerivatives: Array.isArray(report.missingFeedDerivatives) ? report.missingFeedDerivatives.length : 0,
  publishedWithZeroLinks: Array.isArray(report.publishedWithZeroLinks) ? report.publishedWithZeroLinks.length : 0,
  publishedWithZeroReadyMedia: Array.isArray(report.publishedWithZeroReadyMedia) ? report.publishedWithZeroReadyMedia.length : 0
};
console.log(JSON.stringify({ environment: "local", report, summary }, null, 2));
