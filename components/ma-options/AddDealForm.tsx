"use client";

import { useState } from "react";
import type { ScannerDeal } from "@/types/ma-options";

interface AddDealFormProps {
  onDealAdded: (deal: ScannerDeal) => void;
}

export default function AddDealForm({ onDealAdded }: AddDealFormProps) {
  const [ticker, setTicker] = useState("");
  const [targetName, setTargetName] = useState("");
  const [expectedClosePrice, setExpectedClosePrice] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!ticker.trim()) {
      setError("Ticker is required");
      return;
    }
    if (!expectedClosePrice || parseFloat(expectedClosePrice) <= 0) {
      setError("Expected close price must be greater than 0");
      return;
    }
    if (!expectedCloseDate) {
      setError("Expected close date is required");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/scanner-deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: ticker.trim().toUpperCase(),
          targetName: targetName.trim() || null,
          expectedClosePrice: parseFloat(expectedClosePrice),
          expectedCloseDate,
          notes: notes.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to add deal");
      }

      // Clear form
      setTicker("");
      setTargetName("");
      setExpectedClosePrice("");
      setExpectedCloseDate("");
      setNotes("");
      setIsExpanded(false);

      // Notify parent
      onDealAdded(data.deal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add deal");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="w-full px-4 py-3 bg-gray-800 border border-gray-700 border-dashed rounded hover:border-blue-500 hover:bg-gray-800/80 text-gray-400 hover:text-blue-400 transition-colors flex items-center justify-center gap-2"
      >
        <span className="text-xl">+</span>
        <span>Add New Deal</span>
      </button>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-100">Add New Deal</h3>
        <button
          onClick={() => setIsExpanded(false)}
          className="text-gray-500 hover:text-gray-300 text-xl"
          title="Cancel"
        >
          ×
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Ticker */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Ticker <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="AAPL"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-gray-100 text-sm focus:border-blue-500 focus:outline-none"
              disabled={isSubmitting}
            />
          </div>

          {/* Target Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Target Name
            </label>
            <input
              type="text"
              value={targetName}
              onChange={(e) => setTargetName(e.target.value)}
              placeholder="Apple Inc."
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-gray-100 text-sm focus:border-blue-500 focus:outline-none"
              disabled={isSubmitting}
            />
          </div>

          {/* Expected Close Price */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Expected Close Price <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                $
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={expectedClosePrice}
                onChange={(e) => setExpectedClosePrice(e.target.value)}
                placeholder="150.00"
                className="w-full pl-7 pr-3 py-2 bg-gray-800 border border-gray-600 rounded text-gray-100 text-sm focus:border-blue-500 focus:outline-none"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Expected Close Date */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Expected Close Date <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              value={expectedCloseDate}
              onChange={(e) => setExpectedCloseDate(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-gray-100 text-sm focus:border-blue-500 focus:outline-none"
              disabled={isSubmitting}
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Notes</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes about this deal..."
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-gray-100 text-sm focus:border-blue-500 focus:outline-none"
            disabled={isSubmitting}
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Adding..." : "Add Deal"}
          </button>
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            disabled={isSubmitting}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
