import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <span className="text-5xl">🍕</span>
      <h2 className="text-xl font-bold text-gray-800">Page not found</h2>
      <p className="text-sm text-gray-500">
        This page doesn&apos;t exist or was removed.
      </p>
      <Link
        href="/"
        className="bg-orange-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-orange-600 transition-colors"
      >
        Back to Feed
      </Link>
    </div>
  );
}
