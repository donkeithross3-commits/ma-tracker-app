"use client";

export default function DealDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
      <div className="max-w-xl text-center space-y-4">
        <h2 className="text-xl font-bold text-red-400">Deal Page Error</h2>
        <pre className="text-left text-xs text-gray-400 bg-gray-900 p-4 rounded overflow-auto max-h-60 whitespace-pre-wrap">
          {error.message}
          {"\n\n"}
          {error.stack}
        </pre>
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
