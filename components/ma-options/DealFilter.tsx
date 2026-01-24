"use client";

interface Deal {
  id: string;
  ticker: string;
  name: string;
}

interface DealFilterProps {
  deals: Deal[];
  selectedDealId: string | null;
  onSelectDeal: (dealId: string | null) => void;
}

export default function DealFilter({
  deals,
  selectedDealId,
  onSelectDeal,
}: DealFilterProps) {
  return (
    <div className="bg-gray-900 border border-gray-700 rounded p-4">
      <label className="block text-sm font-medium text-gray-400 mb-2">
        Filter by Deal
      </label>
      <select
        value={selectedDealId || ""}
        onChange={(e) => onSelectDeal(e.target.value || null)}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-gray-100 text-sm"
      >
        <option value="">All Deals</option>
        {deals.map((deal) => (
          <option key={deal.id} value={deal.id}>
            {deal.ticker} - {deal.name}
          </option>
        ))}
      </select>
    </div>
  );
}

