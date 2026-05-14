/**
 * Seed script for E2E test users.
 *
 * Creates three test users (A = public, B = public, C = private) whose
 * credentials come from .env.e2e.  Public/circle/private reviews are inserted
 * for each user so visibility, stats, places, and dishes tests have stable
 * seeded data. A and B also share "E2E Kitchen" and have a mutual circle edge
 * so common-restaurant and circle-visibility tests work without first running
 * the "add to circle" flow.
 *
 * Prerequisites:
 *   - .env.e2e  — E2E_USER_{A,B,C}_{EMAIL,PASSWORD,NAME}
 *   - .env.local — NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * Run:
 *   node scripts/seed-e2e.mjs
 *
 * Re-running is safe — existing users and rows are skipped.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(file) {
  try {
    return Object.fromEntries(
      readFileSync(resolve(__dirname, "..", file), "utf8")
        .split("\n")
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => {
          const idx = l.indexOf("=");
          return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
        })
    );
  } catch {
    return {};
  }
}

const local = loadEnv(".env.local");
const e2e = loadEnv(".env.e2e");

const SUPABASE_URL = local.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = local.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "\n❌  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env.local\n"
  );
  process.exit(1);
}

function requiredEnv(key) {
  const v = e2e[key];
  if (!v) {
    console.error(`\n❌  ${key} missing from .env.e2e\n`);
    process.exit(1);
  }
  return v;
}

const users = [
  {
    email:       requiredEnv("E2E_USER_A_EMAIL"),
    password:    requiredEnv("E2E_USER_A_PASSWORD"),
    name:        requiredEnv("E2E_USER_A_NAME"),
    accountType: "public",
  },
  {
    email:       requiredEnv("E2E_USER_B_EMAIL"),
    password:    requiredEnv("E2E_USER_B_PASSWORD"),
    name:        requiredEnv("E2E_USER_B_NAME"),
    accountType: "public",
  },
  {
    email:       requiredEnv("E2E_USER_C_EMAIL"),
    password:    requiredEnv("E2E_USER_C_PASSWORD"),
    name:        requiredEnv("E2E_USER_C_NAME"),
    accountType: "private",
  },
];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const E2E_RESTAURANT = "E2E Kitchen";

function isMissingTableError(error) {
  return (
    error?.code === "PGRST205" ||
    error?.message?.includes("Could not find the table")
  );
}

function reviewsFor(name) {
  const username = usernameForName(name);
  const userLabel = name.split(/\s+/).pop() || name.replace(/\s+/g, "");
  const uniqueRestaurant = (visibility) => `E2E ${userLabel} ${visibility} Kitchen`;
  const base = {
    reviewer_name:   username,
    area:            "Test Area",
  };
  const sharedBase = { ...base, restaurant_name: E2E_RESTAURANT };
  const isUserA = name === users[0].name;

  return [
    {
      ...sharedBase,
      items: [{ name: "E2E Idli", rating: 5 }],
      body: isUserA ? "E2E seed review (public)" : `E2E seed review (${name} public)`,
      visibility: "public",
    },
    {
      ...sharedBase,
      items: [{ name: "E2E Dosa", rating: 4 }],
      body: isUserA ? "E2E seed review (circle-only)" : `E2E seed review (${name} circle-only)`,
      visibility: "circle",
    },
    {
      ...base,
      restaurant_name: uniqueRestaurant("Private"),
      items: [{ name: "E2E Secret Dish", rating: 5 }],
      body: `E2E seed review (${name} private)`,
      visibility: "me",
    },
  ];
}

function usernameForName(name) {
  return name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

async function seedUser(u) {
  const [firstName, ...rest] = u.name.split(" ");
  const lastName = rest.join(" ") || "";
  const username = usernameForName(u.name);

  process.stdout.write(`  ${u.name} (${u.email})… `);

  // 1. Auth user
  const { data: existing } = await admin.auth.admin.listUsers();
  const existingUser = existing?.users?.find((usr) => usr.email === u.email);

  let userId;
  if (existingUser) {
    userId = existingUser.id;
    process.stdout.write("auth exists ");
    const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
      password: u.password,
      user_metadata: {
        ...(existingUser.user_metadata ?? {}),
        full_name: u.name,
        name: u.name,
        username,
        account_type: u.accountType,
        onboarding_complete: true,
      },
    });
    if (updateErr) process.stdout.write(`⚠️ auth metadata: ${updateErr.message} `);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email:         u.email,
      password:      u.password,
      email_confirm: true,
      user_metadata: {
        full_name: u.name,
        name: u.name,
        username,
        account_type: u.accountType,
        onboarding_complete: true,
      },
    });
    if (error) {
      console.log(`❌  auth: ${error.message}`);
      return null;
    }
    userId = data.user.id;
    process.stdout.write("auth created ");
  }

  // 2. Profile
  const { error: profileErr } = await admin.from("profiles").upsert({
    id:         userId,
    first_name: firstName,
    last_name:  lastName,
    username,
    account_type: u.accountType,
  });
  if (profileErr) {
    process.stdout.write(`❌ profile: ${profileErr.message} `);
    if (profileErr.message?.includes("account_type")) {
      process.stdout.write("Run supabase/schema.sql on a fresh database first. ");
    }
    console.log("");
    return null;
  }
  process.stdout.write("profile ok ");

  // 3. Reviews (insert each deterministic row once by body)
  const reviews = reviewsFor(u.name);
  if (reviews.length) {
    const { data: existing2 } = await admin
      .from("reviews")
      .select("body")
      .eq("reviewer_name", username)
      .in("body", reviews.map((review) => review.body));

    const existingBodies = new Set((existing2 ?? []).map((row) => row.body));
    const missingReviews = reviews.filter((review) => !existingBodies.has(review.body));
    if (missingReviews.length) {
      const { error: revErr } = await admin.from("reviews").insert(missingReviews);
      if (revErr) process.stdout.write(`⚠️ reviews: ${revErr.message} `);
      else process.stdout.write(`${missingReviews.length} reviews created `);
    } else {
      process.stdout.write("reviews exist ");
    }
  }

  console.log("✅");
  return { userId, name: u.name, username };
}

async function seedCircle(nameA, nameB) {
  process.stdout.write(`  Circle edge ${nameA} ↔ ${nameB}… `);

  const { data: existing, error: existingErr } = await admin
    .from("circle_memberships")
    .select("user_name")
    .eq("user_name", nameA)
    .eq("member_name", nameB)
    .limit(1);

  if (isMissingTableError(existingErr)) {
    await seedAcceptedCircleRequest(nameA, nameB);
    return;
  }

  if (existing?.length) {
    console.log("already exists ✅");
    return;
  }

  const { error: e1 } = await admin.from("circle_memberships").insert({ user_name: nameA, member_name: nameB });
  const { error: e2 } = await admin.from("circle_memberships").insert({ user_name: nameB, member_name: nameA });
  if (isMissingTableError(e1) || isMissingTableError(e2)) {
    await seedAcceptedCircleRequest(nameA, nameB);
    return;
  }
  if (e1 || e2) {
    console.log(`⚠️  ${e1?.message ?? ""} ${e2?.message ?? ""}`);
  } else {
    console.log("created ✅");
  }
}

async function seedAcceptedCircleRequest(nameA, nameB) {
  const { error } = await admin
    .from("circle_requests")
    .upsert(
      { sender_name: nameA, receiver_name: nameB, status: "accepted" },
      { onConflict: "sender_name,receiver_name" }
    );

  if (error) {
    console.log(`⚠️  circle_memberships missing; fallback circle_requests failed: ${error.message}`);
  } else {
    console.log("circle_memberships missing; accepted request fallback created ✅");
  }
}

async function run() {
  console.log("🌱  Seeding E2E test users…\n");

  const results = [];
  for (const u of users) {
    const r = await seedUser(u);
    if (r) results.push(r);
  }

  // Create mutual circle between A and B so visibility + badge tests work immediately
  if (results.length >= 2) {
    console.log("");
    await seedCircle(results[0].username, results[1].username);
  }

  console.log("\n✅  Done.  Run: npx playwright test e2e/production-smoke.spec.ts --project=chromium\n");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
