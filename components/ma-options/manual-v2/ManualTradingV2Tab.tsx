"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useSession } from "next-auth/react";
import { useIBConnection } from "../IBConnectionContext";
import { useUIPreferences } from "@/lib/ui-preferences";
import type { IBPositionRow, IBPositionContract } from "../IBPositionsTab";
import type { LegGreeksData } from "./useGreeksComputation";
import { computeTickerGreeks, greeksLegKey, type TickerGreeksSummary } from "./useGreeksComputation";
import TickerSummaryTable, { type TickerGroup } from "./TickerSummaryTable";
import TickerDetailView from "./TickerDetailView";
import type { IBOpenOrder } from "./WorkingOrdersInline";
import type { PlaceOrderParams } from "./InlineOrderTicket";

/* ─── Types ─── */
interface IBPositionsResponse {
  positions?: IBPositionRow[];
  accounts?: string[];
  error?: string;
}

interface LegPrice {
  bid: number;
  ask: number;
  mid: number;
  last: number;
}

interface ManualTickerEntry {
  ticker: string;
  name?: string;
}

/* ─── Pure helpers ─── */

/** Group key for related securities: underlying symbol. */
function groupKey(row: IBPositionRow): string {
  const c = row.contract;
  let sym = c?.symbol?.trim() || "";
  if (!sym && c?.localSymbol) {
    const match = c.localSymbol.match(/^([A-Z]+)/);
    sym = match ? match[1] : c.localSymbol;
  }
  if (!sym) sym = "?";
  if (c?.secType === "FUT" && c.lastTradeDateOrContractMonth) {
    return `${sym} ${c.lastTradeDateOrContractMonth}`;
  }
  return sym;
}

function computeGroups(positions: IBPositionRow[]): TickerGroup[] {
  const byKey = new Map<string, IBPositionRow[]>();
  for (const row of positions) {
    const k = groupKey(row);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(row);
  }
  const groups: TickerGroup[] = [];
  for (const [key, rows] of byKey) {
    let stockPosition = 0;
    let callCount = 0;
    let putCount = 0;
    for (const r of rows) {
      if (r.contract.secType === "STK" || r.contract.secType === "FUT") {
        stockPosition += r.position;
      }
      if (r.contract?.right === "C") callCount++;
      else if (r.contract?.right === "P") putCount++;
    }
    groups.push({ key, rows, stockPosition, callCount, putCount });
  }
  groups.sort((a, b) => a.key.localeCompare(b.key));
  return groups;
}

function legKey(row: IBPositionRow): string {
  const c = row.contract;
  if (c.secType === "OPT") {
    return `${row.account}:OPT:${c.symbol}:${c.lastTradeDateOrContractMonth}:${c.strike}:${c.right}`;
  }
  return `${row.account}:${c.secType}:${c.symbol}`;
}

function getMultiplier(row: IBPositionRow): number {
  const c = row.contract;
  if (c.secType === "OPT" || c.secType === "FOP") {
    const m = parseInt(c.multiplier || "100", 10);
    return isNaN(m) || m <= 0 ? 100 : m;
  }
  if (c.secType === "FUT") {
    const m = parseInt(c.multiplier || "1", 10);
    return isNaN(m) || m <= 0 ? 1 : m;
  }
  return 1;
}

