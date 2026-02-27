"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface TickerMatch {
  ticker: string;
  name: string;
}

interface InlineAddTickerProps {
  /** Called when user selects a ticker from autocomplete */
  onAdd: (ticker: string, name: string) => void;
  /** Existing tickers to prevent duplicates */
  existingTickers?: Set<string>;
}

export default function InlineAddTicker({ onAdd, existingTickers }: InlineAddTickerProps) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<TickerMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounced SEC EDGAR lookup
  const doSearch = useCallback(async (q: string) => {
    if (q.length < 1) {
      setMatches([]);
      setShowDropdown(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ticker-lookup?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setMatches(data.matches || []);
        setShowDropdown(true);
        setHighlightIdx(-1);
      }
    } catch {
      setError("Lookup failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setQuery(val);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  };

  const handleSelect = (match: TickerMatch) => {
    if (existingTickers?.has(match.ticker.toUpperCase())) {
      setError(`${match.ticker} already in list`);
      setShowDropdown(false);
      return;
    }
    onAdd(match.ticker, match.name);
    setQuery("");
    setMatches([]);
    setShowDropdown(false);
    setError(null);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((prev) => Math.min(prev + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && highlightIdx >= 0) {
      e.preventDefault();
      handleSelect(matches[highlightIdx]);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (matches.length > 0) setShowDropdown(true); }}
          placeholder="Add ticker..."
          className="w-40 px-2 py-1.5 text-sm bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
        />
        {loading && (
          <span className="text-xs text-gray-500 animate-pulse">...</span>
        )}
        {error && (
          <span className="text-xs text-red-400">{error}</span>
        )}
      </div>

      {showDropdown && matches.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-20 mt-1 w-72 max-h-48 overflow-y-auto bg-gray-900 border border-gray-700 rounded shadow-lg"
        >
          {matches.map((m, i) => (
            <button
              key={m.ticker}
              type="button"
              className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm hover:bg-gray-800 ${
                i === highlightIdx ? "bg-gray-800" : ""
              }`}
              onClick={() => handleSelect(m)}
              onMouseEnter={() => setHighlightIdx(i)}
            >
              <span className="font-mono text-blue-400 font-semibold w-12">
                {m.ticker}
              </span>
              <span className="text-gray-400 truncate">{m.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
