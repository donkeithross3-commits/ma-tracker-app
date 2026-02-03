import { getKrjListsForUser } from "@/lib/krj-data";
import KrjTabsClient from "@/components/KrjTabsClient";
import { auth } from "@/auth";
import { UserMenu } from "@/components/UserMenu";

// Force dynamic rendering to ensure data is read at request time
export const dynamic = 'force-dynamic';

type RawRow = Record<string, string>;

function computeSummary(rows: RawRow[]) {
  const currentCounts: Record<string, number> = { Long: 0, Neutral: 0, Short: 0 };
  const lastCounts: Record<string, number> = { Long: 0, Neutral: 0, Short: 0 };

  for (const row of rows) {
    const cur = (row["signal"] || "").trim();
    const prev = (row["signal_status_prior_week"] || "").trim();

    if (cur && cur in currentCounts) currentCounts[cur]++;
    if (prev && prev in lastCounts) lastCounts[prev]++;
  }
  const keys = ["Long", "Neutral", "Short"] as const;

  const rowsSummary = keys.map((k) => ({
    label: k,
    current: currentCounts[k],
    last: lastCounts[k],
    delta: currentCounts[k] - lastCounts[k],
  }));

  const totals = {
    current: rowsSummary.reduce((s, r) => s + r.current, 0),
    last: rowsSummary.reduce((s, r) => s + r.last, 0),
  };

  return { rowsSummary, totals };
}

// Server component
export default async function KrjPage() {
  const session = await auth();
  const userId = session?.user?.id || null;
  
  // Fetch lists from database with user customizations applied
  const { lists, signalDate } = await getKrjListsForUser(userId);

  const columns: { key: string; label: string; description: string }[] = [
    { key: "ticker", label: "Ticker", description: "Stock or ETF symbol" },
    { key: "c", label: "Friday Close", description: `Closing price on last trading day of the week ending ${signalDate}` },
    { key: "weekly_low", label: "Last Week Low", description: `Lowest trade price during the week ending ${signalDate}` },
    { key: "25DMA", label: "25 DMA", description: "25-day simple moving average of closing prices" },
    { key: "25DMA_shifted", label: "25 DMA (shifted 3 weeks)", description: "25-day moving average as it was 15 trading days ago; used for stop-loss levels" },
    { key: "long_signal_value", label: "Long Signal Value", description: "(Weekly Low - 25DMA) / 25DMA; positive values indicate strength above the moving average" },
    { key: "short_signal_value", label: "Short Signal Value", description: "(Friday Close - 25DMA) / 25DMA; negative values indicate weakness below the moving average" },
    { key: "signal", label: "Current Week Signal", description: "Long if weekly low >= 3% above 25DMA; Short if Friday close <= 3% below 25DMA; otherwise Neutral" },
    { key: "signal_status_prior_week", label: "Last Week Signal", description: "Signal status from the prior week" },
    { key: "25DMA_range_bps", label: "Avg Daily Range (25 DMA)", description: "25-day average of daily high-low range in basis points" },
    { key: "vol_ratio", label: "Vol Ratio (to SP500)", description: "Stock's average daily range divided by SPY's daily range; measures relative volatility" },
    { key: "25D_ADV_Shares_MM", label: "ADV (25 DMA - MM Shares)", description: "25-day average daily volume in millions of shares" },
    { key: "25D_ADV_nortional_B", label: "ADV (25 DMA - $B)", description: "25-day average daily notional volume in billions of dollars" },
    { key: "avg_trade_size", label: "Average Trade Size", description: "Average number of shares per trade (volume / number of trades)" },
  ];

  // Transform lists to the format expected by KrjTabsClient
  const groupsData = lists.map(list => ({
    key: list.key,
    label: list.name,
    rows: list.rows,
    summary: computeSummary(list.rows),
    // Extended metadata for UI features
    listId: list.id,
    ownerId: list.ownerId,
    ownerAlias: list.ownerAlias,
    isSystem: list.isSystem,
    isEditable: list.isEditable,
    canEdit: list.canEdit,
    isFork: list.isFork,
    forkDelta: list.forkDelta,
    tickerCount: list.tickers.length,
  }));

  return (
    <div className="p-3 bg-gray-950 text-gray-100 min-h-screen">
      <div className="flex justify-between items-center mb-2 no-print">
        <div>
          <h1 className="text-3xl font-semibold text-gray-100">
            KRJ Weekly Signals
            <span className="text-xl text-gray-400 ml-3 font-normal">
              {signalDate}
            </span>
          </h1>
        </div>
        <UserMenu 
          variant="dark" 
          initialUser={session?.user ? { 
            name: session.user.name, 
            email: session.user.email,
            alias: session.user.alias 
          } : undefined}
        />
      </div>

      <KrjTabsClient 
        groups={groupsData} 
        columns={columns}
        userId={userId}
        userAlias={session?.user?.alias}
      />
    </div>
  );
}
