import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://nxwfftwkwgvxsnwqeuuh.supabase.co",
  "sb_publishable_CDmK2iR0zOQuluqQJ42pQw__ymRy_Cs"
);

// Helpers
function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

const reviews = [
  // ── Gnana ──────────────────────────────────────────
  {
    reviewer_name: "Gnana",
    restaurant_name: "Murugan Idli Shop",
    items: [{ name: "Idli", rating: 5 }, { name: "Sambar", rating: 5 }],
    body: "Softest idlis in the city. The sambar hits different here.",
    created_at: daysAgo(2),
  },
  {
    reviewer_name: "Gnana",
    restaurant_name: "Nagi Ramen",
    items: [{ name: "Tonkotsu Ramen", rating: 4 }, { name: "Gyoza", rating: 4 }],
    body: "Rich broth, perfectly cooked noodles. The gyoza was crispy.",
    created_at: daysAgo(10),
  },
  {
    reviewer_name: "Gnana",
    restaurant_name: "Dindigul Thalappakatti",
    items: [{ name: "Dindigul Biryani", rating: 5 }, { name: "Raita", rating: 3 }],
    body: "Nothing beats Thalappakatti biryani. The meat falls off the bone.",
    created_at: daysAgo(18),
  },
  {
    reviewer_name: "Gnana",
    restaurant_name: "Burger Lab",
    items: [{ name: "Smash Burger", rating: 4 }, { name: "Fries", rating: 3 }],
    body: "Crispy edges on the patty, solid smash burger spot.",
    created_at: daysAgo(25),
  },

  // ── Priya ──────────────────────────────────────────
  {
    reviewer_name: "Priya",
    restaurant_name: "Burma Burma",
    items: [{ name: "Khow Suey", rating: 5 }, { name: "Tea Leaf Salad", rating: 5 }],
    body: "The Khow Suey is an absolute experience. Come hungry.",
    created_at: daysAgo(1),
  },
  {
    reviewer_name: "Priya",
    restaurant_name: "Murugan Idli Shop",
    items: [{ name: "Dosa", rating: 4 }, { name: "Chutney", rating: 5 }],
    body: "The coconut chutney alone is worth the trip.",
    created_at: daysAgo(5),
  },
  {
    reviewer_name: "Priya",
    restaurant_name: "Nagi Ramen",
    items: [{ name: "Spicy Ramen", rating: 5 }, { name: "Karaage", rating: 4 }],
    body: "Best ramen in the city by a mile. Spice level is no joke.",
    created_at: daysAgo(12),
  },
  {
    reviewer_name: "Priya",
    restaurant_name: "Chettinad Kitchen",
    items: [{ name: "Chettinad Chicken Curry", rating: 5 }, { name: "Appam", rating: 4 }],
    body: "Authentic Chettinad flavours, bold and spicy. Appam was perfect.",
    created_at: daysAgo(20),
  },

  // ── Arjun ──────────────────────────────────────────
  {
    reviewer_name: "Arjun",
    restaurant_name: "Burma Burma",
    items: [{ name: "Mohinga", rating: 5 }, { name: "Khow Suey", rating: 4 }],
    body: "Mohinga is underrated. The lemongrass broth is so clean.",
    created_at: daysAgo(3),
  },
  {
    reviewer_name: "Arjun",
    restaurant_name: "Dindigul Thalappakatti",
    items: [{ name: "Dindigul Biryani", rating: 5 }, { name: "Mutton Pepper Fry", rating: 5 }],
    body: "Mutton pepper fry with biryani — this is the combo.",
    created_at: daysAgo(7),
  },
  {
    reviewer_name: "Arjun",
    restaurant_name: "Chettinad Kitchen",
    items: [{ name: "Kavuni Arisi", rating: 5 }, { name: "Kothu Parotta", rating: 4 }],
    body: "Kavuni arisi is an underrated dessert. Kothu parotta was loud and perfect.",
    created_at: daysAgo(14),
  },
  {
    reviewer_name: "Arjun",
    restaurant_name: "Pizza Roma",
    items: [{ name: "Margherita", rating: 3 }, { name: "Tiramisu", rating: 4 }],
    body: "Pizza was decent, tiramisu was the real winner.",
    created_at: daysAgo(22),
  },

  // ── Meera ──────────────────────────────────────────
  {
    reviewer_name: "Meera",
    restaurant_name: "Burma Burma",
    items: [{ name: "Khow Suey", rating: 5 }, { name: "Shan Noodles", rating: 4 }],
    body: "I dream about this Khow Suey. Nothing like it.",
    created_at: daysAgo(4),
  },
  {
    reviewer_name: "Meera",
    restaurant_name: "Shawarma Bros",
    items: [{ name: "Chicken Shawarma", rating: 5 }, { name: "Hummus", rating: 4 }],
    body: "Garlic sauce on the shawarma is elite. Best quick bite.",
    created_at: daysAgo(9),
  },
  {
    reviewer_name: "Meera",
    restaurant_name: "Nagi Ramen",
    items: [{ name: "Tonkotsu Ramen", rating: 4 }],
    body: "Rich and warming. Would come back on a rainy day.",
    created_at: daysAgo(16),
  },
  {
    reviewer_name: "Meera",
    restaurant_name: "Murugan Idli Shop",
    items: [{ name: "Rava Idli", rating: 4 }, { name: "Filter Coffee", rating: 5 }],
    body: "Filter coffee here is the standard everything else is judged against.",
    created_at: daysAgo(28),
  },

  // ── Ravi ───────────────────────────────────────────
  {
    reviewer_name: "Ravi",
    restaurant_name: "Madurai Mess",
    items: [{ name: "Mutton Kuzhambu", rating: 5 }, { name: "Parotta", rating: 5 }],
    body: "Old school Madurai mess energy. Mutton kuzhambu will ruin you for all others.",
    created_at: daysAgo(6),
  },
  {
    reviewer_name: "Ravi",
    restaurant_name: "Dindigul Thalappakatti",
    items: [{ name: "Dindigul Biryani", rating: 4 }, { name: "Salna", rating: 5 }],
    body: "Salna is the secret weapon here. Order it with biryani.",
    created_at: daysAgo(11),
  },
  {
    reviewer_name: "Ravi",
    restaurant_name: "Shawarma Bros",
    items: [{ name: "Beef Shawarma", rating: 5 }, { name: "Falafel", rating: 4 }],
    body: "Beef shawarma with extra sauce — don't skip it.",
    created_at: daysAgo(19),
  },
  {
    reviewer_name: "Ravi",
    restaurant_name: "Chettinad Kitchen",
    items: [{ name: "Chettinad Mutton Curry", rating: 5 }],
    body: "Every spice earns its place in this curry. Respect.",
    created_at: daysAgo(29),
  },

  // ── Divya ──────────────────────────────────────────
  {
    reviewer_name: "Divya",
    restaurant_name: "Burger Lab",
    items: [{ name: "Double Smash", rating: 5 }, { name: "Truffle Fries", rating: 5 }],
    body: "Double smash with truffle fries — this is what weekends are for.",
    created_at: daysAgo(2),
  },
  {
    reviewer_name: "Divya",
    restaurant_name: "Pizza Roma",
    items: [{ name: "Burrata Pizza", rating: 5 }, { name: "Arancini", rating: 4 }],
    body: "Burrata pizza changed my life. The arancini are a must-order.",
    created_at: daysAgo(8),
  },
  {
    reviewer_name: "Divya",
    restaurant_name: "Madurai Mess",
    items: [{ name: "Chicken Kuzhambu", rating: 4 }, { name: "Rice", rating: 3 }],
    body: "Solid comfort food. Nothing fancy but deeply satisfying.",
    created_at: daysAgo(15),
  },
  {
    reviewer_name: "Divya",
    restaurant_name: "Shawarma Bros",
    items: [{ name: "Chicken Shawarma", rating: 4 }, { name: "Pita", rating: 3 }],
    body: "Quick, satisfying, and the garlic sauce makes it.",
    created_at: daysAgo(24),
  },
];

async function seed() {
  console.log(`Seeding ${reviews.length} reviews…`);

  const { data, error } = await supabase.from("reviews").insert(reviews).select("id");

  if (error) {
    console.error("Error inserting reviews:", error.message);
    process.exit(1);
  }

  console.log(`✓ Inserted ${data.length} reviews successfully.`);
  console.log("\nReviewers seeded:");
  const names = [...new Set(reviews.map((r) => r.reviewer_name))];
  names.forEach((n) => {
    const count = reviews.filter((r) => r.reviewer_name === n).length;
    console.log(`  ${n} — ${count} reviews`);
  });
  console.log("\nRestaurants:");
  const restaurants = [...new Set(reviews.map((r) => r.restaurant_name))];
  restaurants.forEach((r) => console.log(`  ${r}`));
}

seed();
