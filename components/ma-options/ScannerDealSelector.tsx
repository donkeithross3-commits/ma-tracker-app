"use client";

import { useState } from "react";
import type { ScannerDeal } from "@/types/ma-options";

interface ScannerDealSelectorProps {
  deals: ScannerDeal[];
  selectedDeal: ScannerDeal | null;
  onSelectDeal: (deal: ScannerDeal) => void;
  onDealUpdated: (deal: ScannerDeal) => void;
  onDealDeleted: (dealId: string) => void;
}

export default function ScannerDealSelector({
  deals,
  selectedDeal,
  onSelectDeal,
  onDealUpdated,
  onDealDeleted,
}: ScannerDealSelectorProps) {
  const [filter, setFilter] = useState("");
  const [hideNoOptions, setHideNoOptions] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    expectedClosePrice: "",
    expectedCloseDate: "",
    targetName: "",
    notes: "",
  });
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const filteredDeals = deals.filter((deal) => {
    const matchesText =
      deal.ticker.toLowerCase().includes(filter.toLowerCase()) ||
      (deal.targetName?.toLowerCase().includes(filter.toLowerCase()) ?? false);
    const matchesOptionsFilter = hideNoOptions ? !deal.noOptionsAvailable : true;
    return matchesText && matchesOptionsFilter;
  });

  const noOptionsCount = deals.filter((d) => d.noOptionsAvailable).length;
  
  // Debug: log noOptionsAvailable status
  console.log("[ScannerDealSelector] Deals with noOptionsAvailable:", 
    deals.filter(d => d.noOptionsAvailable).map(d => d.ticker),
    "Total noOptionsCount:", noOptionsCount
  );

  const startEditing = (deal: ScannerDeal) => {
    setEditingId(deal.id);
    setEditForm({
      expectedClosePrice: deal.expectedClosePrice.toString(),
      expectedCloseDate: deal.expectedCloseDate,
      targetName: deal.targetName || "",
      notes: deal.notes || "",
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm({
      expectedClosePrice: "",
      expectedCloseDate: "",
      targetName: "",
      notes: "",
    });
  };

  const saveEdit = async (dealId: string) => {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/scanner-deals/${dealId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedClosePrice: parseFloat(editForm.expectedClosePrice),
          expectedCloseDate: editForm.expectedCloseDate,
          targetName: editForm.targetName || null,
          notes: editForm.notes || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update deal");
      }

      const data = await response.json();
      onDealUpdated(data.deal);
      setEditingId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update deal");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteDeal = async (dealId: string) => {
    if (!confirm("Are you sure you want to delete this deal?")) {
      return;
    }

    setIsDeleting(dealId);
    try {
      const response = await fetch(`/api/scanner-deals/${dealId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete deal");
      }

      onDealDeleted(dealId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete deal");
    } finally {
      setIsDeleting(null);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-700 rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-100">Select Deal</h2>
        <div className="text-xs text-gray-400">
          {filteredDeals.length} deal{filteredDeals.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Filter Input */}
      <input
        type="text"
        placeholder="Filter by ticker or name..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-gray-100 text-sm mb-3"
      />

      {/* Toggle Filters */}
      {noOptionsCount > 0 && (
        <div className="mb-3 pb-3 border-b border-gray-700">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300 hover:text-gray-100 select-none">
            <input
              type="checkbox"
              checked={hideNoOptions}
              onChange={(e) => setHideNoOptions(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
            />
            <span>Hide tickers with no options</span>
            <span className="text-xs text-orange-400 px-2 py-0.5 bg-orange-900/30 border border-orange-700 rounded">
              {noOptionsCount}
            </span>
          </label>
        </div>
      )}

      {/* Deals Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left py-2 px-2 text-gray-400 font-medium">
                Ticker
              </th>
              <th className="text-left py-2 px-2 text-gray-400 font-medium">
                Target Name
              </th>
              <th className="text-right py-2 px-2 text-gray-400 font-medium">
                Deal Price
              </th>
              <th className="text-right py-2 px-2 text-gray-400 font-medium">
                Close Date
              </th>
              <th className="text-right py-2 px-2 text-gray-400 font-medium">
                Days
              </th>
              <th className="text-center py-2 px-2 text-gray-400 font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredDeals.map((deal) => (
              <tr
                key={deal.id}
                className={`border-b border-gray-800 hover:bg-gray-800 ${
                  selectedDeal?.id === deal.id ? "bg-gray-800" : ""
                } ${deal.noOptionsAvailable ? "opacity-60" : ""}`}
              >
                {editingId === deal.id ? (
                  // Edit mode
                  <>
                    <td className="py-2 px-2 text-gray-100 font-mono">
                      {deal.ticker}
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="text"
                        value={editForm.targetName}
                        onChange={(e) =>
                          setEditForm({ ...editForm, targetName: e.target.value })
                        }
                        className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-gray-100 text-xs"
                        placeholder="Target name"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        step="0.01"
                        value={editForm.expectedClosePrice}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            expectedClosePrice: e.target.value,
                          })
                        }
                        className="w-24 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-gray-100 text-xs text-right"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="date"
                        value={editForm.expectedCloseDate}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            expectedCloseDate: e.target.value,
                          })
                        }
                        className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-gray-100 text-xs"
                      />
                    </td>
                    <td className="py-2 px-2 text-right text-gray-500">—</td>
                    <td className="py-2 px-2 text-center">
                      <div className="flex justify-center gap-1">
                        <button
                          onClick={() => saveEdit(deal.id)}
                          disabled={isSaving}
                          className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded disabled:opacity-50"
                        >
                          {isSaving ? "..." : "Save"}
                        </button>
                        <button
                          onClick={cancelEditing}
                          disabled={isSaving}
                          className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </>
                ) : (
                  // View mode
                  <>
                    <td className="py-2 px-2 text-gray-100 font-mono">
                      <div className="flex items-center gap-2">
                        {deal.ticker}
                        {deal.noOptionsAvailable && (
                          <span
                            className="text-xs text-orange-400 border border-orange-400 px-1 rounded"
                            title={`No options found${
                              deal.lastOptionsCheck
                                ? ` (checked ${new Date(
                                    deal.lastOptionsCheck
                                  ).toLocaleDateString()})`
                                : ""
                            }`}
                          >
                            No Options
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-gray-300">
                      {deal.targetName || "—"}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-100 font-mono">
                      ${deal.expectedClosePrice.toFixed(2)}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-300 font-mono text-xs">
                      {deal.expectedCloseDate}
                    </td>
                    <td
                      className={`py-2 px-2 text-right font-mono ${
                        deal.daysToClose < 0
                          ? "text-red-400"
                          : deal.daysToClose < 30
                          ? "text-yellow-400"
                          : "text-gray-100"
                      }`}
                    >
                      {deal.daysToClose}
                    </td>
                    <td className="py-2 px-2 text-center">
                      <div className="flex justify-center gap-1">
                        <button
                          onClick={() => onSelectDeal(deal)}
                          className={`px-2 py-1 text-xs rounded ${
                            selectedDeal?.id === deal.id
                              ? "bg-blue-700 text-white"
                              : "bg-blue-600 hover:bg-blue-700 text-white"
                          }`}
                        >
                          {selectedDeal?.id === deal.id ? "Selected" : "Select"}
                        </button>
                        <button
                          onClick={() => startEditing(deal)}
                          className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded"
                          title="Edit deal parameters"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteDeal(deal.id)}
                          disabled={isDeleting === deal.id}
                          className="px-2 py-1 bg-red-600/80 hover:bg-red-600 text-white text-xs rounded disabled:opacity-50"
                          title="Delete deal"
                        >
                          {isDeleting === deal.id ? "..." : "×"}
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {filteredDeals.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">
            {deals.length === 0
              ? "No deals added yet. Click 'Add New Deal' above to get started."
              : "No deals match your filter."}
          </div>
        )}
      </div>
    </div>
  );
}
