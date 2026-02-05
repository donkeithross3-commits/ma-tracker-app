"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useIBConnection } from "./IBConnectionContext";

/** Hardcoded account aliases for KRJ (display only; filtering still uses raw account id). */
const KRJ_ACCOUNT_ALIASES: Record<string, string> = {
  U127613: "Personal",
  U22621569: "Event Driven",
};

function getAccountLabel(accountId: string, userAlias?: string | null): string {
  if (userAlias === "KRJ" && KRJ_ACCOUNT_ALIASES[accountId]) {
    return KRJ_ACCOUNT_ALIASES[accountId];
  }
  return accountId;
}

export interface IBPositionContract {
  conId?: number;
  symbol: string;
  secType: string;
  exchange: string;
  currency: string;
  lastTradeDateOrContractMonth?: string;
  strike?: number;
  right?: string;
  multiplier?: string;
  localSymbol?: string;
  tradingClass?: string;
}

export interface IBPositionRow {
  account: string;
  contract: IBPositionContract;
  position: number;
  avgCost: number;
}

interface IBPositionsResponse {
  positions?: IBPositionRow[];
  accounts?: string[];
  error?: string;
}

/** Sell-scan result from POST /api/ma-options/sell-scan */
interface SellScanContract {
  symbol: string;
  strike: number;
  expiry: string;
  right: string;
  bid: number;
  ask: number;
  mid: number;
  last: number;
  volume: number;
  open_interest: number;
  implied_vol?: number;
  delta?: number;
}

interface SellScanResponse {
  ticker: string;
  spotPrice: number;
  right: string;
  expirations: string[];
  contracts: SellScanContract[];
}

