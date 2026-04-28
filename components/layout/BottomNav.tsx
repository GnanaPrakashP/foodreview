"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-100 pb-safe">
      <div className="max-w-lg mx-auto flex items-center justify-around h-16">
        <Link
          href="/"
          className={`flex flex-col items-center gap-0.5 px-5 py-1 rounded-xl transition-colors ${
            pathname === "/" ? "text-orange-500" : "text-gray-400 hover:text-gray-600"
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            />
          </svg>
          <span className="text-xs font-medium">Feed</span>
        </Link>

        <Link
          href="/reviews/new"
          className="flex items-center justify-center w-12 h-12 bg-orange-500 rounded-2xl text-white shadow-lg hover:bg-orange-600 active:bg-orange-700 transition-colors"
          aria-label="Post a review"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M12 4v16m8-8H4"
            />
          </svg>
        </Link>

        {/* Spacer to keep the + button centered */}
        <div className="w-16" />
      </div>
    </nav>
  );
}
