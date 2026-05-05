/**
 * FoodCircle seed script
 * Creates 10 auth users (email + password), their profiles, and reviews.
 *
 * Prerequisites:
 *   Add SUPABASE_SERVICE_ROLE_KEY to .env.local
 *
 * Run:
 *   node scripts/seed.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

/* ── Load .env.local ── */
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error(
    "\n❌  SUPABASE_SERVICE_ROLE_KEY not found in .env.local\n" +
    "    Add it from: Supabase Dashboard → Project Settings → API → service_role\n"
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* ── Helpers ── */
function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

/* ── Users ── */
const USERS = [
  { firstName: "Arjun",     lastName: "Sharma",    username: "arjun_sharma",    email: "arjun@foodcircle.test"    },
  { firstName: "Priya",     lastName: "Nair",      username: "priya_nair",      email: "priya@foodcircle.test"    },
  { firstName: "Kiran",     lastName: "Reddy",     username: "kiran_reddy",     email: "kiran@foodcircle.test"    },
  { firstName: "Divya",     lastName: "Menon",     username: "divya_menon",     email: "divya@foodcircle.test"    },
  { firstName: "Rahul",     lastName: "Gupta",     username: "rahul_gupta",     email: "rahul@foodcircle.test"    },
  { firstName: "Ananya",    lastName: "Krishnan",  username: "ananya_krishnan", email: "ananya@foodcircle.test"   },
  { firstName: "Vikram",    lastName: "Iyer",      username: "vikram_iyer",     email: "vikram@foodcircle.test"   },
  { firstName: "Meera",     lastName: "Pillai",    username: "meera_pillai",    email: "meera@foodcircle.test"    },
  { firstName: "Siddharth", lastName: "Rao",       username: "siddharth_rao",   email: "siddharth@foodcircle.test"},
  { firstName: "Lakshmi",   lastName: "Bhat",      username: "lakshmi_bhat",    email: "lakshmi@foodcircle.test"  },
];

const PASSWORD = "Test@1234";

/* ── Reviews ── */
const RESTAURANT_AREA = {
  "Murugan Idli Shop":      "T. Nagar",
  "Dindigul Thalappakatti": "T. Nagar",
  "Chettinad Kitchen":      "Nungambakkam",
  "Pizza Roma":             "Nungambakkam",
  "Nagi Ramen":             "Anna Nagar",
  "Burma Burma":            "Nungambakkam",
  "Madurai Mess":           "Mylapore",
  "Burger Lab":             "OMR",
  "Shawarma Bros":          "Velachery",
};

function reviewsFor(fullName) {
  const all = {
    "Arjun Sharma": [
      { restaurant_name: "Murugan Idli Shop",       items: [{ name: "Idli",               rating: 5 }, { name: "Sambar",            rating: 5 }], body: "Softest idlis in the city. The sambar hits different here.",                  created_at: daysAgo(2)  },
      { restaurant_name: "Dindigul Thalappakatti",  items: [{ name: "Dindigul Biryani",    rating: 5 }, { name: "Mutton Pepper Fry", rating: 5 }], body: "Mutton pepper fry with biryani — this is the combo.",                        created_at: daysAgo(7)  },
      { restaurant_name: "Chettinad Kitchen",       items: [{ name: "Kavuni Arisi",        rating: 5 }, { name: "Kothu Parotta",     rating: 4 }], body: "Kavuni arisi is an underrated dessert. Kothu parotta was loud and perfect.", created_at: daysAgo(14) },
      { restaurant_name: "Pizza Roma",              items: [{ name: "Margherita",          rating: 3 }, { name: "Tiramisu",          rating: 4 }], body: "Pizza was decent, tiramisu was the real winner.",                            created_at: daysAgo(22) },
      { restaurant_name: "Nagi Ramen",              items: [{ name: "Tonkotsu Ramen",      rating: 4 }, { name: "Gyoza",             rating: 4 }], body: "Rich broth, perfectly cooked noodles. The gyoza was crispy.",               created_at: daysAgo(29) },
    ],
    "Priya Nair": [
      { restaurant_name: "Burma Burma",             items: [{ name: "Khow Suey",           rating: 5 }, { name: "Tea Leaf Salad",    rating: 5 }], body: "The Khow Suey is an absolute experience. Come hungry.",                      created_at: daysAgo(1)  },
      { restaurant_name: "Murugan Idli Shop",       items: [{ name: "Dosa",                rating: 4 }, { name: "Chutney",           rating: 5 }], body: "The coconut chutney alone is worth the trip.",                               created_at: daysAgo(5)  },
      { restaurant_name: "Nagi Ramen",              items: [{ name: "Spicy Ramen",         rating: 5 }, { name: "Karaage",           rating: 4 }], body: "Best ramen in the city by a mile. Spice level is no joke.",                 created_at: daysAgo(12) },
      { restaurant_name: "Chettinad Kitchen",       items: [{ name: "Chettinad Chicken",   rating: 5 }, { name: "Appam",             rating: 4 }], body: "Authentic Chettinad flavours, bold and spicy. Appam was perfect.",          created_at: daysAgo(20) },
      { restaurant_name: "Shawarma Bros",           items: [{ name: "Chicken Shawarma",    rating: 5 }, { name: "Hummus",            rating: 4 }], body: "Garlic sauce on the shawarma is elite. Best quick bite.",                   created_at: daysAgo(27) },
    ],
    "Kiran Reddy": [
      { restaurant_name: "Madurai Mess",            items: [{ name: "Mutton Kuzhambu",     rating: 5 }, { name: "Parotta",           rating: 5 }], body: "Old school Madurai mess energy. This mutton kuzhambu will ruin all others.", created_at: daysAgo(3)  },
      { restaurant_name: "Burger Lab",              items: [{ name: "Smash Burger",        rating: 5 }, { name: "Truffle Fries",     rating: 5 }], body: "Double smash with truffle fries — this is what weekends are for.",          created_at: daysAgo(9)  },
      { restaurant_name: "Dindigul Thalappakatti",  items: [{ name: "Dindigul Biryani",    rating: 4 }, { name: "Salna",             rating: 5 }], body: "Salna is the secret weapon here. Order it with biryani.",                   created_at: daysAgo(17) },
      { restaurant_name: "Burma Burma",             items: [{ name: "Mohinga",             rating: 5 }, { name: "Khow Suey",         rating: 4 }], body: "Mohinga is underrated. The lemongrass broth is so clean.",                  created_at: daysAgo(25) },
    ],
    "Divya Menon": [
      { restaurant_name: "Pizza Roma",              items: [{ name: "Burrata Pizza",       rating: 5 }, { name: "Arancini",          rating: 4 }], body: "Burrata pizza changed my life. The arancini are a must-order.",             created_at: daysAgo(2)  },
      { restaurant_name: "Shawarma Bros",           items: [{ name: "Chicken Shawarma",    rating: 4 }, { name: "Pita",              rating: 3 }], body: "Quick, satisfying, and the garlic sauce makes it.",                         created_at: daysAgo(8)  },
      { restaurant_name: "Murugan Idli Shop",       items: [{ name: "Rava Idli",           rating: 4 }, { name: "Filter Coffee",     rating: 5 }], body: "Filter coffee here is the standard everything else is judged against.",     created_at: daysAgo(16) },
      { restaurant_name: "Chettinad Kitchen",       items: [{ name: "Chettinad Mutton",    rating: 5 }],                                           body: "Every spice earns its place in this curry. Respect.",                       created_at: daysAgo(23) },
      { restaurant_name: "Nagi Ramen",              items: [{ name: "Shio Ramen",          rating: 4 }, { name: "Soft Boiled Egg",   rating: 5 }], body: "Lighter broth but deeply flavourful. The egg is perfect.",                  created_at: daysAgo(30) },
    ],
    "Rahul Gupta": [
      { restaurant_name: "Nagi Ramen",              items: [{ name: "Miso Ramen",          rating: 5 }, { name: "Chashu Pork",       rating: 5 }], body: "Miso ramen with extra chashu — I will dream about this.",                  created_at: daysAgo(1)  },
      { restaurant_name: "Burger Lab",              items: [{ name: "Spicy Chicken Burger",rating: 4 }, { name: "Milkshake",         rating: 5 }], body: "The milkshake carried hard. Burger was solid.",                             created_at: daysAgo(6)  },
      { restaurant_name: "Madurai Mess",            items: [{ name: "Chicken Kuzhambu",    rating: 4 }, { name: "Rice",              rating: 3 }], body: "Solid comfort food. Nothing fancy but deeply satisfying.",                  created_at: daysAgo(13) },
      { restaurant_name: "Burma Burma",             items: [{ name: "Shan Noodles",        rating: 4 }, { name: "Laphet Thoke",      rating: 5 }], body: "Tea leaf salad is a revelation. Cannot believe I slept on it so long.",    created_at: daysAgo(21) },
    ],
    "Ananya Krishnan": [
      { restaurant_name: "Chettinad Kitchen",       items: [{ name: "Pepper Chicken",      rating: 5 }, { name: "Idiyappam",         rating: 4 }], body: "Pepper chicken with idiyappam — this combo doesn't miss.",                 created_at: daysAgo(4)  },
      { restaurant_name: "Murugan Idli Shop",       items: [{ name: "Pongal",              rating: 5 }, { name: "Vada",              rating: 4 }], body: "Pongal here has such depth. The vada is always fresh and crispy.",          created_at: daysAgo(10) },
      { restaurant_name: "Pizza Roma",              items: [{ name: "Quattro Formaggi",    rating: 5 }, { name: "Panna Cotta",       rating: 4 }], body: "Four cheese pizza is indulgent in the best way.",                           created_at: daysAgo(18) },
      { restaurant_name: "Shawarma Bros",           items: [{ name: "Falafel Wrap",        rating: 4 }, { name: "Fattoush",          rating: 4 }], body: "Solid vegetarian options here. Fattoush is crisp and bright.",              created_at: daysAgo(26) },
    ],
    "Vikram Iyer": [
      { restaurant_name: "Dindigul Thalappakatti",  items: [{ name: "Dindigul Biryani",    rating: 5 }],                                           body: "Benchmark biryani. Everything else is measured against this.",              created_at: daysAgo(3)  },
      { restaurant_name: "Madurai Mess",            items: [{ name: "Mutton Kuzhambu",     rating: 5 }, { name: "Parotta",           rating: 4 }], body: "Parotta so layered you can hear it crunch. Kuzhambu is fire.",             created_at: daysAgo(11) },
      { restaurant_name: "Burger Lab",              items: [{ name: "BBQ Bacon Burger",    rating: 4 }, { name: "Onion Rings",       rating: 4 }], body: "BBQ sauce was a bit sweet but the burger had great structural integrity.", created_at: daysAgo(19) },
      { restaurant_name: "Nagi Ramen",              items: [{ name: "Tonkotsu Ramen",      rating: 5 }, { name: "Corn Butter",       rating: 4 }], body: "Corn butter toppings in ramen sounds weird until it doesn't.",             created_at: daysAgo(28) },
    ],
    "Meera Pillai": [
      { restaurant_name: "Burma Burma",             items: [{ name: "Khow Suey",           rating: 5 }, { name: "Shan Noodles",      rating: 4 }], body: "I dream about this Khow Suey. Nothing like it.",                           created_at: daysAgo(4)  },
      { restaurant_name: "Shawarma Bros",           items: [{ name: "Beef Shawarma",       rating: 5 }, { name: "Falafel",           rating: 4 }], body: "Beef shawarma with extra sauce — don't skip it.",                          created_at: daysAgo(9)  },
      { restaurant_name: "Chettinad Kitchen",       items: [{ name: "Kari Dosa",           rating: 5 }, { name: "Egg Curry",         rating: 4 }], body: "Kari dosa is a dish I didn't know I needed. It's now essential.",          created_at: daysAgo(16) },
      { restaurant_name: "Pizza Roma",              items: [{ name: "Funghi Pizza",        rating: 4 }, { name: "Bruschetta",        rating: 5 }], body: "Bruschetta was perfectly acidic, fresh, and balanced.",                    created_at: daysAgo(24) },
    ],
    "Siddharth Rao": [
      { restaurant_name: "Madurai Mess",            items: [{ name: "Fish Curry",          rating: 5 }, { name: "Rasam",             rating: 5 }], body: "Fish curry that tastes like someone's grandmother made it.",               created_at: daysAgo(5)  },
      { restaurant_name: "Burger Lab",              items: [{ name: "Double Smash",        rating: 5 }, { name: "Cheese Sauce",      rating: 4 }], body: "Double smash was perfect — crispy edges, beefy inside. Cheese sauce dripped.",created_at: daysAgo(12) },
      { restaurant_name: "Murugan Idli Shop",       items: [{ name: "Mini Idli",           rating: 5 }, { name: "Ghee Podi",         rating: 5 }], body: "Mini idlis with ghee podi and sambar — this trio needs no introduction.",  created_at: daysAgo(20) },
      { restaurant_name: "Burma Burma",             items: [{ name: "Khow Suey",           rating: 4 }, { name: "Coconut Rice",      rating: 3 }], body: "Khow Suey lived up to the hype. Coconut rice was mild but grounding.",    created_at: daysAgo(27) },
    ],
    "Lakshmi Bhat": [
      { restaurant_name: "Nagi Ramen",              items: [{ name: "Vegetable Ramen",     rating: 4 }, { name: "Edamame",           rating: 3 }], body: "Good vegetarian option at a ramen spot. Broth was surprisingly deep.",     created_at: daysAgo(2)  },
      { restaurant_name: "Chettinad Kitchen",       items: [{ name: "Veg Chettinad Curry", rating: 4 }, { name: "Parotta",           rating: 4 }], body: "Even the veg curry here carries heat and complexity. Parotta was perfect.", created_at: daysAgo(8)  },
      { restaurant_name: "Dindigul Thalappakatti",  items: [{ name: "Vegetable Biryani",   rating: 3 }, { name: "Raita",             rating: 4 }], body: "Veg biryani decent but this place really shines for meat dishes.",         created_at: daysAgo(15) },
      { restaurant_name: "Shawarma Bros",           items: [{ name: "Veggie Shawarma",     rating: 4 }, { name: "Hummus",            rating: 5 }], body: "The hummus here is so smooth it's almost unfair. Veggie wrap was filling.",created_at: daysAgo(22) },
      { restaurant_name: "Pizza Roma",              items: [{ name: "Capricciosa",         rating: 4 }, { name: "Gelato",            rating: 5 }], body: "Gelato was the highlight — pistachio flavour was insane.",                 created_at: daysAgo(29) },
    ],
  };
  return (all[fullName] ?? []).map((r) => ({
    ...r,
    reviewer_name: fullName,
    area: RESTAURANT_AREA[r.restaurant_name] ?? null,
  }));
}

/* ── Seed ── */
async function seed() {
  console.log("🌱 Starting FoodCircle seed…\n");

  for (const u of USERS) {
    const fullName = `${u.firstName} ${u.lastName}`;
    process.stdout.write(`  Creating ${fullName} (${u.email})… `);

    // 1. Create auth user
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email: u.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        username: u.username,
        onboarding_complete: true,
      },
    });

    if (authErr) {
      if (authErr.message.includes("already been registered")) {
        console.log("⚠️  already exists, skipping auth");
      } else {
        console.log(`❌  auth error: ${authErr.message}`);
      }
      continue;
    }

    const userId = authData.user.id;

    // 2. Insert profile
    const { error: profileErr } = await admin.from("profiles").upsert({
      id:         userId,
      first_name: u.firstName,
      last_name:  u.lastName,
      username:   u.username,
    });

    if (profileErr) {
      console.log(`⚠️  profile: ${profileErr.message}`);
    }

    // 3. Insert reviews
    const reviews = reviewsFor(fullName);
    const { error: reviewErr } = await admin.from("reviews").insert(reviews);

    if (reviewErr) {
      console.log(`⚠️  reviews: ${reviewErr.message}`);
    } else {
      console.log(`✓  ${reviews.length} reviews`);
    }
  }

  console.log("\n✅  Seed complete!\n");
  console.log("Login with any of these accounts:");
  console.log(`  Password: ${PASSWORD}`);
  USERS.forEach((u) =>
    console.log(`  ${u.email.padEnd(32)} → ${u.firstName} ${u.lastName}`)
  );
}

seed().catch((e) => { console.error(e); process.exit(1); });