function formatAvgCost(n: number): string {
  if (n === 0) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPosition(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function displaySymbol(row: IBPositionRow): string {
  const c = row.contract;
  if (c.secType === "OPT" && (c.lastTradeDateOrContractMonth || c.strike)) {
    const exp = (c.lastTradeDateOrContractMonth || "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
    return c.symbol
      ? `${c.symbol} ${exp} ${c.strike} ${c.right || ""}`.trim()
      : (c.localSymbol || c.symbol || "—");
  }
  if (c.secType === "FUT" && c.lastTradeDateOrContractMonth) {
    return c.symbol ? `${c.symbol} ${c.lastTradeDateOrContractMonth}` : (c.localSymbol || "—");
  }
  return c.localSymbol || c.symbol || "—";
}

/** Group key for related securities: underlying symbol (OPT/STK) or symbol+expiry (FUT). */
function groupKey(row: IBPositionRow): string {
  const c = row.contract;
  let sym = c?.symbol?.trim() || "";
  if (!sym && c?.localSymbol) {
    // e.g. "SPCE   250117C00055000" -> use leading letters as underlying
    const match = c.localSymbol.match(/^([A-Z]+)/);
    sym = match ? match[1] : c.localSymbol;
  }
  if (!sym) sym = "?";
  if (c?.secType === "FUT" && c.lastTradeDateOrContractMonth) {
    return `${sym} ${c.lastTradeDateOrContractMonth}`;
  }
  return sym;
}

interface GroupAggregate {
  key: string;
  rows: IBPositionRow[];
  costBasis: number;
  netPosition: number;
  longPosition: number;
  shortPosition: number;
  callCount: number;
  putCount: number;
  typeCounts: Record<string, number>;
}

function computeGroups(positions: IBPositionRow[]): GroupAggregate[] {
  const byKey = new Map<string, IBPositionRow[]>();
  for (const row of positions) {
    const k = groupKey(row);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(row);
  }
  const groups: GroupAggregate[] = [];
  for (const [key, rows] of byKey) {
    let costBasis = 0;
    let netPosition = 0;
    let longPosition = 0;
    let shortPosition = 0;
    let callCount = 0;
    let putCount = 0;
    const typeCounts: Record<string, number> = {};
    for (const r of rows) {
      costBasis += r.position * r.avgCost;
      netPosition += r.position;
      if (r.position > 0) longPosition += r.position;
      else shortPosition += r.position;
      const t = r.contract?.secType || "?";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
      if (r.contract?.right === "C") callCount++;
      else if (r.contract?.right === "P") putCount++;
    }
    groups.push({
      key,
      rows,
      costBasis,
      netPosition,
      longPosition,
      shortPosition,
      callCount,
      putCount,
      typeCounts,
    });
  }
  groups.sort((a, b) => a.key.localeCompare(b.key));
  return groups;
}

function formatCostBasis(n: number): string {
  if (n === 0) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  return sign + "$" + abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatGroupPosition(group: GroupAggregate): string {
  if (group.rows.length === 1 && group.rows[0].contract?.secType !== "OPT") {
    return formatPosition(group.netPosition);
  }
  if (group.longPosition !== 0 || group.shortPosition !== 0) {
    const parts: string[] = [];
    if (group.longPosition > 0) parts.push("+" + formatPosition(group.longPosition));
    if (group.shortPosition < 0) parts.push(formatPosition(group.shortPosition));
    return parts.join(" / ") || "—";
  }
  return "—";
}

interface IBPositionsTabProps {
  /** When true, auto-refresh positions every 60s (e.g. when tab is active). */
  autoRefresh?: boolean;
}

export default function IBPositionsTab({ autoRefresh = true }: IBPositionsTabProps) {
  const { data: session } = useSession();
  const userAlias = session?.user?.alias ?? null;
  const { isConnected } = useIBConnection();
  const [data, setData] = useState<IBPositionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTickers, setSelectedTickers] = useState<Set<string>>(new Set());
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const hasSetDefaultAccountRef = useRef(false);
  const [sellScanTicker, setSellScanTicker] = useState<string | null>(null);
  const [sellScanRight, setSellScanRight] = useState<"C" | "P" | null>(null);
  const [sellScanLoading, setSellScanLoading] = useState(false);
  const [sellScanResult, setSellScanResult] = useState<SellScanResponse | null>(null);
  const [sellScanError, setSellScanError] = useState<string | null>(null);

  const fetchPositions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ib-connection/positions", { credentials: "include" });
      const json = await res.json();
      if (!res.ok) {
        const msg = json?.error || `Request failed: ${res.status}`;
        setError(msg);
        setData(null);
        return;
      }
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch positions");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const runSellScan = useCallback(async (ticker: string, right: "C" | "P") => {
    setSellScanTicker(ticker);
    setSellScanRight(right);
    setSellScanLoading(true);
    setSellScanResult(null);
    setSellScanError(null);
    try {
      const res = await fetch("/api/ma-options/sell-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, right }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setSellScanError(data?.error || `Request failed: ${res.status}`);
        return;
      }
      setSellScanResult(data as SellScanResponse);
    } catch (e) {
      setSellScanError(e instanceof Error ? e.message : "Sell scan failed");
    } finally {
      setSellScanLoading(false);
    }
  }, []);

  const closeSellScanModal = useCallback(() => {
    setSellScanTicker(null);
    setSellScanRight(null);
    setSellScanResult(null);
    setSellScanError(null);
  }, []);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  useEffect(() => {
    if (!autoRefresh || !isConnected) return;
    const interval = setInterval(fetchPositions, 60000);
    return () => clearInterval(interval);
  }, [autoRefresh, isConnected, fetchPositions]);

  const positions = data?.positions ?? [];
  useEffect(() => {
    hasSetDefaultAccountRef.current = false;
  }, [data]);

  const accounts = useMemo(
    () => [...new Set(positions.map((p) => p.account))].sort(),
    [positions]
  );
  const filteredPositions = useMemo(
    () =>
      selectedAccount
        ? positions.filter((p) => p.account === selectedAccount)
        : positions,
    [positions, selectedAccount]
  );
  const groups = computeGroups(filteredPositions);
  const groupKeysSignature = useMemo(
    () => groups.map((g) => g.key).sort().join(","),
    [filteredPositions.length, filteredPositions.map((p) => groupKey(p)).join(",")]
  );

  // For KRJ: default to Personal (U127613) on first load when that account exists
  useEffect(() => {
    if (
      !hasSetDefaultAccountRef.current &&
      accounts.length > 0 &&
      userAlias === "KRJ" &&
      accounts.includes("U127613")
    ) {
      setSelectedAccount("U127613");
      hasSetDefaultAccountRef.current = true;
    }
  }, [accounts, userAlias]);

  // When groups load or change: default no selection; keep only tickers that still exist
  useEffect(() => {
    if (groups.length === 0) return;
    setSelectedTickers((prev) => {
      const allKeys = new Set(groups.map((g) => g.key));
      if (prev.size === 0) return new Set<string>();
      return new Set([...prev].filter((k) => allKeys.has(k)));
    });
  }, [groupKeysSignature, groups.length]);

  const toggleTicker = (key: string) => {
    setSelectedTickers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const selectedGroups = groups.filter((g) => selectedTickers.has(g.key));
  const byType = filteredPositions.reduce<Record<string, number>>((acc, row) => {
    const t = row.contract?.secType || "?";
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const totalCostBasis = groups.reduce((s, g) => s + g.costBasis, 0);

  if (!isConnected) {
    return (
      <div className="rounded-lg border border-gray-600 bg-gray-800/50 px-4 py-5 text-base text-gray-200">
        <p className="mb-2 font-medium">Connect your agent to see live positions.</p>
        <p className="text-sm text-gray-400">
          Download and start the IB Data Agent, then ensure TWS is running.
        </p>
      </div>
    );
  }

  if (loading && positions.length === 0) {
    return (
      <div className="rounded-lg border border-gray-600 bg-gray-800/50 px-4 py-5 text-base text-gray-300">
        Loading positions…
      </div>
    );
  }

  if (error && positions.length === 0) {
    return (
      <div className="rounded-lg border border-gray-600 bg-gray-800/50 px-4 py-5 text-base">
        <p className="text-red-300 mb-3 font-medium">{error}</p>
        <button
          type="button"
          onClick={fetchPositions}
          className="min-h-[44px] px-5 py-2.5 bg-gray-600 hover:bg-gray-500 text-white rounded-lg text-base font-medium"
        >
          Refresh
        </button>
      </div>
    );
  }

  const accentColors = [
    "border-l-blue-500 bg-gray-800/80",
    "border-l-emerald-500 bg-gray-800/80",
    "border-l-amber-500 bg-gray-800/80",
    "border-l-violet-500 bg-gray-800/80",
    "border-l-cyan-500 bg-gray-800/80",
    "border-l-rose-500 bg-gray-800/80",
  ];
  const headerAccents = [
    "bg-blue-900/50 border-blue-500/50",
    "bg-emerald-900/50 border-emerald-500/50",
    "bg-amber-900/50 border-amber-500/50",
    "bg-violet-900/50 border-violet-500/50",
    "bg-cyan-900/50 border-cyan-500/50",
    "bg-rose-900/50 border-rose-500/50",
  ];

  return (
    <div className="space-y-4">
      {/* Account filter - one, other, or both */}
      {accounts.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-medium text-gray-300 mr-1">Account:</span>
          <button
            type="button"
            onClick={() => setSelectedAccount(null)}
            className={`min-h-[44px] px-4 py-2.5 rounded-lg text-base font-medium transition-colors ${
              selectedAccount === null
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-200 hover:bg-gray-600"
            }`}
          >
            All ({positions.length})
          </button>
          {accounts.map((acct) => (
            <button
              key={acct}
              type="button"
              onClick={() => setSelectedAccount(acct)}
              className={`min-h-[44px] px-4 py-2.5 rounded-lg text-base font-medium transition-colors ${
                selectedAccount === acct
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-200 hover:bg-gray-600"
              }`}
            >
              {getAccountLabel(acct, userAlias)} ({positions.filter((p) => p.account === acct).length})
            </button>
          ))}
        </div>
      )}

      {/* Top-level summary - larger, higher contrast */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-base text-gray-200">
        <span className="font-medium">
          Positions: {filteredPositions.length} total
          {selectedAccount !== null &&
            ` (${getAccountLabel(selectedAccount, userAlias)})`}
        </span>
        {Object.keys(byType).length > 0 && (
          <span>By type: {Object.entries(byType).map(([t, n]) => `${t} ${n}`).join(", ")}</span>
        )}
        <span className="font-semibold text-white tabular-nums">
          Cost basis: {formatCostBasis(totalCostBasis)}
        </span>
      </div>

      {filteredPositions.length === 0 ? (
        <div className="rounded-lg border border-gray-600 bg-gray-800/50 px-4 py-6 text-base text-gray-300">
          {selectedAccount !== null
            ? `No positions in account ${getAccountLabel(selectedAccount, userAlias)}.`
            : "No positions."}
        </div>
      ) : (
        <>
          <div className="flex gap-4 min-h-0">
            {/* Left: one big box listing all tickers (one row each, STK/OPT on same line) */}
            <div className="w-64 shrink-0 flex flex-col rounded-lg border border-gray-600 bg-gray-800/80 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-600 text-sm font-semibold text-gray-200">
                Tickers ({groups.length})
              </div>
              <div className="overflow-y-auto flex-1 min-h-[200px]">
                {groups.map((group) => {
                  const selected = selectedTickers.has(group.key);
                  const typeLine = [
                    ...Object.entries(group.typeCounts).map(([t, n]) => `${t} ${n}`),
                    group.callCount + group.putCount > 0
                      ? `(${group.callCount}C/${group.putCount}P)`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => toggleTicker(group.key)}
                      className={`w-full text-left px-3 py-2.5 border-b border-gray-700/50 text-base font-medium transition-colors min-h-[44px] flex items-center justify-between gap-2 ${
                        selected
                          ? "bg-blue-900/40 text-white border-l-4 border-l-blue-400"
                          : "text-gray-300 hover:bg-gray-700/50 border-l-4 border-l-transparent"
                      }`}
                    >
                      <span className="font-semibold truncate">{group.key}</span>
                      <span className="text-sm text-gray-400 shrink-0 truncate max-w-[50%]">
                        {typeLine}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right: two columns of detail boxes for selected tickers only */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 content-start">
                {selectedGroups.length === 0 ? (
                  <div className="col-span-2 rounded-lg border border-gray-600 bg-gray-800/50 px-4 py-8 text-center text-base text-gray-400">
                    Select one or more tickers from the list to see details.
                  </div>
                ) : (
                  selectedGroups.map((group, idx) => {
                    const accent = accentColors[idx % accentColors.length];
                    const headerAccent = headerAccents[idx % headerAccents.length];
                    return (
                      <div
                        key={`group-${group.key}`}
                        className={`rounded-lg border border-gray-600 overflow-hidden border-l-4 ${accent}`}
                      >
                        <div
                          className={`flex flex-col gap-1.5 px-4 py-3 border-b border-gray-600 ${headerAccent}`}
                        >
                          <span className="text-xl font-bold text-white tracking-tight">
                            {group.key}
                          </span>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-200">
                            <span>
                              {Object.entries(group.typeCounts)
                                .map(([t, n]) => `${t} ${n}`)
                                .join(", ")}
                            </span>
                            {group.callCount + group.putCount > 0 && (
                              <span className="text-gray-300">
                                ({group.callCount}C / {group.putCount}P)
                              </span>
                            )}
                            <span className="tabular-nums font-medium text-white">
                              Pos {formatGroupPosition(group)}
                            </span>
                            <span className="tabular-nums font-semibold text-white">
                              {formatCostBasis(group.costBasis)}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2 mt-2">
                            <button
                              type="button"
                              onClick={() => runSellScan(group.key, "C")}
                              disabled={sellScanLoading}
                              className="min-h-[44px] px-4 py-2.5 rounded-lg text-base font-medium bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white"
                            >
                              Sell calls
                            </button>
                            <button
                              type="button"
                              onClick={() => runSellScan(group.key, "P")}
                              disabled={sellScanLoading}
                              className="min-h-[44px] px-4 py-2.5 rounded-lg text-base font-medium bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white"
                            >
                              Sell puts
                            </button>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-700/50 text-gray-200 text-sm border-b border-gray-600">
                                <th className="text-left py-2 px-3">Account</th>
                                <th className="text-left py-2 px-3">Symbol</th>
                                <th className="text-left py-2 px-3">Type</th>
                                <th className="text-right py-2 px-3">Pos</th>
                                <th className="text-right py-2 px-3">Avg cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.rows.map((row, i) => (
                                <tr
                                  key={`${row.account}-${row.contract?.conId ?? i}-${row.contract?.localSymbol ?? row.contract?.symbol}`}
                                  className="border-b border-gray-700/50 hover:bg-gray-700/30"
                                >
                                  <td className="py-2 px-3 text-gray-300 text-sm">
                                    {getAccountLabel(row.account, userAlias)}
                                  </td>
                                  <td className="py-2 px-3 text-gray-100 whitespace-nowrap text-sm font-medium">
                                    {displaySymbol(row)}
                                  </td>
                                  <td className="py-2 px-3 text-gray-400 text-sm">
                                    {row.contract?.secType ?? "—"}
                                  </td>
                                  <td className="py-2 px-3 text-right text-gray-100 tabular-nums text-sm font-medium">
                                    {formatPosition(row.position)}
                                  </td>
                                  <td className="py-2 px-3 text-right text-gray-100 tabular-nums text-sm">
                                    {formatAvgCost(row.avgCost)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {/* Grand total - prominent */}
              <div className="rounded-lg border-2 border-gray-500 bg-gray-800 px-4 py-3 flex justify-end items-center gap-6 text-base font-semibold text-white mt-4">
                <span>Total cost basis</span>
                <span className="tabular-nums text-lg">{formatCostBasis(totalCostBasis)}</span>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={fetchPositions}
          disabled={loading}
          className="min-h-[44px] px-5 py-2.5 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white rounded-lg text-base font-medium"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Sell-scan modal: NTM calls/puts for next 0–15 business days */}
      {sellScanTicker != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sell-scan-title"
        >
          <div className="bg-gray-900 border border-gray-600 rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-gray-600 shrink-0">
              <h2 id="sell-scan-title" className="text-xl font-bold text-white">
                {sellScanLoading
                  ? `Loading…`
                  : sellScanRight === "C"
                    ? `Sell calls — ${sellScanTicker}`
                    : `Sell puts — ${sellScanTicker}`}
              </h2>
              <button
                type="button"
                onClick={closeSellScanModal}
                className="min-h-[44px] min-w-[44px] px-4 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-base font-medium"
              >
                Close
              </button>
            </div>
            <div className="overflow-auto flex-1 px-4 py-3">
              {sellScanLoading && (
                <p className="text-lg text-gray-300 py-8">Fetching option chain and quotes…</p>
              )}
              {sellScanError && !sellScanLoading && (
                <div className="py-4">
                  <p className="text-lg text-red-300 font-medium">{sellScanError}</p>
                  <p className="text-base text-gray-400 mt-2">
                    Ensure your IB Data Agent is running and TWS has options data for {sellScanTicker}.
                  </p>
                </div>
              )}
              {sellScanResult && !sellScanLoading && (
                <div className="space-y-4">
                  <p className="text-base text-gray-200">
                    Spot: <span className="font-semibold text-white tabular-nums">${sellScanResult.spotPrice.toFixed(2)}</span>
                    {" · "}
                    {sellScanResult.contracts.length} contracts (0–15 business days, near the money)
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-base border-collapse">
                      <thead>
                        <tr className="border-b border-gray-600 text-gray-200">
                          <th className="text-left py-3 px-3 font-semibold">Expiration</th>
                          <th className="text-right py-3 px-3 font-semibold">Strike</th>
                          <th className="text-right py-3 px-3 font-semibold">Bid</th>
                          <th className="text-right py-3 px-3 font-semibold">Ask</th>
                          <th className="text-right py-3 px-3 font-semibold">Mid</th>
                          <th className="text-right py-3 px-3 font-semibold">Vol</th>
                          <th className="text-right py-3 px-3 font-semibold">OI</th>
                          <th className="text-right py-3 px-3 font-semibold">Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sellScanResult.contracts.map((c, i) => (
                          <tr key={`${c.expiry}-${c.strike}-${i}`} className="border-b border-gray-700/50 hover:bg-gray-800/50">
                            <td className="py-2.5 px-3 text-gray-100">
                              {c.expiry.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")}
                            </td>
                            <td className="py-2.5 px-3 text-right text-white tabular-nums font-medium">{c.strike}</td>
                            <td className="py-2.5 px-3 text-right text-gray-100 tabular-nums">{c.bid?.toFixed(2) ?? "—"}</td>
                            <td className="py-2.5 px-3 text-right text-gray-100 tabular-nums">{c.ask?.toFixed(2) ?? "—"}</td>
                            <td className="py-2.5 px-3 text-right text-white tabular-nums font-medium">{c.mid?.toFixed(2) ?? "—"}</td>
                            <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{c.volume ?? "—"}</td>
                            <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{c.open_interest ?? "—"}</td>
                            <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">
                              {c.delta != null ? c.delta.toFixed(2) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
