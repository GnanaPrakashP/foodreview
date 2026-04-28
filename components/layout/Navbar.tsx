import Link from "next/link";

export default function Navbar() {
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-sm border-b border-gray-100">
      <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl">🍽️</span>
          <span className="font-bold text-gray-900 text-lg">FoodReview</span>
        </Link>

        <Link
          href="/reviews/new"
          className="bg-orange-500 text-white text-sm font-semibold px-3 py-1.5 rounded-xl hover:bg-orange-600 transition-colors"
        >
          + Review
        </Link>
      </div>
    </header>
  );
}
