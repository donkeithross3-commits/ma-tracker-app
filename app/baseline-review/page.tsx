"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";

export default function BaselineReviewPage() {
  const [view, setView] = useState<"flagged" | "index">("flagged");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`/api/sheet-portfolio/baseline-review?view=${view}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.text();
      })
      .then((html) => {
        setHtmlContent(html);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [view]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1800px] mx-auto px-3 py-2 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">AI Baseline Review</h1>
            <p className="text-xs text-gray-500">
              Opus + Sonnet multi-model comparison
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex border border-gray-700 rounded overflow-hidden">
              <button
                onClick={() => setView("flagged")}
                className={`px-3 py-1.5 text-xs transition-colors ${
                  view === "flagged"
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-gray-200"
                }`}
              >
                Flagged Deals
              </button>
              <button
                onClick={() => setView("index")}
                className={`px-3 py-1.5 text-xs transition-colors ${
                  view === "index"
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-gray-200"
                }`}
              >
                Full Index
              </button>
            </div>
            <Link
              href="/sheet-portfolio"
              className="px-3 py-1.5 text-xs border border-gray-700 rounded hover:bg-gray-800 transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/"
              className="px-3 py-1.5 text-xs border border-gray-700 rounded hover:bg-gray-800 transition-colors"
            >
              Home
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 z-5">
            <span className="text-gray-400 text-sm">Loading review...</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 z-5">
            <span className="text-red-400 text-sm">Failed to load: {error}</span>
          </div>
        )}
        <iframe
          ref={iframeRef}
          srcDoc={htmlContent}
          className="w-full h-[calc(100vh-48px)] border-0"
        />
      </main>
    </div>
  );
}
