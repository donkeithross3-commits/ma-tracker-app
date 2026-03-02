"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, Check, X, ChevronDown } from "lucide-react";
import {
  isFuturesTicker,
  parseFuturesContract,
  getExchangeForSymbol,
} from "./futures-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WatchlistSummary {
  id: string;
  name: string;
  itemCount: number;
}

interface WatchlistManagerProps {
  lists: WatchlistSummary[];
  selectedListId: string | null;
  onSelectList: (id: string) => void;
  onCreateList: (name: string) => void;
  onRenameList: (id: string, name: string) => void;
  onDeleteList: (id: string) => void;
  onAddTicker: (
    ticker: string,
    instrumentType: string,
    displayName?: string,
    exchange?: string
  ) => void;
}

// ---------------------------------------------------------------------------
// Ticker autocomplete types
// ---------------------------------------------------------------------------

interface TickerMatch {
  ticker: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Instrument types + exchange presets
// ---------------------------------------------------------------------------

const INSTRUMENT_TYPES = [
  { value: "stock", label: "Stock" },
  { value: "index", label: "Index" },
  { value: "future", label: "Future" },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WatchlistManager({
  lists,
  selectedListId,
  onSelectList,
  onCreateList,
  onRenameList,
  onDeleteList,
  onAddTicker,
}: WatchlistManagerProps) {
  // --- New list state ---
  const [isCreating, setIsCreating] = useState(false);
  const [newListName, setNewListName] = useState("");
  const newListRef = useRef<HTMLInputElement>(null);

  // --- Rename state ---
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  // --- Add ticker state ---
  const [tickerInput, setTickerInput] = useState("");
  const [instrumentType, setInstrumentType] = useState("stock");
  const [suggestions, setSuggestions] = useState<TickerMatch[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [searching, setSearching] = useState(false);
  const tickerRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Focus new list input when creating
  useEffect(() => {
    if (isCreating && newListRef.current) newListRef.current.focus();
  }, [isCreating]);

  // Focus rename input
  useEffect(() => {
    if (isRenaming && renameRef.current) renameRef.current.focus();
  }, [isRenaming]);

  // Close suggestions on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        tickerRef.current &&
        !tickerRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // --- Ticker search (SEC EDGAR autocomplete) ---
  const searchTicker = useCallback(async (query: string) => {
    if (query.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setSearching(true);
    try {
      const resp = await fetch(
        `/api/ticker-lookup?q=${encodeURIComponent(query)}`
      );
      if (resp.ok) {
        const data = await resp.json();
        setSuggestions(data.matches || []);
        setShowSuggestions(true);
        setHighlightIdx(-1);
      }
    } catch {
      // ignore
    } finally {
      setSearching(false);
    }
  }, []);

  const handleTickerInputChange = useCallback(
    (value: string) => {
      setTickerInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // Only use SEC EDGAR autocomplete for stocks — futures/index accept raw ticker
      if (instrumentType === "stock") {
        debounceRef.current = setTimeout(() => searchTicker(value), 300);
      } else {
        // Clear any stale suggestions from a previous stock search
        setSuggestions([]);
        setShowSuggestions(false);
      }
    },
    [searchTicker, instrumentType]
  );

  // Resolve instrument type + exchange for a ticker, auto-detecting futures
  const resolveTickerMeta = useCallback(
    (ticker: string): { type: string; exchange?: string } => {
      // If user explicitly selected "future", or ticker is a known future
      if (instrumentType === "future" || isFuturesTicker(ticker)) {
        const parsed = parseFuturesContract(ticker);
        const base = parsed ? parsed.base : ticker;
        return { type: "future", exchange: getExchangeForSymbol(base) };
      }
      return { type: instrumentType };
    },
    [instrumentType],
  );

  const selectSuggestion = useCallback(
    (match: TickerMatch) => {
      setTickerInput(match.ticker);
      setShowSuggestions(false);
      const meta = resolveTickerMeta(match.ticker);
      onAddTicker(match.ticker, meta.type, match.name, meta.exchange);
      setTickerInput("");
      setSuggestions([]);
    },
    [resolveTickerMeta, onAddTicker],
  );

  const handleTickerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showSuggestions || suggestions.length === 0) {
        if (e.key === "Enter" && tickerInput.trim()) {
          e.preventDefault();
          const ticker = tickerInput.trim().toUpperCase();
          const meta = resolveTickerMeta(ticker);
          onAddTicker(ticker, meta.type, undefined, meta.exchange);
          setTickerInput("");
          setSuggestions([]);
          setShowSuggestions(false);
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightIdx >= 0 && highlightIdx < suggestions.length) {
          selectSuggestion(suggestions[highlightIdx]);
        } else if (tickerInput.trim()) {
          const ticker = tickerInput.trim().toUpperCase();
          const meta = resolveTickerMeta(ticker);
          onAddTicker(ticker, meta.type, undefined, meta.exchange);
          setTickerInput("");
          setSuggestions([]);
          setShowSuggestions(false);
        }
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
      }
    },
    [
      showSuggestions,
      suggestions,
      highlightIdx,
      tickerInput,
      resolveTickerMeta,
      onAddTicker,
      selectSuggestion,
    ],
  );

  // --- Handlers ---
  const handleCreateSubmit = () => {
    const name = newListName.trim();
    if (name) {
      onCreateList(name);
      setNewListName("");
      setIsCreating(false);
    }
  };

  const handleRenameSubmit = () => {
    const name = renameName.trim();
    if (name && selectedListId) {
      onRenameList(selectedListId, name);
      setRenameName("");
      setIsRenaming(false);
    }
  };

  const selectedList = lists.find((l) => l.id === selectedListId);

  return (
    <div className="flex items-center gap-2 flex-wrap mb-2">
      {/* List selector */}
      <div className="relative">
        <select
          value={selectedListId || ""}
          onChange={(e) => e.target.value && onSelectList(e.target.value)}
          className="appearance-none bg-gray-800 text-gray-100 border border-gray-700 rounded px-3 py-1.5 pr-7 text-sm focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          {lists.length === 0 && (
            <option value="">No watchlists</option>
          )}
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.itemCount})
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
      </div>

      {/* New list */}
      {isCreating ? (
        <div className="flex items-center gap-1">
          <input
            ref={newListRef}
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateSubmit();
              if (e.key === "Escape") setIsCreating(false);
            }}
            placeholder="List name..."
            className="bg-gray-800 text-gray-100 border border-gray-600 rounded px-2 py-1 text-sm w-32 focus:outline-none focus:border-blue-500 inline-edit"
          />
          <button
            onClick={handleCreateSubmit}
            className="p-1 text-green-400 hover:text-green-300"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setIsCreating(false)}
            className="p-1 text-gray-500 hover:text-gray-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-400 hover:text-gray-100 border border-gray-700 hover:border-gray-600 rounded transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New List
        </button>
      )}

      {/* Rename / Delete for current list */}
      {selectedList && !isRenaming && (
        <>
          <button
            onClick={() => {
              setRenameName(selectedList.name);
              setIsRenaming(true);
            }}
            className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
            title="Rename list"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              if (confirm(`Delete "${selectedList.name}"?`)) {
                onDeleteList(selectedList.id);
              }
            }}
            className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"
            title="Delete list"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}

      {isRenaming && (
        <div className="flex items-center gap-1">
          <input
            ref={renameRef}
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
              if (e.key === "Escape") setIsRenaming(false);
            }}
            className="bg-gray-800 text-gray-100 border border-gray-600 rounded px-2 py-1 text-sm w-32 focus:outline-none focus:border-blue-500 inline-edit"
          />
          <button
            onClick={handleRenameSubmit}
            className="p-1 text-green-400 hover:text-green-300"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setIsRenaming(false)}
            className="p-1 text-gray-500 hover:text-gray-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Divider */}
      {selectedList && (
        <div className="w-px h-5 bg-gray-700 mx-1" />
      )}

      {/* Add ticker input with autocomplete */}
      {selectedList && (
        <div className="flex items-center gap-1.5 relative">
          {/* Instrument type */}
          <select
            value={instrumentType}
            onChange={(e) => {
              setInstrumentType(e.target.value);
              // Clear autocomplete when switching away from stock
              if (e.target.value !== "stock") {
                setSuggestions([]);
                setShowSuggestions(false);
              }
            }}
            className="appearance-none bg-gray-800 text-gray-300 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            {INSTRUMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          {/* Ticker input */}
          <div className="relative">
            <input
              ref={tickerRef}
              value={tickerInput}
              onChange={(e) => handleTickerInputChange(e.target.value.toUpperCase())}
              onKeyDown={handleTickerKeyDown}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggestions(true);
              }}
              placeholder={instrumentType === "stock" ? "Add ticker..." : instrumentType === "future" ? "e.g. ES, SIK6, CLJ6..." : "e.g. SPX, VIX..."}
              className="bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1.5 text-sm w-28 focus:outline-none focus:border-blue-500 inline-edit"
            />
            {searching && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <div className="h-3 w-3 border-2 border-gray-500 border-t-blue-400 rounded-full animate-spin" />
              </div>
            )}

            {/* Suggestions dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute top-full left-0 mt-1 w-64 bg-gray-800 border border-gray-700 rounded shadow-xl z-50 max-h-48 overflow-y-auto"
              >
                {suggestions.map((match, idx) => (
                  <button
                    key={match.ticker}
                    onClick={() => selectSuggestion(match)}
                    className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm hover:bg-gray-700 transition-colors ${
                      idx === highlightIdx ? "bg-gray-700" : ""
                    }`}
                  >
                    <span className="font-mono text-blue-400 font-medium w-12 shrink-0">
                      {match.ticker}
                    </span>
                    <span className="text-gray-400 truncate text-xs">
                      {match.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
