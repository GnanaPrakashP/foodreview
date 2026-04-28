export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-7 w-40 bg-gray-200 rounded-lg animate-pulse" />
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
        >
          <div className="h-48 bg-gray-200 animate-pulse" />
          <div className="p-4 flex flex-col gap-3">
            <div className="h-5 w-3/4 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-1/2 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-1/4 bg-gray-200 rounded animate-pulse" />
            <div className="h-16 w-full bg-gray-100 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
