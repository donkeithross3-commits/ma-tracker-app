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
    <div className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded px-3 py-1.5">
      <label className="text-sm font-medium text-gray-400 whitespace-nowrap">
        Filter:
      </label>
      <select
        value={selectedDealId || ""}
        onChange={(e) => onSelectDeal(e.target.value || null)}
        className="flex-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-gray-100 text-sm"
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

