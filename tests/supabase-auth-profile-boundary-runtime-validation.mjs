#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

function localEnvironment() {
  const result = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status !== 0) throw new Error(`local_supabase_unavailable: ${result.stderr.trim()}`);
  const status = JSON.parse(result.stdout);
  return { anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY, url: status.API_URL };
}

function client(url, key) {
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function createUser(admin, marker) {
  const email = `auth-boundary-${marker}-${randomUUID()}@example.test`;
  const password = `Unsupported-${randomUUID()}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("user_create_failed");
  return { email, id: data.user.id, password };
}

async function passwordlessSession(admin, env, user) {
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    email: user.email,
    type: "magiclink"
  });
  if (linkError || !link.properties?.hashed_token) throw linkError ?? new Error("magiclink_generation_failed");
  const userClient = client(env.url, env.anonKey);
  const { data, error } = await userClient.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink"
  });
  if (error || !data.session) throw error ?? new Error("passwordless_session_failed");
  return userClient;
}

function rejected(result, label) {
  assert.ok(result.error, `${label} unexpectedly succeeded`);
}

const env = localEnvironment();
const admin = client(env.url, env.serviceRoleKey);
const createdUsers = [];

try {
  const alpha = await createUser(admin, "alpha");
  const beta = await createUser(admin, "beta");
  const incomplete = await createUser(admin, "incomplete");
  createdUsers.push(alpha.id, beta.id, incomplete.id);

  const passwordClient = client(env.url, env.anonKey);
  const passwordAttempt = await passwordClient.auth.signInWithPassword({
    email: alpha.email,
    password: alpha.password
  });
  assert.ok(passwordAttempt.error, "password sign-in unexpectedly created a session");
  assert.equal(passwordAttempt.data.session, null, "password sign-in returned a session");

  const recoveryLink = await admin.auth.admin.generateLink({ email: alpha.email, type: "recovery" });
  assert.ifError(recoveryLink.error);
  const recoveryClient = client(env.url, env.anonKey);
  const recoveryAttempt = await recoveryClient.auth.verifyOtp({
    token_hash: recoveryLink.data.properties.hashed_token,
    type: "recovery"
  });
  // Supabase represents a recovery-link verification as an OTP session, so an
  // access-token hook cannot distinguish it from the supported email OTP. The
  // app has no recovery route and rejects PASSWORD_RECOVERY events. Even if an
  // account owner calls the provider endpoint directly and sets a password,
  // the server hook must still reject the resulting password sign-in.
  assert.ifError(recoveryAttempt.error);
  assert.ok(recoveryAttempt.data.session, "provider recovery verification did not produce the expected OTP-class session");
  const replacementPassword = `Still-Unsupported-${randomUUID()}!`;
  const setPassword = await recoveryClient.auth.updateUser({ password: replacementPassword });
  assert.ifError(setPassword.error);
  await recoveryClient.auth.signOut({ scope: "local" });
  const recoveredPasswordAttempt = await client(env.url, env.anonKey).auth.signInWithPassword({
    email: alpha.email,
    password: replacementPassword
  });
  assert.ok(recoveredPasswordAttempt.error, "a password created from a provider recovery session unexpectedly signed in");
  assert.equal(recoveredPasswordAttempt.data.session, null);

  const alphaClient = await passwordlessSession(admin, env, alpha);
  const betaClient = await passwordlessSession(admin, env, beta);
  const incompleteClient = await passwordlessSession(admin, env, incomplete);

  rejected(await alphaClient.from("profiles").insert({
    id: alpha.id,
    first_name: "Direct",
    last_name: "Insert",
    username: "direct_insert"
  }), "direct own profile insert");

  rejected(await alphaClient.rpc("complete_current_profile", {
    p_name: "   ",
    p_username: "boundary_alpha"
  }), "blank Name onboarding");
  rejected(await alphaClient.rpc("complete_current_profile", {
    p_name: "Alpha Person",
    p_username: "Uppercase"
  }), "invalid username onboarding");

  const alphaCompletion = await alphaClient.rpc("complete_current_profile", {
    p_name: "Alpha Person",
    p_username: "boundary_alpha"
  });
  assert.ifError(alphaCompletion.error);
  assert.equal(alphaCompletion.data?.[0]?.id, alpha.id);

  const retry = await alphaClient.rpc("complete_current_profile", {
    p_name: "Alpha Person",
    p_username: "boundary_alpha"
  });
  assert.ifError(retry.error);
  assert.equal(retry.data?.[0]?.username, "boundary_alpha", "idempotent onboarding retry changed the profile");

  rejected(await alphaClient.rpc("complete_current_profile", {
    p_name: "Changed Through Onboarding",
    p_username: "boundary_changed"
  }), "completed-profile onboarding mutation");
  rejected(await alphaClient.rpc("complete_current_profile", {
    p_name: "Alpha Person",
    p_trust_score: 100,
    p_username: "boundary_alpha"
  }), "unexpected trusted onboarding parameter");
  rejected(await alphaClient.rpc("complete_current_profile", {
    p_name: "Alpha Person",
    p_user_id: beta.id,
    p_username: "boundary_alpha"
  }), "caller-selected onboarding owner");

  rejected(await betaClient.rpc("complete_current_profile", {
    p_name: "Beta Person",
    p_username: "boundary_alpha"
  }), "taken username onboarding");
  const betaCompletion = await betaClient.rpc("complete_current_profile", {
    p_name: "Beta Person",
    p_username: "boundary_beta"
  });
  assert.ifError(betaCompletion.error);

  const directTrustedUpdate = await alphaClient
    .from("profiles")
    .update({ account_status: "deleting", trust_score: 100 })
    .eq("id", alpha.id);
  rejected(directTrustedUpdate, "direct trusted-field update");
  rejected(await alphaClient.from("profiles").delete().eq("id", alpha.id), "direct profile delete");
  rejected(await alphaClient.from("profiles").update({ bio: "foreign" }).eq("id", beta.id), "foreign profile update");

  const details = await alphaClient.rpc("update_current_profile_details", {
    p_bio: "Food explorer",
    p_name: "Alpha Updated"
  });
  assert.ifError(details.error);
  assert.equal(details.data?.[0]?.bio, "Food explorer");
  const accountType = await alphaClient.rpc("update_current_account_type", { p_account_type: "private" });
  assert.ifError(accountType.error);
  assert.equal(accountType.data?.[0]?.account_type, "private");
  const username = await alphaClient.rpc("update_current_username", { p_username: "boundary_alpha2" });
  assert.ifError(username.error);
  assert.equal(username.data?.[0]?.username, "boundary_alpha2");

  const completeBeforeFreeze = await alphaClient.rpc("is_profile_complete", { p_user_id: alpha.id });
  assert.ifError(completeBeforeFreeze.error);
  assert.equal(completeBeforeFreeze.data, true);

  const incompleteInsert = await admin.from("profiles").insert({
    id: incomplete.id,
    first_name: "",
    last_name: "",
    username: "boundary_incomplete"
  });
  assert.ifError(incompleteInsert.error);
  const alphaSeesIncomplete = await alphaClient.from("profiles").select("id").eq("id", incomplete.id);
  assert.ifError(alphaSeesIncomplete.error);
  assert.equal(alphaSeesIncomplete.data?.length, 0, "another user's incomplete profile was readable");
  const ownerSeesIncomplete = await incompleteClient.from("profiles").select("id").eq("id", incomplete.id);
  assert.ifError(ownerSeesIncomplete.error);
  assert.equal(ownerSeesIncomplete.data?.length, 1, "incomplete owner could not resume onboarding");

  const freeze = await admin.from("profiles").update({
    account_status: "deleting",
    deletion_started_at: new Date().toISOString()
  }).eq("id", alpha.id);
  assert.ifError(freeze.error);
  rejected(await alphaClient.rpc("update_current_profile_details", {
    p_bio: null,
    p_name: "Frozen Mutation"
  }), "frozen-account profile edit");
  const completeAfterFreeze = await admin.rpc("is_profile_complete", { p_user_id: alpha.id });
  assert.ifError(completeAfterFreeze.error);
  assert.equal(completeAfterFreeze.data, false);

  console.log("PASS: password token issuance is rejected, including a credential created through a direct provider recovery call");
  console.log("PASS: direct, cross-user, trusted-field, and deletion profile writes are denied");
  console.log("PASS: restricted onboarding/edit RPCs are validated, owner-derived, idempotent, and lifecycle-aware");
  console.log("PASS: incomplete profile visibility and authoritative completeness are enforced");
} finally {
  for (const userId of createdUsers) {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  }
}