/* ─── Component ─── */
export default function ManualTradingV2Tab() {
  const { data: session } = useSession();
  const userAlias = session?.user?.alias ?? null;
  const { isConnected } = useIBConnection();
  const { prefs, loaded: prefsLoaded, updatePrefs } = useUIPreferences();

  // View state machine
  const [view, setView] = useState<"list" | "detail">("list");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  // Data state
  const [positions, setPositions] = useState<IBPositionRow[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [openOrders, setOpenOrders] = useState<IBOpenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Leg prices & greeks
  const [legPrices, setLegPrices] = useState<Record<string, LegPrice>>({});
  const [legGreeks, setLegGreeks] = useState<Record<string, LegGreeksData>>({});
  const [spotPrices, setSpotPrices] = useState<Record<string, number | null>>({});
  const [pricesLoading, setPricesLoading] = useState<Record<string, boolean>>({});

  // Manual tickers
  const [manualTickers, setManualTickers] = useState<ManualTickerEntry[]>([]);
  const manualTickersLoadedRef = useRef(false);

  // Cancel state
  const [cancellingOrderId, setCancellingOrderId] = useState<number | null>(null);

  // Refresh interval
  const lastEventCheckRef = useRef(Date.now() / 1000);

  // ─── Data fetching ───

  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch("/api/ib-connection/positions", { credentials: "include" });
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) return;
      const json: IBPositionsResponse = await res.json();
      if (json.positions) setPositions(json.positions);
      if (json.accounts) setAccounts(json.accounts);
      if (json.error) setError(json.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch positions");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOpenOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/ib-connection/open-orders", { credentials: "include" });
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) return;
      const json = await res.json();
      if (res.ok && json.orders) setOpenOrders(json.orders);
    } catch {
      // silently fail
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchPositions();
    fetchOpenOrders();
  }, [fetchPositions, fetchOpenOrders]);

  // Auto-refresh (60s) + event-based polling (500ms)
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      if (!document.hidden) {
        fetchPositions();
        fetchOpenOrders();
      }
    }, 60_000);
    return () => clearInterval(refreshInterval);
  }, [fetchPositions, fetchOpenOrders]);

  useEffect(() => {
    if (!isConnected) return;
    const eventInterval = setInterval(async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(
          `/api/ib-connection/account-events?since=${lastEventCheckRef.current}`,
          { credentials: "include", cache: "no-store" }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.events?.length > 0) {
          lastEventCheckRef.current = Date.now() / 1000;
          fetchPositions();
          fetchOpenOrders();
        }
      } catch {
        // silently fail
      }
    }, 500);
    return () => clearInterval(eventInterval);
  }, [isConnected, fetchPositions, fetchOpenOrders]);

  // Load manual tickers from prefs
  useEffect(() => {
    if (!prefsLoaded) return;
    const maOpts = prefs.maOptionsPrefs as Record<string, unknown>;
    const manual = maOpts?.positionsManualTickers;
    if (Array.isArray(manual)) {
      setManualTickers(
        manual.filter(
          (m: unknown) => typeof m === "object" && m !== null && typeof (m as ManualTickerEntry).ticker === "string"
        ) as ManualTickerEntry[]
      );
    }
    manualTickersLoadedRef.current = true;
  }, [prefsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Position groups ───

  const positionGroups = useMemo(() => computeGroups(positions), [positions]);
  const positionGroupKeys = useMemo(() => new Set(positionGroups.map((g) => g.key)), [positionGroups]);

  // Merge manual tickers
  const allGroups = useMemo(() => {
    const manualOnly = manualTickers.filter((m) => !positionGroupKeys.has(m.ticker));
    const synthetic: TickerGroup[] = manualOnly.map((m) => ({
      key: m.ticker,
      rows: [],
      stockPosition: 0,
      callCount: 0,
      putCount: 0,
      isManual: true,
    }));
    return [...positionGroups, ...synthetic].sort((a, b) => a.key.localeCompare(b.key));
  }, [positionGroups, positionGroupKeys, manualTickers]);

  const existingTickerKeys = useMemo(() => new Set(allGroups.map((g) => g.key)), [allGroups]);

  // ─── Price & Greeks fetching ───

  const fetchSpotPrice = useCallback(async (ticker: string, contractMeta?: { secType?: string; exchange?: string; lastTradeDateOrContractMonth?: string; multiplier?: string; conId?: number }) => {
    try {
      const payload: Record<string, string | number> = { ticker: ticker.toUpperCase() };
      if (contractMeta?.secType) payload.secType = contractMeta.secType;
      if (contractMeta?.exchange) payload.exchange = contractMeta.exchange;
      if (contractMeta?.lastTradeDateOrContractMonth) payload.lastTradeDateOrContractMonth = contractMeta.lastTradeDateOrContractMonth;
      if (contractMeta?.multiplier) payload.multiplier = contractMeta.multiplier;
      if (contractMeta?.conId) payload.conId = contractMeta.conId;

      const res = await fetch("/api/ma-options/stock-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) return;
      const data = await res.json();
      if (res.ok && data.price) {
        setSpotPrices((prev) => ({ ...prev, [ticker.toUpperCase()]: data.price }));
      }
    } catch {
      // silently fail
    }
  }, []);

  const fetchGroupPrices = useCallback(async (groupKey: string, rows: IBPositionRow[]) => {
    setPricesLoading((prev) => ({ ...prev, [groupKey]: true }));
    const ticker = groupKey.split(" ")[0]?.toUpperCase() ?? groupKey;

    // Fetch spot price
    const futRow = rows.find((r) => r.contract?.secType === "FUT");
    if (futRow) {
      fetchSpotPrice(ticker, {
        secType: "FUT",
        exchange: futRow.contract.exchange || "",
        lastTradeDateOrContractMonth: futRow.contract.lastTradeDateOrContractMonth || "",
        multiplier: futRow.contract.multiplier || "",
        conId: futRow.contract.conId || undefined,
      });
    } else {
      fetchSpotPrice(ticker);
    }

    // Batch-fetch option leg prices + greeks
    const optRows = rows.filter(
      (r) => r.contract?.secType === "OPT" && r.contract?.lastTradeDateOrContractMonth && r.contract?.strike != null && r.contract?.right
    );
    if (optRows.length === 0) {
      setPricesLoading((prev) => ({ ...prev, [groupKey]: false }));
      return;
    }

    const contracts = optRows.map((r) => ({
      ticker: r.contract.symbol,
      strike: r.contract.strike!,
      expiry: r.contract.lastTradeDateOrContractMonth!,
      right: r.contract.right!,
    }));

    try {
      const res = await fetch("/api/ib-connection/fetch-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contracts }),
        credentials: "include",
      });
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) return;
      const json = await res.json();
      // Debug: log raw API response to diagnose greeks pipeline
      if (json.contracts && Array.isArray(json.contracts)) {
        for (let i = 0; i < json.contracts.length; i++) {
          const c = json.contracts[i];
          if (c) {
            console.log(`[greeks-debug] ${c.ticker} ${c.expiry} ${c.strike}${c.right}: delta=${c.delta} gamma=${c.gamma} theta=${c.theta} vega=${c.vega} iv=${c.implied_vol}`);
          }
        }
      }
      if (json.contracts && Array.isArray(json.contracts)) {
        setLegPrices((prev) => {
          const next = { ...prev };
          for (let i = 0; i < optRows.length; i++) {
            const price = json.contracts[i];
            if (price) {
              next[legKey(optRows[i])] = {
                bid: price.bid,
                ask: price.ask,
                mid: price.mid,
                last: price.last,
              };
            }
          }
          return next;
        });
        // Extract greeks from the same response (Phase 2 adds these fields)
        setLegGreeks((prev) => {
          const next = { ...prev };
          for (let i = 0; i < optRows.length; i++) {
            const price = json.contracts[i];
            if (price) {
              next[greeksLegKey(optRows[i])] = {
                delta: price.delta ?? null,
                gamma: price.gamma ?? null,
                theta: price.theta ?? null,
                vega: price.vega ?? null,
                implied_vol: price.implied_vol ?? null,
              };
            }
          }
          return next;
        });
      }
    } catch {
      // silently fail
    } finally {
      setPricesLoading((prev) => ({ ...prev, [groupKey]: false }));
    }
  }, [fetchSpotPrice]);

  // Auto-fetch prices for all groups on initial load
  const autoFetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const group of allGroups) {
      if (!autoFetchedRef.current.has(group.key) && group.rows.length > 0) {
        autoFetchedRef.current.add(group.key);
        fetchGroupPrices(group.key, group.rows);
      }
    }
  }, [allGroups, fetchGroupPrices]);

  // ─── Computed data for table ───

  const greeksByGroup = useMemo(() => {
    const result: Record<string, TickerGreeksSummary> = {};
    for (const group of allGroups) {
      result[group.key] = computeTickerGreeks(group.rows, legGreeks);
    }
    return result;
  }, [allGroups, legGreeks]);

  const pnlByGroup = useMemo(() => {
    const result: Record<string, number> = {};
    for (const group of allGroups) {
      const ticker = group.key.split(" ")[0]?.toUpperCase() ?? group.key;
      const spot = spotPrices[ticker] ?? null;
      let totalPnl = 0;
      for (const row of group.rows) {
        const mult = getMultiplier(row);
        const isOption = row.contract.secType === "OPT";
        const key = legKey(row);
        const price = isOption ? legPrices[key] : null;
        const lastPrice = isOption
          ? (price?.last || price?.mid || 0)
          : (spot ?? 0);
        if (lastPrice > 0) {
          const mktVal = row.position * lastPrice * mult;
          const costBasis = row.position * row.avgCost;
          totalPnl += mktVal - costBasis;
        }
      }
      result[group.key] = totalPnl;
    }
    return result;
  }, [allGroups, spotPrices, legPrices]);

  // ─── Actions ───

  const handleSelectTicker = useCallback((key: string) => {
    setSelectedTicker(key);
    setView("detail");
    // Fetch prices for the selected group
    const group = allGroups.find((g) => g.key === key);
    if (group && group.rows.length > 0) {
      fetchGroupPrices(key, group.rows);
    } else if (group) {
      // Manual ticker with no positions — just fetch spot
      const ticker = key.split(" ")[0]?.toUpperCase() ?? key;
      fetchSpotPrice(ticker);
    }
  }, [allGroups, fetchGroupPrices, fetchSpotPrice]);

  const handleBack = useCallback(() => {
    setView("list");
    setSelectedTicker(null);
  }, []);

  const handleAddTicker = useCallback((ticker: string, name: string) => {
    const entry: ManualTickerEntry = { ticker: ticker.toUpperCase(), name };
    setManualTickers((prev) => {
      const next = [...prev, entry];
      updatePrefs({ maOptionsPrefs: { positionsManualTickers: next } });
      return next;
    });
    // Fetch spot price for new ticker
    fetchSpotPrice(ticker.toUpperCase());
  }, [updatePrefs, fetchSpotPrice]);

  const handlePlaceOrder = useCallback(async (params: PlaceOrderParams): Promise<{ orderId?: number; error?: string }> => {
    try {
      const contract: Record<string, unknown> = {
        symbol: params.ticker,
        secType: params.secType,
        exchange: "SMART",
        currency: "USD",
      };
      if (params.secType === "OPT") {
        if (params.expiry) contract.lastTradeDateOrContractMonth = params.expiry;
        if (params.strike) contract.strike = params.strike;
        if (params.right) contract.right = params.right;
        if (params.multiplier) contract.multiplier = params.multiplier;
      }
      const order: Record<string, unknown> = {
        action: params.action,
        totalQuantity: params.quantity,
        orderType: params.orderType,
        tif: params.tif,
        outsideRth: params.outsideRth,
        transmit: true,
      };
      if (params.account) order.account = params.account;
      if (params.orderType === "LMT" || params.orderType === "STP LMT") {
        order.lmtPrice = params.lmtPrice;
      }
      if (params.orderType === "STP LMT") {
        order.auxPrice = params.stopPrice;
      }

      const res = await fetch("/api/ib-connection/place-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract, order, timeout_sec: 15 }),
        credentials: "include",
      });
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        return { error: "Server returned unexpected response" };
      }
      const json = await res.json();
      if (!res.ok) {
        return { error: json.error || `Order failed: ${res.status}` };
      }
      // Refresh orders after placement
      setTimeout(() => fetchOpenOrders(), 500);
      return { orderId: json.orderId };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Order failed" };
    }
  }, [fetchOpenOrders]);

  const handleCancelOrder = useCallback(async (orderId: number) => {
    setCancellingOrderId(orderId);
    try {
      await fetch("/api/ib-connection/cancel-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
        credentials: "include",
      });
      setTimeout(() => fetchOpenOrders(), 500);
    } catch {
      // silently fail
    } finally {
      setCancellingOrderId(null);
    }
  }, [fetchOpenOrders]);

  const handleModifyOrder = useCallback(async (orderId: number, updates: { qty?: number; lmtPrice?: number; stopPrice?: number }) => {
    const order = openOrders.find((o) => o.orderId === orderId);
    if (!order) return;

    const contract: Record<string, unknown> = {
      symbol: order.contract.symbol,
      secType: order.contract.secType,
      exchange: order.contract.exchange || "SMART",
      currency: order.contract.currency || "USD",
    };
    if (order.contract.lastTradeDateOrContractMonth) contract.lastTradeDateOrContractMonth = order.contract.lastTradeDateOrContractMonth;
    if (order.contract.strike) contract.strike = order.contract.strike;
    if (order.contract.right) contract.right = order.contract.right;
    if (order.contract.multiplier) contract.multiplier = order.contract.multiplier;
    if (order.contract.conId) contract.conId = order.contract.conId;

    const orderPayload: Record<string, unknown> = {
      action: order.order.action,
      totalQuantity: updates.qty ?? order.order.totalQuantity,
      orderType: order.order.orderType,
      tif: order.order.tif || "DAY",
      outsideRth: order.order.outsideRth ?? false,
      transmit: true,
    };
    if (order.order.account) orderPayload.account = order.order.account;
    if (order.order.orderType === "LMT" || order.order.orderType === "STP LMT") {
      orderPayload.lmtPrice = updates.lmtPrice ?? order.order.lmtPrice;
    }
    if (order.order.orderType === "STP LMT" || order.order.orderType === "STP") {
      orderPayload.auxPrice = updates.stopPrice ?? order.order.auxPrice;
    }

    const res = await fetch("/api/ib-connection/modify-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, contract, order: orderPayload, timeout_sec: 15 }),
      credentials: "include",
    });
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const json = await res.json();
      if (json.error) throw new Error(json.error);
    }
    setTimeout(() => fetchOpenOrders(), 500);
  }, [openOrders, fetchOpenOrders]);

  // ─── Selected group data ───

  const selectedGroup = useMemo(
    () => allGroups.find((g) => g.key === selectedTicker),
    [allGroups, selectedTicker]
  );

  const selectedTickerOrders = useMemo(() => {
    if (!selectedTicker) return [];
    const ticker = selectedTicker.split(" ")[0]?.toUpperCase() ?? selectedTicker;
    return openOrders.filter((o) => (o.contract?.symbol?.toUpperCase() || "") === ticker);
  }, [openOrders, selectedTicker]);

  // ─── Render ───

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading positions...</div>;
  }

  if (error && positions.length === 0) {
    return <div className="text-center py-12 text-red-400">{error}</div>;
  }

  if (view === "detail" && selectedTicker && selectedGroup) {
    const ticker = selectedTicker.split(" ")[0]?.toUpperCase() ?? selectedTicker;
    return (
      <TickerDetailView
        ticker={selectedTicker}
        rows={selectedGroup.rows}
        spotPrice={spotPrices[ticker] ?? null}
        greeks={greeksByGroup[selectedTicker] ?? { stockDelta: 0, optionsDelta: 0, netDelta: 0, netGamma: 0, netTheta: 0, netVega: 0, hasGreeks: false }}
        legPrices={legPrices}
        legGreeks={legGreeks}
        orders={selectedTickerOrders}
        accounts={accounts}
        defaultAccount={accounts[0]}
        onBack={handleBack}
        onPlaceOrder={handlePlaceOrder}
        onCancelOrder={handleCancelOrder}
        onModifyOrder={handleModifyOrder}
        onRefreshPrices={() => fetchGroupPrices(selectedTicker, selectedGroup.rows)}
        cancellingOrderId={cancellingOrderId}
        pricesLoading={pricesLoading[selectedTicker]}
      />
    );
  }

  return (
    <TickerSummaryTable
      groups={allGroups}
      spotPrices={spotPrices}
      greeks={greeksByGroup}
      pnls={pnlByGroup}
      onSelectTicker={handleSelectTicker}
      onAddTicker={handleAddTicker}
      existingTickers={existingTickerKeys}
    />
  );
}
