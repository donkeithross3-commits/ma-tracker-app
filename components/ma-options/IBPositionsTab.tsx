"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
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

/** Open/working order from IB */
interface IBOpenOrder {
  orderId: number;
  contract: IBPositionContract;
  order: {
    action: string;
    totalQuantity: number;
    orderType: string;
    lmtPrice?: number | null;
    auxPrice?: number | null;
    tif: string;
    account: string;
    parentId?: number;
    ocaGroup?: string;
  };
  orderState: {
    status: string;
    warningText?: string;
    commission?: number | null;
  };
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
  /** True if this group is from a manually added ticker (no IB position). */
  isManual?: boolean;
}

/** Manual ticker entry for position boxes without an IB position (persisted in preferences). */
export interface ManualTickerEntry {
  ticker: string;
  name?: string;
}

interface TickerMatch {
  ticker: string;
  name: string;
}

/** Build a synthetic group for a manual ticker (no positions). */
function syntheticGroup(key: string): GroupAggregate {
  return {
    key,
    rows: [],
    costBasis: 0,
    netPosition: 0,
    longPosition: 0,
    shortPosition: 0,
    callCount: 0,
    putCount: 0,
    typeCounts: {},
    isManual: true,
  };
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

function displayOrderSymbol(o: IBOpenOrder): string {
  const c = o.contract;
  if (c.secType === "OPT" && (c.lastTradeDateOrContractMonth || c.strike)) {
    const exp = (c.lastTradeDateOrContractMonth || "").replace(/(\d{4})(\d{2})(\d{2})/, "$2/$3");
    return `${c.symbol} ${exp} ${c.strike} ${c.right || ""}`.trim();
  }
  return c.symbol || c.localSymbol || "—";
}

function formatOrderPrice(o: IBOpenOrder): string {
  const { orderType, lmtPrice, auxPrice } = o.order;
  if (orderType === "MKT" || orderType === "MOC") return orderType;
  if (orderType === "LMT" && lmtPrice != null) return `LMT ${lmtPrice.toFixed(2)}`;
  if (orderType === "STP LMT" && lmtPrice != null && auxPrice != null)
    return `STP ${auxPrice.toFixed(2)} LMT ${lmtPrice.toFixed(2)}`;
  if (orderType === "STP" && auxPrice != null) return `STP ${auxPrice.toFixed(2)}`;
  return orderType;
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

/** Live price data for a single position leg (option or stock). */
interface LegPrice {
  bid: number;
  ask: number;
  mid: number;
  last: number;
}

/** Stable key to uniquely identify a position row for price caching. */
function legKey(row: IBPositionRow): string {
  const c = row.contract;
  if (c.secType === "OPT") {
    return `${row.account}:OPT:${c.symbol}:${c.lastTradeDateOrContractMonth}:${c.strike}:${c.right}`;
  }
  return `${row.account}:${c.secType}:${c.symbol}`;
}

/** Format a P&L value with sign: +$1,234.56 or −$567.89 */
function formatPnl(n: number): string {
  const abs = Math.abs(n);
  const formatted = "$" + abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n > 0) return "+" + formatted;
  if (n < 0) return "\u2212" + formatted;
  return formatted;
}

/**
 * Contract multiplier for market value calculation.
 * IB market data returns option prices per-share, but avgCost from the
 * position callback is per-contract (already includes the multiplier).
 * So we must multiply lastPrice by the contract multiplier for options.
 */
function getMultiplier(row: IBPositionRow): number {
  const c = row.contract;
  if (c.secType === "OPT" || c.secType === "FOP") {
    const m = parseInt(c.multiplier || "100", 10);
    return isNaN(m) || m <= 0 ? 100 : m;
  }
  return 1;
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
  const [savedPositionsTickers, setSavedPositionsTickers] = useState<string[] | null>(null);
  const appliedSavedPositionsRef = useRef(false);
  const [sellScanTicker, setSellScanTicker] = useState<string | null>(null);
  const [sellScanRight, setSellScanRight] = useState<"C" | "P" | null>(null);
  const [sellScanLoading, setSellScanLoading] = useState(false);
  const [sellScanResult, setSellScanResult] = useState<SellScanResponse | null>(null);
  const [sellScanError, setSellScanError] = useState<string | null>(null);
  const [sellScanGroupKey, setSellScanGroupKey] = useState<string>("");

  // ---- Open/working orders state ----
  const [openOrders, setOpenOrders] = useState<IBOpenOrder[]>([]);
  const [openOrdersLoading, setOpenOrdersLoading] = useState(false);
  const [openOrdersError, setOpenOrdersError] = useState<string | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<number | null>(null);
  const [showAllOrders, setShowAllOrders] = useState(true);
  const [collapsedBoxOrders, setCollapsedBoxOrders] = useState<Record<string, boolean>>({});

  // ---- Order modification state ----
  const [editingOrderIdx, setEditingOrderIdx] = useState<number | null>(null);
  const [editLmtPrice, setEditLmtPrice] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // ---- Leg prices for live P&L ----
  const [legPrices, setLegPrices] = useState<Record<string, LegPrice>>({});
  const [legPricesLoading, setLegPricesLoading] = useState<Record<string, boolean>>({});
  const autoFetchedLegPricesRef = useRef<Set<string>>(new Set());

  const fetchOpenOrders = useCallback(async () => {
    setOpenOrdersLoading(true);
    setOpenOrdersError(null);
    try {
      const res = await fetch("/api/ib-connection/open-orders", { credentials: "include" });
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        setOpenOrdersError("Unexpected response from server");
        return;
      }
      const json = await res.json();
      if (!res.ok) {
        setOpenOrdersError(json?.error || `Request failed: ${res.status}`);
        return;
      }
      setOpenOrders(json.orders || []);
    } catch (e) {
      setOpenOrdersError(e instanceof Error ? e.message : "Failed to fetch orders");
    } finally {
      setOpenOrdersLoading(false);
    }
  }, []);

  const cancelOrder = useCallback(async (orderId: number) => {
    setCancellingOrderId(orderId);
    try {
      const res = await fetch("/api/ib-connection/cancel-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
        credentials: "include",
      });
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const json = await res.json();
        if (json.error) {
          setOpenOrdersError(`Cancel failed: ${json.error}`);
        }
      }
      // Refresh orders after cancel attempt
      setTimeout(() => fetchOpenOrders(), 500);
    } catch (e) {
      setOpenOrdersError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setCancellingOrderId(null);
    }
  }, [fetchOpenOrders]);

  /** Start editing an order — pre-fill with current values.
   *  We track by array index (not orderId) because multiple orders can share the same orderId. */
  const startEditOrder = useCallback((o: IBOpenOrder, idx: number) => {
    setEditingOrderIdx(idx);
    setEditLmtPrice(
      o.order.lmtPrice != null ? o.order.lmtPrice.toFixed(2) : ""
    );
    setEditQty(String(o.order.totalQuantity));
    setEditError(null);
  }, []);

  const cancelEditOrder = useCallback(() => {
    setEditingOrderIdx(null);
    setEditError(null);
  }, []);

  /** Submit order modification — calls modify-order API */
  const submitModifyOrder = useCallback(async (o: IBOpenOrder) => {
    const newQty = parseFloat(editQty);
    if (!newQty || newQty <= 0) {
      setEditError("Enter a valid quantity");
      return;
    }
    const newLmt = parseFloat(editLmtPrice);
    if (o.order.orderType === "LMT" && (!newLmt || newLmt <= 0)) {
      setEditError("Enter a valid limit price");
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    try {
      // Rebuild the contract from the open order's contract data
      const contract: Record<string, unknown> = {
        symbol: o.contract.symbol,
        secType: o.contract.secType,
        exchange: o.contract.exchange || "SMART",
        currency: o.contract.currency || "USD",
      };
      if (o.contract.lastTradeDateOrContractMonth)
        contract.lastTradeDateOrContractMonth = o.contract.lastTradeDateOrContractMonth;
      if (o.contract.strike) contract.strike = o.contract.strike;
      if (o.contract.right) contract.right = o.contract.right;
      if (o.contract.multiplier) contract.multiplier = o.contract.multiplier;
      if (o.contract.conId) contract.conId = o.contract.conId;

      // Build updated order
      const order: Record<string, unknown> = {
        action: o.order.action,
        totalQuantity: newQty,
        orderType: o.order.orderType,
        tif: o.order.tif || "DAY",
        transmit: true,
      };
      if (o.order.account) order.account = o.order.account;
      if (o.order.orderType === "LMT" || o.order.orderType === "STP LMT") {
        order.lmtPrice = newLmt;
      }
      if (o.order.orderType === "STP LMT" && o.order.auxPrice != null) {
        order.auxPrice = o.order.auxPrice;
      }

      const res = await fetch("/api/ib-connection/modify-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: o.orderId, contract, order, timeout_sec: 15 }),
        credentials: "include",
      });
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const json = await res.json();
        if (json.error) {
          setEditError(`Modify failed: ${json.error}`);
          return;
        }
      }
      // Success — close editor and refresh orders
      setEditingOrderIdx(null);
      setEditError(null);
      setTimeout(() => fetchOpenOrders(), 500);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Modify failed");
    } finally {
      setEditSubmitting(false);
    }
  }, [editQty, editLmtPrice, fetchOpenOrders]);

  /** Get open orders for a specific underlying symbol */
  const ordersForTicker = useCallback((ticker: string) => {
    return openOrders.filter((o) => {
      const sym = o.contract?.symbol?.toUpperCase() || "";
      return sym === ticker.toUpperCase();
    });
  }, [openOrders]);

  const [krjSignals, setKrjSignals] = useState<Record<string, "Long" | "Short" | "Neutral" | null>>({});
  const [requestingSignalTicker, setRequestingSignalTicker] = useState<string | null>(null);
  const [requestSignalError, setRequestSignalError] = useState<Record<string, string>>({});
  // Stock quotes per group key (underlying ticker); null = not fetched, { price, timestamp } or { error }
  const [quotes, setQuotes] = useState<Record<string, { price: number; timestamp: string } | { error: string } | null>>({});
  const [quoteLoading, setQuoteLoading] = useState<Record<string, boolean>>({});

  const fetchQuote = useCallback(async (ticker: string) => {
    const key = ticker.toUpperCase();
    setQuoteLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch("/api/ma-options/stock-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: key }),
        credentials: "include",
      });
      // Guard against non-JSON responses (e.g. auth redirect returning HTML)
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        setQuotes((prev) => ({ ...prev, [key]: { error: `Could not get price for ${key}` } }));
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setQuotes((prev) => ({ ...prev, [key]: { error: data?.error || "Failed to fetch quote" } }));
        return;
      }
      setQuotes((prev) => ({
        ...prev,
        [key]: { price: data.price, timestamp: data.timestamp || new Date().toISOString() },
      }));
    } catch (e) {
      setQuotes((prev) => ({ ...prev, [key]: { error: e instanceof Error ? e.message : "Failed to fetch quote" } }));
    } finally {
      setQuoteLoading((prev) => ({ ...prev, [key]: false }));
    }
  }, []);

  /** Fetch live quotes for all legs (options + stock) in a position group. */
  const fetchGroupPrices = useCallback(async (groupKey: string, rows: IBPositionRow[]) => {
    setLegPricesLoading((prev) => ({ ...prev, [groupKey]: true }));
    const ticker = groupKey.split(" ")[0]?.toUpperCase() ?? groupKey;

    // Refresh stock quote (for STK legs and header Last trade display)
    fetchQuote(ticker);

    // Batch-fetch option leg prices
    const optRows = rows.filter(
      (r) =>
        r.contract?.secType === "OPT" &&
        r.contract?.lastTradeDateOrContractMonth &&
        r.contract?.strike != null &&
        r.contract?.right
    );
    if (optRows.length === 0) {
      setLegPricesLoading((prev) => ({ ...prev, [groupKey]: false }));
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
      }
    } catch {
      // silently fail - prices just won't update
    } finally {
      setLegPricesLoading((prev) => ({ ...prev, [groupKey]: false }));
    }
  }, [fetchQuote]);

  // ---- Unified trade ticket state (stocks AND options) ----
  type StockOrderType = "LMT" | "STP LMT" | "MOC";
  type StockOrderTif = "DAY" | "GTC";
  const [stockOrderKey, setStockOrderKey] = useState<string | null>(null); // group key
  const [stockOrderAction, setStockOrderAction] = useState<"BUY" | "SELL">("BUY");
  const [stockOrderType, setStockOrderType] = useState<StockOrderType>("LMT");
  const [stockOrderTif, setStockOrderTif] = useState<StockOrderTif>("DAY");
  const [stockOrderQty, setStockOrderQty] = useState("");
  const [stockOrderLmtPrice, setStockOrderLmtPrice] = useState("");
  const [stockOrderStopPrice, setStockOrderStopPrice] = useState("");
  const [stockOrderAccount, setStockOrderAccount] = useState("");
  const [stockOrderSubmitting, setStockOrderSubmitting] = useState(false);
  const [stockOrderResult, setStockOrderResult] = useState<{ orderId?: number; status?: string; error?: string } | null>(null);
  const [stockOrderStkPosition, setStockOrderStkPosition] = useState(0); // absolute position for quick-fill
  const [stockOrderDeltaSign, setStockOrderDeltaSign] = useState<1 | -1>(1); // +/- toggle for delta buttons
  const [stockOrderQuoteRefreshing, setStockOrderQuoteRefreshing] = useState(false);
  const [stockOrderTicker, setStockOrderTicker] = useState(""); // underlying ticker for open ticket
  const stockOrderPriceInitRef = useRef(false); // track whether we've auto-filled price
  // Option-specific fields (used when ticketSecType === "OPT")
  const [ticketSecType, setTicketSecType] = useState<"STK" | "OPT">("STK");
  const [ticketExpiry, setTicketExpiry] = useState("");
  const [ticketStrike, setTicketStrike] = useState<number>(0);
  const [ticketRight, setTicketRight] = useState<"C" | "P">("C");

  // ---- Dev stress test toggle (positions table + ticket) ----
  const [devStressTest, setDevStressTest] = useState(false);

  /** Open the unified trade ticket for a stock or option.
   *  If a specific position row is given, defaults to exit that position.
   *  Otherwise defaults to STK trade. */
  const openTradeTicket = useCallback((groupKey: string, group: GroupAggregate, row?: IBPositionRow) => {
    const ticker = groupKey.split(" ")[0]?.toUpperCase() ?? groupKey;
    const q = quotes[ticker];
    const spotPrice = q && "price" in q ? q.price.toFixed(2) : "";

    const isOpt = row ? row.contract?.secType === "OPT" : false;
    const posQty = row ? row.position : (() => {
      let s = 0; for (const r of group.rows) { if (r.contract?.secType === "STK") s += r.position; } return s;
    })();
    // Exit direction: if long → SELL, if short → BUY, if flat → BUY
    const exitAction: "BUY" | "SELL" = posQty > 0 ? "SELL" : "BUY";
    const absPos = Math.abs(posQty);

    // Price: for options use legPrices mid, for stocks use spot quote
    let initPrice = spotPrice;
    if (isOpt && row) {
      const lp = legPrices[legKey(row)];
      if (lp?.mid) initPrice = lp.mid.toFixed(2);
      else if (lp?.last) initPrice = lp.last.toFixed(2);
    }

    setStockOrderKey(groupKey);
    setStockOrderTicker(ticker);
    setTicketSecType(isOpt ? "OPT" : "STK");
    setStockOrderAction(exitAction);
    setStockOrderType("LMT");
    setStockOrderTif("DAY");
    setStockOrderQty(absPos > 0 ? String(absPos) : "");
    setStockOrderLmtPrice(initPrice);
    setStockOrderStopPrice(initPrice);
    setStockOrderDeltaSign(1);
    setStockOrderStkPosition(absPos);

    // Option fields
    if (isOpt && row) {
      setTicketExpiry(row.contract.lastTradeDateOrContractMonth || "");
      setTicketStrike(row.contract.strike || 0);
      setTicketRight((row.contract.right || "C") as "C" | "P");
    } else {
      setTicketExpiry("");
      setTicketStrike(0);
      setTicketRight("C");
    }

    // If no price yet, fetch a fresh quote
    if (initPrice) {
      stockOrderPriceInitRef.current = true;
    } else {
      stockOrderPriceInitRef.current = false;
      fetchQuote(ticker);
    }
    const acct = row?.account || group.rows[0]?.account || data?.accounts?.[0] || "";
    setStockOrderAccount(acct);
    setStockOrderSubmitting(false);
    setStockOrderResult(null);
  }, [quotes, data, fetchQuote, legPrices]);

  /** Open trade ticket from a scan result contract */
  const openTradeTicketForScan = useCallback((groupKey: string, group: GroupAggregate, c: SellScanContract, action: "BUY" | "SELL") => {
    const ticker = groupKey.split(" ")[0]?.toUpperCase() ?? groupKey;
    const q = quotes[ticker];
    const spotPrice = q && "price" in q ? q.price.toFixed(2) : "";
    const initPrice = c.mid ? c.mid.toFixed(2) : (c.last ? c.last.toFixed(2) : spotPrice);

    setStockOrderKey(groupKey);
    setStockOrderTicker(ticker);
    setTicketSecType("OPT");
    setStockOrderAction(action);
    setStockOrderType("LMT");
    setStockOrderTif("DAY");
    setStockOrderQty("");
    setStockOrderLmtPrice(initPrice);
    setStockOrderStopPrice(initPrice);
    setStockOrderDeltaSign(1);
    setStockOrderStkPosition(0);
    setTicketExpiry(c.expiry);
    setTicketStrike(c.strike);
    setTicketRight(c.right as "C" | "P");

    if (initPrice) {
      stockOrderPriceInitRef.current = true;
    } else {
      stockOrderPriceInitRef.current = false;
      fetchQuote(ticker);
    }
    const acct = group.rows[0]?.account || data?.accounts?.[0] || "";
    setStockOrderAccount(acct);
    setStockOrderSubmitting(false);
    setStockOrderResult(null);
  }, [quotes, data, fetchQuote]);

  const closeStockOrder = useCallback(() => {
    setStockOrderKey(null);
    setStockOrderResult(null);
    stockOrderPriceInitRef.current = false;
  }, []);

  // Auto-fill limit price when a fresh quote arrives for the open order ticket
  useEffect(() => {
    if (!stockOrderTicker || !stockOrderKey) return;
    if (stockOrderPriceInitRef.current) return; // already initialized
    const q = quotes[stockOrderTicker];
    if (q && "price" in q) {
      setStockOrderLmtPrice(q.price.toFixed(2));
      setStockOrderStopPrice(q.price.toFixed(2));
      stockOrderPriceInitRef.current = true;
    }
  }, [quotes, stockOrderTicker, stockOrderKey]);

  const submitStockOrder = useCallback(async () => {
    if (!stockOrderKey) return;
    const ticker = stockOrderKey.split(" ")[0]?.toUpperCase() ?? stockOrderKey;
    const qty = parseFloat(stockOrderQty);
    if (!qty || qty <= 0) { setStockOrderResult({ error: "Enter a valid quantity" }); return; }
    if (stockOrderType !== "MOC" && (!stockOrderLmtPrice || parseFloat(stockOrderLmtPrice) <= 0)) {
      setStockOrderResult({ error: "Enter a valid limit price" }); return;
    }
    if (stockOrderType === "STP LMT" && (!stockOrderStopPrice || parseFloat(stockOrderStopPrice) <= 0)) {
      setStockOrderResult({ error: "Enter a valid stop price" }); return;
    }
    setStockOrderSubmitting(true);
    setStockOrderResult(null);
    try {
      const contract: Record<string, unknown> = {
        symbol: ticker,
        secType: ticketSecType,
        exchange: "SMART",
        currency: "USD",
      };
      if (ticketSecType === "OPT") {
        contract.lastTradeDateOrContractMonth = ticketExpiry;
        contract.strike = ticketStrike;
        contract.right = ticketRight;
        contract.multiplier = "100";
      }
      const order: Record<string, unknown> = {
        action: stockOrderAction,
        totalQuantity: qty,
        orderType: stockOrderType,
        tif: stockOrderTif,
        transmit: true,
      };
      if (stockOrderAccount) order.account = stockOrderAccount;
      if (stockOrderType === "LMT" || stockOrderType === "STP LMT") {
        order.lmtPrice = parseFloat(stockOrderLmtPrice);
      }
      if (stockOrderType === "STP LMT") {
        order.auxPrice = parseFloat(stockOrderStopPrice);
      }
      const res = await fetch("/api/ib-connection/place-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract, order, timeout_sec: 15 }),
        credentials: "include",
      });
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        setStockOrderResult({ error: "Server returned unexpected response" });
        return;
      }
      const json = await res.json();
      if (!res.ok || json.error) {
        setStockOrderResult({ error: json.error || `Order failed: ${res.status}` });
      } else {
        setStockOrderResult({ orderId: json.orderId, status: json.status });
        // Refresh open orders after successful placement
        setTimeout(() => fetchOpenOrders(), 500);
      }
    } catch (e) {
      setStockOrderResult({ error: e instanceof Error ? e.message : "Order failed" });
    } finally {
      setStockOrderSubmitting(false);
    }
  }, [stockOrderKey, stockOrderAction, stockOrderType, stockOrderTif, stockOrderQty, stockOrderLmtPrice, stockOrderStopPrice, stockOrderAccount, ticketSecType, ticketExpiry, ticketStrike, ticketRight, fetchOpenOrders]);

  // Manual tickers (position boxes without an IB position); persisted in user preferences
  const [manualTickers, setManualTickers] = useState<ManualTickerEntry[]>([]);
  const manualTickersAppliedRef = useRef(false);
  const manualTickersLoadedRef = useRef(false);
  // Add-ticker modal: same SEC EDGAR validation as Curate tab
  const [addTickerOpen, setAddTickerOpen] = useState(false);
  const [addTickerInput, setAddTickerInput] = useState("");
  const [addTickerName, setAddTickerName] = useState("");
  const [addTickerSuggestions, setAddTickerSuggestions] = useState<TickerMatch[]>([]);
  const [addTickerShowSuggestions, setAddTickerShowSuggestions] = useState(false);
  const [addTickerSearching, setAddTickerSearching] = useState(false);
  const [addTickerError, setAddTickerError] = useState<string | null>(null);
  const [addTickerSubmitting, setAddTickerSubmitting] = useState(false);
  const addTickerInputRef = useRef<HTMLInputElement>(null);
  const addTickerSuggestionsRef = useRef<HTMLDivElement>(null);

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

  const runSellScan = useCallback(async (groupKey: string, right: "C" | "P") => {
    const ticker = groupKey.split(" ")[0]?.toUpperCase() ?? groupKey;
    setSellScanGroupKey(groupKey);
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

  /** Underlying ticker for a group key (e.g. AAPL or SPCE 250117). */
  const underlyingTickerForGroupKey = useCallback((key: string) => key.split(" ")[0]?.toUpperCase() ?? key, []);

  // Add-ticker modal: close suggestions on click outside
  useEffect(() => {
    if (!addTickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        addTickerSuggestionsRef.current &&
        !addTickerSuggestionsRef.current.contains(e.target as Node) &&
        addTickerInputRef.current &&
        !addTickerInputRef.current.contains(e.target as Node)
      ) {
        setAddTickerShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [addTickerOpen]);

  // Add-ticker modal: debounced SEC ticker lookup (same as Curate tab)
  useEffect(() => {
    if (!addTickerOpen || !addTickerInput.trim()) {
      setAddTickerSuggestions([]);
      setAddTickerShowSuggestions(false);
      return;
    }
    const t = setTimeout(async () => {
      setAddTickerSearching(true);
      try {
        const res = await fetch(`/api/ticker-lookup?q=${encodeURIComponent(addTickerInput.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setAddTickerSuggestions(data.matches || []);
          setAddTickerShowSuggestions((data.matches?.length ?? 0) > 0);
        }
      } catch {
        setAddTickerSuggestions([]);
      } finally {
        setAddTickerSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [addTickerOpen, addTickerInput]);

  const handleAddTickerSelectSuggestion = useCallback((m: TickerMatch) => {
    setAddTickerInput(m.ticker);
    setAddTickerName(m.name);
    setAddTickerShowSuggestions(false);
    setAddTickerError(null);
  }, []);

  const handleAddTickerConfirm = useCallback(async () => {
    const ticker = addTickerInput.trim().toUpperCase();
    if (!ticker) {
      setAddTickerError("Enter a ticker symbol");
      return;
    }
    setAddTickerError(null);
    setAddTickerSubmitting(true);
    try {
      // Validate via SEC: exact ticker match (user must select from dropdown or we require one exact match)
      const res = await fetch(`/api/ticker-lookup?q=${encodeURIComponent(ticker)}`);
      if (!res.ok) throw new Error("Lookup failed");
      const data = await res.json();
      const matches: TickerMatch[] = data.matches || [];
      const exact = matches.find((m: TickerMatch) => m.ticker.toUpperCase() === ticker);
      if (!exact) {
        setAddTickerError("Ticker not found in SEC EDGAR. Type a few letters and pick from the list.");
        setAddTickerSubmitting(false);
        return;
      }
      const name = addTickerName.trim() || exact.name;
      if (manualTickers.some((m) => m.ticker.toUpperCase() === ticker)) {
        setAddTickerError("This ticker is already in your list.");
        setAddTickerSubmitting(false);
        return;
      }
      const next = [...manualTickers, { ticker, name }].sort((a, b) => a.ticker.localeCompare(b.ticker));
      setManualTickers(next);
      setSelectedTickers((prev) => new Set([...prev, ticker]));
      setAddTickerOpen(false);
      setAddTickerInput("");
      setAddTickerName("");
      setAddTickerSuggestions([]);
      fetchQuote(ticker);
    } catch {
      setAddTickerError("Could not validate ticker. Try again.");
    } finally {
      setAddTickerSubmitting(false);
    }
  }, [addTickerInput, addTickerName, manualTickers, fetchQuote]);

  const removeManualTicker = useCallback((ticker: string) => {
    const key = ticker.toUpperCase();
    setManualTickers((prev) => prev.filter((m) => m.ticker.toUpperCase() !== key));
    setSelectedTickers((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);


  useEffect(() => {
    fetchPositions();
    fetchOpenOrders();
  }, [fetchPositions, fetchOpenOrders]);

  useEffect(() => {
    if (!autoRefresh || !isConnected) return;
    const interval = setInterval(() => { fetchPositions(); fetchOpenOrders(); }, 60000);
    return () => clearInterval(interval);
  }, [autoRefresh, isConnected, fetchPositions, fetchOpenOrders]);

  // Load saved position ticker selection and manual tickers from user preferences
  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/preferences", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((prefs) => {
        if (cancelled || !prefs?.maOptionsPrefs) return;
        const tickers = prefs.maOptionsPrefs.positionsSelectedTickers;
        if (Array.isArray(tickers)) setSavedPositionsTickers(tickers);
        else setSavedPositionsTickers(null);
        const manual = prefs.maOptionsPrefs.positionsManualTickers;
        if (Array.isArray(manual)) {
          setManualTickers(
            manual.filter(
              (m: unknown) =>
                typeof m === "object" &&
                m !== null &&
                typeof (m as ManualTickerEntry).ticker === "string"
            ) as ManualTickerEntry[]
          );
        }
        manualTickersLoadedRef.current = true;
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
  const positionGroups = computeGroups(filteredPositions);
  const positionGroupKeys = useMemo(() => new Set(positionGroups.map((g) => g.key)), [positionGroups]);
  // Merge manual tickers that don't already have a position group (e.g. AAPL with no position still shows as manual box)
  const groups = useMemo(() => {
    const manualOnly = manualTickers.filter((m) => !positionGroupKeys.has(m.ticker));
    const synthetic = manualOnly.map((m) => syntheticGroup(m.ticker));
    return [...positionGroups, ...synthetic].sort((a, b) => a.key.localeCompare(b.key));
  }, [positionGroups, positionGroupKeys, manualTickers]);
  const groupKeysSignature = useMemo(
    () => groups.map((g) => g.key).sort().join(","),
    [groups]
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

  // Apply saved ticker selection once when we have groups and preferences (e.g. after hard refresh)
  useEffect(() => {
    if (groups.length === 0 || savedPositionsTickers === null || appliedSavedPositionsRef.current) return;
    const validKeys = new Set(groups.map((g) => g.key));
    const toSelect = savedPositionsTickers.filter((k) => validKeys.has(k));
    if (toSelect.length > 0) setSelectedTickers(new Set(toSelect));
    appliedSavedPositionsRef.current = true;
  }, [groups, savedPositionsTickers]);

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

  // Persist selected tickers to user preferences (debounced)
  useEffect(() => {
    if (!appliedSavedPositionsRef.current) return;
    const tickers = [...selectedTickers];
    const timeoutId = setTimeout(() => {
      fetch("/api/user/preferences", { credentials: "include" })
        .then((res) => (res.ok ? res.json() : null))
        .then((prefs) => {
          if (!prefs) return;
          const maOptionsPrefs = { ...(prefs.maOptionsPrefs || {}), positionsSelectedTickers: tickers };
          return fetch("/api/user/preferences", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ maOptionsPrefs }),
          });
        })
        .catch(() => {});
    }, 600);
    return () => clearTimeout(timeoutId);
  }, [selectedTickers]);

  // Persist manual tickers when they change (only after we've loaded prefs so we don't overwrite)
  useEffect(() => {
    if (!manualTickersLoadedRef.current) return;
    fetch("/api/user/preferences", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((prefs) => {
        if (!prefs) return;
        const maOptionsPrefs = { ...(prefs.maOptionsPrefs || {}), positionsManualTickers: manualTickers };
        return fetch("/api/user/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ maOptionsPrefs }),
        });
      })
      .catch(() => {});
  }, [manualTickers]);

  const selectedGroups = groups.filter((g) => selectedTickers.has(g.key));
  const manualTickerNames = useMemo(
    () => Object.fromEntries(manualTickers.map((m) => [m.ticker.toUpperCase(), m.name || ""])),
    [manualTickers]
  );
  const selectedGroupKeysSig = useMemo(
    () => [...selectedTickers].sort().join(","),
    [selectedTickers]
  );

  // Fetch stock quote for each selected group's underlying ticker when first shown (page load or new box)
  useEffect(() => {
    if (selectedGroups.length === 0) return;
    const tickers = [...new Set(selectedGroups.map((g) => underlyingTickerForGroupKey(g.key)).filter(Boolean))];
    for (const ticker of tickers) {
      if (quotes[ticker] === undefined) fetchQuote(ticker);
    }
  }, [selectedGroupKeysSig, quotes, fetchQuote, underlyingTickerForGroupKey]);

  // Auto-fetch leg prices when a position box is first shown
  useEffect(() => {
    if (selectedGroups.length === 0) return;
    for (const group of selectedGroups) {
      if (
        !autoFetchedLegPricesRef.current.has(group.key) &&
        group.rows.length > 0
      ) {
        autoFetchedLegPricesRef.current.add(group.key);
        fetchGroupPrices(group.key, group.rows);
      }
    }
  }, [selectedGroupKeysSig, selectedGroups, fetchGroupPrices]);

  // Fetch KRJ signal for selected tickers (underlying symbol: first token of group.key)
  useEffect(() => {
    if (selectedGroups.length === 0) {
      setKrjSignals({});
      return;
    }
    const underlyingTickers = [...new Set(selectedGroups.map((g) => g.key.split(" ")[0]).filter(Boolean))];
    const q = new URLSearchParams({ tickers: underlyingTickers.join(",") });
    fetch(`/api/krj/signals?${q}`, { credentials: "include" })
      .then((res) => res.json())
      .then((data: { signals?: Record<string, "Long" | "Short" | "Neutral"> }) => {
        const signals = data.signals ?? {};
        const byGroupKey: Record<string, "Long" | "Short" | "Neutral" | null> = {};
        for (const g of selectedGroups) {
          const underlying = g.key.split(" ")[0]?.toUpperCase() ?? "";
          byGroupKey[g.key] = underlying && signals[underlying] ? signals[underlying] : null;
        }
        setKrjSignals(byGroupKey);
      })
      .catch(() => setKrjSignals({}));
  }, [selectedGroupKeysSig]);

  /** Request on-demand KRJ signal for a ticker missing from the weekly batch. */
  const handleRequestSignal = useCallback(async (groupKey: string) => {
    const ticker = groupKey.split(" ")[0]?.trim().toUpperCase();
    if (!ticker) return;
    setRequestSignalError((prev) => { const next = { ...prev }; delete next[ticker]; return next; });
    setRequestingSignalTicker(ticker);
    try {
      const res = await fetch("/api/krj/signals/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ticker }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Request failed");
      // Update the local signal state with the returned signal value
      const signal = data?.row?.signal as "Long" | "Short" | "Neutral" | undefined;
      if (signal) {
        setKrjSignals((prev) => {
          const next = { ...prev };
          // Update all group keys that share this underlying ticker
          for (const key of Object.keys(next)) {
            if (key.split(" ")[0]?.toUpperCase() === ticker) {
              next[key] = signal;
            }
          }
          // Also set for the current group key in case it wasn't in the map yet
          next[groupKey] = signal;
          return next;
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setRequestSignalError((prev) => ({ ...prev, [ticker]: msg }));
    } finally {
      setRequestingSignalTicker(null);
    }
  }, []);

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

      {/* ─── Working Orders section ─── */}
      <div className="rounded-lg border border-gray-600 bg-gray-800/80 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-600 bg-gray-800/60">
          <button
            type="button"
            onClick={() => setShowAllOrders((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-gray-200 hover:text-white"
          >
            <span className={`transition-transform ${showAllOrders ? "rotate-90" : ""}`}>&#9654;</span>
            Working Orders ({openOrders.length})
          </button>
          <button
            type="button"
            onClick={fetchOpenOrders}
            disabled={openOrdersLoading}
            className="min-h-[32px] px-3 py-1 rounded text-xs font-medium bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white"
          >
            {openOrdersLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {showAllOrders && (
          <div className="overflow-x-auto">
            {openOrdersError && (
              <div className="px-3 py-2 text-sm text-red-400">{openOrdersError}</div>
            )}
            {openOrders.length === 0 ? (
              <div className="px-3 py-3 text-sm text-gray-400">No working orders.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-700/50 text-gray-300 border-b border-gray-600">
                    <th className="text-left py-1.5 px-3">Account</th>
                    <th className="text-left py-1.5 px-3">Symbol</th>
                    <th className="text-left py-1.5 px-3">Type</th>
                    <th className="text-left py-1.5 px-3">Side</th>
                    <th className="text-right py-1.5 px-3">Qty</th>
                    <th className="text-left py-1.5 px-3">Price</th>
                    <th className="text-left py-1.5 px-3">TIF</th>
                    <th className="text-left py-1.5 px-3">Status</th>
                    <th className="text-center py-1.5 px-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {openOrders.map((o, oIdx) => {
                    const isEditing = editingOrderIdx === oIdx;
                    return (
                      <tr
                        key={`order-${oIdx}-${o.orderId}`}
                        className={`border-b border-gray-700/50 ${isEditing ? "bg-indigo-900/20" : "hover:bg-gray-700/30"}`}
                      >
                        <td className="py-1.5 px-3 text-gray-300">{getAccountLabel(o.order.account, userAlias)}</td>
                        <td className="py-1.5 px-3 text-gray-100 font-medium whitespace-nowrap">{displayOrderSymbol(o)}</td>
                        <td className="py-1.5 px-3 text-gray-400">{o.contract.secType}</td>
                        <td className={`py-1.5 px-3 font-semibold ${o.order.action === "BUY" ? "text-blue-400" : "text-red-400"}`}>
                          {o.order.action}
                        </td>
                        <td className="py-1.5 px-3 text-right tabular-nums text-gray-100">
                          {isEditing ? (
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={editQty}
                              onChange={(e) => setEditQty(e.target.value)}
                              className="w-16 px-1.5 py-0.5 rounded bg-gray-800 border border-indigo-500 text-white text-sm text-right tabular-nums focus:outline-none"
                            />
                          ) : (
                            o.order.totalQuantity
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-gray-200 tabular-nums whitespace-nowrap">
                          {isEditing && (o.order.orderType === "LMT" || o.order.orderType === "STP LMT") ? (
                            <div className="flex items-center gap-1">
                              <span className="text-gray-400 text-xs">{o.order.orderType === "STP LMT" ? "STP LMT" : "LMT"}</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={editLmtPrice}
                                onChange={(e) => setEditLmtPrice(e.target.value)}
                                className="w-20 px-1.5 py-0.5 rounded bg-gray-800 border border-indigo-500 text-white text-sm text-right tabular-nums focus:outline-none"
                              />
                            </div>
                          ) : (
                            formatOrderPrice(o)
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-gray-400">{o.order.tif}</td>
                        <td className="py-1.5 px-3">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                            o.orderState.status === "Submitted" || o.orderState.status === "PreSubmitted"
                              ? "bg-blue-900/60 text-blue-300"
                              : o.orderState.status === "Filled"
                                ? "bg-green-900/60 text-green-300"
                                : o.orderState.status === "Cancelled"
                                  ? "bg-gray-600/60 text-gray-300"
                                  : "bg-yellow-900/60 text-yellow-300"
                          }`}>
                            {o.orderState.status || "Unknown"}
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => submitModifyOrder(o)}
                                  disabled={editSubmitting}
                                  className="min-h-[28px] px-2 py-0.5 rounded text-xs font-medium bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white"
                                >
                                  {editSubmitting ? "…" : "Save"}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditOrder}
                                  disabled={editSubmitting}
                                  className="min-h-[28px] px-2 py-0.5 rounded text-xs font-medium bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white"
                                >
                                  Esc
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => startEditOrder(o, oIdx)}
                                  className="min-h-[28px] px-2 py-0.5 rounded text-xs font-medium bg-indigo-800 hover:bg-indigo-700 text-white"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => cancelOrder(o.orderId)}
                                  disabled={cancellingOrderId === o.orderId}
                                  className="min-h-[28px] px-2 py-0.5 rounded text-xs font-medium bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white"
                                >
                                  {cancellingOrderId === o.orderId ? "…" : "Cancel"}
                                </button>
                              </>
                            )}
                          </div>
                          {isEditing && editError && (
                            <div className="text-xs text-red-400 mt-1">{editError}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
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
              <div className="px-3 py-2 border-b border-gray-600 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-gray-200">Tickers ({groups.length})</span>
                <button
                  type="button"
                  onClick={() => {
                    setAddTickerOpen(true);
                    setAddTickerInput("");
                    setAddTickerName("");
                    setAddTickerError(null);
                    setTimeout(() => addTickerInputRef.current?.focus(), 100);
                  }}
                  className="shrink-0 min-h-[40px] px-3 py-1.5 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white"
                >
                  + Add ticker
                </button>
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
              {Object.keys(requestSignalError).length > 0 && (
                <div className="mb-2 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded px-2 py-1 space-y-0.5">
                  {Object.entries(requestSignalError).map(([ticker, msg]) => (
                    <div key={ticker}><span className="font-medium">{ticker}:</span> {msg}</div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 content-start">
                {selectedGroups.length === 0 ? (
                  <div className="col-span-2 rounded-lg border border-gray-600 bg-gray-800/50 px-4 py-8 text-center text-base text-gray-400">
                    Select one or more tickers from the list to see details.
                  </div>
                ) : (
                  selectedGroups.map((group, idx) => {
                    const accent = accentColors[idx % accentColors.length];
                    const headerAccent = headerAccents[idx % headerAccents.length];
                    const underlyingTicker = underlyingTickerForGroupKey(group.key);
                    const quote = quotes[underlyingTicker];
                    const quoteLoadingThis = quoteLoading[underlyingTicker];
                    const companyName = group.isManual ? manualTickerNames[group.key] : null;
                    const isLegLoading = legPricesLoading[group.key] ?? false;

                    // Per-row live price lookup
                    const getRowLastPrice = (row: IBPositionRow): number | null => {
                      if (row.contract?.secType === "STK") {
                        return quote && "price" in quote ? quote.price : null;
                      }
                      const lp = legPrices[legKey(row)];
                      return lp ? lp.mid : null;
                    };

                    // Compute group-level market value and P&L
                    // Option lastPrice is per-share; multiply by contract multiplier (100)
                    let groupMktVal = 0;
                    let groupHasAnyPrice = false;
                    for (const row of group.rows) {
                      const price = getRowLastPrice(row);
                      if (price != null) {
                        groupMktVal += row.position * price * getMultiplier(row);
                        groupHasAnyPrice = true;
                      }
                    }
                    const groupPnl = groupHasAnyPrice ? groupMktVal - group.costBasis : null;

                    return (
                      <div
                        key={`group-${group.key}`}
                        className={`rounded-lg border border-gray-600 overflow-hidden border-l-4 ${accent}`}
                      >
                        <div
                          className={`flex flex-col gap-1.5 px-4 py-3 border-b border-gray-600 ${headerAccent}`}
                        >
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-xl font-bold text-white tracking-tight">
                              {group.key}
                            </span>
                            {companyName && (
                              <span className="text-sm text-gray-400 truncate max-w-[200px]" title={companyName}>
                                {companyName}
                              </span>
                            )}
                            {krjSignals[group.key] != null ? (
                              <span
                                className={`text-sm font-medium px-2 py-0.5 rounded ${
                                  krjSignals[group.key] === "Long"
                                    ? "bg-blue-900/60 text-blue-200"
                                    : krjSignals[group.key] === "Short"
                                      ? "bg-red-900/60 text-red-200"
                                      : "bg-gray-600/60 text-gray-200"
                                }`}
                                title="KRJ weekly signal"
                              >
                                KRJ: {krjSignals[group.key]}
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={requestingSignalTicker === group.key.split(" ")[0]?.toUpperCase()}
                                onClick={(e) => { e.stopPropagation(); handleRequestSignal(group.key); }}
                                className="text-xs font-medium px-2 py-0.5 rounded bg-gray-700/40 text-gray-400 hover:bg-gray-600 hover:text-gray-200 disabled:opacity-50 disabled:cursor-wait transition-colors"
                                title="Request KRJ signal for this ticker"
                              >
                                {requestingSignalTicker === group.key.split(" ")[0]?.toUpperCase() ? (
                                  <span className="flex items-center gap-1">
                                    <span className="w-3 h-3 border-2 border-gray-500 border-t-blue-400 rounded-full animate-spin inline-block" />
                                    Requesting…
                                  </span>
                                ) : (
                                  "Request KRJ signal"
                                )}
                              </button>
                            )}
                            {group.isManual && (
                              <button
                                type="button"
                                onClick={() => removeManualTicker(group.key)}
                                className="ml-auto text-xs text-gray-400 hover:text-red-400"
                                title="Remove from list"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-200">
                            <span>
                              {Object.keys(group.typeCounts).length > 0
                                ? Object.entries(group.typeCounts).map(([t, n]) => `${t} ${n}`).join(", ")
                                : "No position"}
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
                            {groupPnl != null && (
                              <span className={`tabular-nums font-semibold whitespace-nowrap ${groupPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                                P&L: {formatPnl(groupPnl)}
                                {group.costBasis !== 0 && (
                                  <span className="text-xs ml-1 opacity-75">
                                    ({((groupPnl / Math.abs(group.costBasis)) * 100).toFixed(1)}%)
                                  </span>
                                )}
                              </span>
                            )}
                            <span className="tabular-nums text-gray-300">
                              Last trade:{" "}
                              {quoteLoadingThis
                                ? "…"
                                : quote && "price" in quote
                                  ? `$${quote.price.toFixed(2)}`
                                  : quote && "error" in quote
                                    ? quote.error
                                    : "—"}
                            </span>
                            <button
                              type="button"
                              onClick={() => fetchGroupPrices(group.key, group.rows)}
                              disabled={isLegLoading || quoteLoadingThis}
                              className="min-h-[32px] px-2 py-1 rounded text-xs font-medium bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white"
                            >
                              {isLegLoading ? "Loading…" : "Refresh quotes"}
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-2 mt-2">
                            <button
                              type="button"
                              onClick={() => runSellScan(group.key, "C")}
                              disabled={sellScanLoading}
                              className="min-h-[44px] px-4 py-2.5 rounded-lg text-base font-medium bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white"
                            >
                              Scan calls
                            </button>
                            <button
                              type="button"
                              onClick={() => runSellScan(group.key, "P")}
                              disabled={sellScanLoading}
                              className="min-h-[44px] px-4 py-2.5 rounded-lg text-base font-medium bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white"
                            >
                              Scan puts
                            </button>
                            <button
                              type="button"
                              onClick={() => openTradeTicket(group.key, group)}
                              className="min-h-[44px] px-4 py-2.5 rounded-lg text-base font-bold bg-gray-600 hover:bg-gray-500 text-white"
                            >
                              Trade stock
                            </button>
                          </div>
                          {/* ---- Per-position working orders ---- */}
                          {(() => {
                            const tickerOrders = ordersForTicker(underlyingTicker);
                            if (tickerOrders.length === 0) return null;
                            const boxOpen = collapsedBoxOrders[group.key] !== true;
                            return (
                              <div className="mt-2 rounded border border-gray-600/60 bg-gray-900/40 overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() => setCollapsedBoxOrders((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-300 bg-amber-900/20 border-b border-gray-600/40 hover:bg-amber-900/30"
                                >
                                  <span className={`transition-transform text-[10px] ${boxOpen ? "rotate-90" : ""}`}>&#9654;</span>
                                  Working Orders ({tickerOrders.length})
                                </button>
                                {boxOpen && tickerOrders.map((o) => {
                                  const globalIdx = openOrders.indexOf(o);
                                  const isEd = editingOrderIdx === globalIdx;
                                  return (
                                  <div
                                    key={`ticker-order-${globalIdx}-${o.orderId}`}
                                    className={`flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-gray-700/30 text-xs last:border-b-0 ${isEd ? "bg-indigo-900/20" : ""}`}
                                  >
                                    <span className={`font-semibold ${o.order.action === "BUY" ? "text-blue-400" : "text-red-400"}`}>
                                      {o.order.action}
                                    </span>
                                    {isEd ? (
                                      <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={editQty}
                                        onChange={(e) => setEditQty(e.target.value)}
                                        className="w-14 px-1 py-0.5 rounded bg-gray-800 border border-indigo-500 text-white text-xs text-right tabular-nums focus:outline-none"
                                      />
                                    ) : (
                                      <span className="tabular-nums text-gray-100">{o.order.totalQuantity}</span>
                                    )}
                                    <span className="text-gray-300 truncate max-w-[120px]" title={displayOrderSymbol(o)}>
                                      {o.contract.secType === "STK" ? "STK" : displayOrderSymbol(o)}
                                    </span>
                                    {isEd && (o.order.orderType === "LMT" || o.order.orderType === "STP LMT") ? (
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={editLmtPrice}
                                        onChange={(e) => setEditLmtPrice(e.target.value)}
                                        className="w-16 px-1 py-0.5 rounded bg-gray-800 border border-indigo-500 text-white text-xs text-right tabular-nums focus:outline-none"
                                      />
                                    ) : (
                                      <span className="tabular-nums text-gray-200">{formatOrderPrice(o)}</span>
                                    )}
                                    <span className="text-gray-500">{o.order.tif}</span>
                                    <span className={`px-1 py-0.5 rounded text-xs ${
                                      o.orderState.status === "Submitted" || o.orderState.status === "PreSubmitted"
                                        ? "bg-blue-900/40 text-blue-300"
                                        : "bg-yellow-900/40 text-yellow-300"
                                    }`}>
                                      {o.orderState.status}
                                    </span>
                                    <div className="ml-auto flex items-center gap-1">
                                      {isEd ? (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => submitModifyOrder(o)}
                                            disabled={editSubmitting}
                                            className="min-h-[24px] px-2 py-0.5 rounded text-xs font-medium bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white"
                                          >
                                            {editSubmitting ? "…" : "Save"}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={cancelEditOrder}
                                            disabled={editSubmitting}
                                            className="min-h-[24px] px-2 py-0.5 rounded text-xs font-medium bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white"
                                          >
                                            Esc
                                          </button>
                                        </>
                                      ) : (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => startEditOrder(o, globalIdx)}
                                            className="min-h-[24px] px-2 py-0.5 rounded text-xs font-medium bg-indigo-800/80 hover:bg-indigo-700 text-white"
                                          >
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => cancelOrder(o.orderId)}
                                            disabled={cancellingOrderId === o.orderId}
                                            className="min-h-[24px] px-2 py-0.5 rounded text-xs font-medium bg-red-800/80 hover:bg-red-700 disabled:opacity-50 text-white"
                                          >
                                            {cancellingOrderId === o.orderId ? "…" : "Cancel"}
                                          </button>
                                        </>
                                      )}
                                    </div>
                                    {isEd && editError && (
                                      <div className="w-full text-xs text-red-400 mt-0.5">{editError}</div>
                                    )}
                                  </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm table-fixed" style={{ minWidth: 860 }}>
                            <colgroup>
                              <col className="w-[90px]" />   {/* Account – truncate ok */}
                              <col />                         {/* Symbol – flex remaining */}
                              <col className="w-[52px]" />    {/* Type */}
                              <col className="w-[100px]" />   {/* Pos – handles ±999,999 */}
                              <col className="w-[110px]" />   {/* Avg cost – $99,999.99 */}
                              <col className="w-[90px]" />    {/* Last */}
                              <col className="w-[135px]" />   {/* Mkt val – ±$9,999,999 */}
                              <col className="w-[145px]" />   {/* P&L – ±$9,999,999.99 */}
                              <col className="w-[84px]" />    {/* Trade – min 44px button */}
                            </colgroup>
                            <thead>
                              <tr className="bg-gray-700/50 text-gray-200 text-sm border-b border-gray-600">
                                <th className="text-left py-2 px-2 whitespace-nowrap">Account</th>
                                <th className="text-left py-2 px-2 whitespace-nowrap">Symbol</th>
                                <th className="text-left py-2 px-2 whitespace-nowrap">Type</th>
                                <th className="text-right py-2 px-2 whitespace-nowrap">Pos</th>
                                <th className="text-right py-2 px-2 whitespace-nowrap">Avg cost</th>
                                <th className="text-right py-2 px-2 whitespace-nowrap">Last</th>
                                <th className="text-right py-2 px-2 whitespace-nowrap">Mkt val</th>
                                <th className="text-right py-2 px-2 whitespace-nowrap">P&L</th>
                                <th className="text-center py-2 px-1 whitespace-nowrap">Trade</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.rows.map((row, i) => {
                                const rowPrice = getRowLastPrice(row);
                                const rowMult = getMultiplier(row);
                                const rowCost = row.position * row.avgCost;
                                const rowMktVal = rowPrice != null ? row.position * rowPrice * rowMult : null;
                                const rowPnl = rowMktVal != null ? rowMktVal - rowCost : null;
                                return (
                                  <tr
                                    key={`${row.account}-${row.contract?.conId ?? i}-${row.contract?.localSymbol ?? row.contract?.symbol}`}
                                    className="border-b border-gray-700/50 hover:bg-gray-700/30"
                                  >
                                    <td className="py-2 px-2 text-gray-300 text-sm truncate whitespace-nowrap" title={getAccountLabel(row.account, userAlias)}>
                                      {getAccountLabel(row.account, userAlias)}
                                    </td>
                                    <td className="py-2 px-2 text-gray-100 text-sm font-medium truncate whitespace-nowrap" title={displaySymbol(row)}>
                                      {displaySymbol(row)}
                                    </td>
                                    <td className="py-2 px-2 text-gray-400 text-sm whitespace-nowrap">
                                      {row.contract?.secType ?? "—"}
                                    </td>
                                    <td className="py-2 px-2 text-right text-gray-100 tabular-nums text-sm font-medium whitespace-nowrap">
                                      {formatPosition(row.position)}
                                    </td>
                                    <td className="py-2 px-2 text-right text-gray-100 tabular-nums text-sm whitespace-nowrap">
                                      {formatAvgCost(row.avgCost)}
                                    </td>
                                    <td className="py-2 px-2 text-right tabular-nums text-sm text-gray-200 whitespace-nowrap">
                                      {isLegLoading ? "…" : rowPrice != null ? rowPrice.toFixed(2) : "—"}
                                    </td>
                                    <td className="py-2 px-2 text-right tabular-nums text-sm text-gray-100 whitespace-nowrap" title={rowMktVal != null ? formatCostBasis(rowMktVal) : undefined}>
                                      {rowMktVal != null ? formatCostBasis(rowMktVal) : "—"}
                                    </td>
                                    <td className={`py-2 px-2 text-right tabular-nums text-sm font-medium whitespace-nowrap ${
                                      rowPnl != null && rowPnl > 0
                                        ? "text-green-400"
                                        : rowPnl != null && rowPnl < 0
                                          ? "text-red-400"
                                          : "text-gray-400"
                                    }`} title={rowPnl != null ? formatPnl(rowPnl) : undefined}>
                                      {rowPnl != null ? formatPnl(rowPnl) : "—"}
                                    </td>
                                    <td className="py-1.5 px-1 text-center whitespace-nowrap">
                                      <button
                                        type="button"
                                        onClick={() => openTradeTicket(group.key, group, row)}
                                        className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-700 hover:bg-indigo-600 text-white whitespace-nowrap"
                                      >
                                        Trade
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            {groupHasAnyPrice && (
                              <tfoot>
                                <tr className="bg-gray-700/30 border-t border-gray-500 font-semibold text-sm">
                                  <td colSpan={5} className="py-2 px-2 text-right text-gray-300 whitespace-nowrap">Totals</td>
                                  <td className="py-2 px-2"></td>
                                  <td className="py-2 px-2 text-right tabular-nums text-white whitespace-nowrap">
                                    {formatCostBasis(groupMktVal)}
                                  </td>
                                  <td className={`py-2 px-2 text-right tabular-nums font-bold whitespace-nowrap ${
                                    groupPnl != null && groupPnl >= 0 ? "text-green-400" : "text-red-400"
                                  }`}>
                                    {groupPnl != null ? formatPnl(groupPnl) : "—"}
                                  </td>
                                  <td className="py-2 px-1"></td>
                                </tr>
                              </tfoot>
                            )}
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
        {process.env.NODE_ENV === "development" && (
          <button
            type="button"
            onClick={() => setDevStressTest((v) => !v)}
            className={`min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              devStressTest
                ? "bg-yellow-600 text-white ring-2 ring-yellow-400"
                : "bg-gray-700 hover:bg-gray-600 text-gray-300"
            }`}
          >
            {devStressTest ? "Stress ON" : "Stress Test"}
          </button>
        )}
      </div>

      {/* ── Dev stress test panel ── */}
      {devStressTest && (() => {
        const stressRows = [
          { label: "LONGTICKERXYZ", acct: "DU12345678", type: "STK", pos: 999999, avg: 99999.99, last: 101234.56, pnl: 1234567890.12 },
          { label: "MEGA 2025-12-19 999 C", acct: "U999888777", type: "OPT", pos: -100000, avg: 54321.99, last: 67890.12, pnl: -9876543.21 },
          { label: "T", acct: "DU1", type: "STK", pos: 1, avg: 0.01, last: 0.02, pnl: 0.01 },
          { label: "BRK.A", acct: "U127613", type: "STK", pos: 3, avg: 623456.78, last: 650000.00, pnl: 79630.66 },
          { label: "SPY 2026-01-16 580 P", acct: "DU12345678", type: "OPT", pos: 500, avg: 1234.56, last: 1500.00, pnl: 132720.00 },
        ];
        return (
          <div className="mt-4 p-3 rounded-lg border-2 border-yellow-600/50 bg-yellow-900/10">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-lg font-bold text-yellow-300">Stress Test: Extreme Values</span>
              <span className="text-sm text-gray-400">Table column sizing / overflow verification</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed" style={{ minWidth: 860 }}>
                <colgroup>
                  <col className="w-[90px]" />
                  <col />
                  <col className="w-[52px]" />
                  <col className="w-[100px]" />
                  <col className="w-[110px]" />
                  <col className="w-[90px]" />
                  <col className="w-[135px]" />
                  <col className="w-[145px]" />
                  <col className="w-[84px]" />
                </colgroup>
                <thead>
                  <tr className="bg-gray-700/50 text-gray-200 text-sm border-b border-gray-600">
                    <th className="text-left py-2 px-2 whitespace-nowrap">Account</th>
                    <th className="text-left py-2 px-2 whitespace-nowrap">Symbol</th>
                    <th className="text-left py-2 px-2 whitespace-nowrap">Type</th>
                    <th className="text-right py-2 px-2 whitespace-nowrap">Pos</th>
                    <th className="text-right py-2 px-2 whitespace-nowrap">Avg cost</th>
                    <th className="text-right py-2 px-2 whitespace-nowrap">Last</th>
                    <th className="text-right py-2 px-2 whitespace-nowrap">Mkt val</th>
                    <th className="text-right py-2 px-2 whitespace-nowrap">P&L</th>
                    <th className="text-center py-2 px-1 whitespace-nowrap">Trade</th>
                  </tr>
                </thead>
                <tbody>
                  {stressRows.map((r, i) => (
                    <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-2 px-2 text-gray-300 text-sm truncate whitespace-nowrap" title={r.acct}>{r.acct}</td>
                      <td className="py-2 px-2 text-gray-100 text-sm font-medium truncate whitespace-nowrap" title={r.label}>{r.label}</td>
                      <td className="py-2 px-2 text-gray-400 text-sm whitespace-nowrap">{r.type}</td>
                      <td className="py-2 px-2 text-right text-gray-100 tabular-nums text-sm font-medium whitespace-nowrap">{formatPosition(r.pos)}</td>
                      <td className="py-2 px-2 text-right text-gray-100 tabular-nums text-sm whitespace-nowrap">{formatAvgCost(r.avg)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-sm text-gray-200 whitespace-nowrap">{r.last.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-sm text-gray-100 whitespace-nowrap" title={formatCostBasis(r.pos * r.last)}>{formatCostBasis(r.pos * r.last)}</td>
                      <td className={`py-2 px-2 text-right tabular-nums text-sm font-medium whitespace-nowrap ${r.pnl > 0 ? "text-green-400" : r.pnl < 0 ? "text-red-400" : "text-gray-400"}`} title={formatPnl(r.pnl)}>{formatPnl(r.pnl)}</td>
                      <td className="py-1.5 px-1 text-center whitespace-nowrap">
                        <button type="button" className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-700 hover:bg-indigo-600 text-white whitespace-nowrap">Trade</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-700/30 border-t border-gray-500 font-semibold text-sm">
                    <td colSpan={5} className="py-2 px-2 text-right text-gray-300 whitespace-nowrap">Totals</td>
                    <td className="py-2 px-2"></td>
                    <td className="py-2 px-2 text-right tabular-nums text-white whitespace-nowrap">{formatCostBasis(stressRows.reduce((s, r) => s + r.pos * r.last, 0))}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-bold whitespace-nowrap text-green-400">{formatPnl(stressRows.reduce((s, r) => s + r.pnl, 0))}</td>
                    <td className="py-2 px-1"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="mt-3 p-2 rounded bg-gray-800 border border-gray-600">
              <p className="text-sm text-yellow-200 font-semibold mb-1">Ticket Stress Scenarios:</p>
              <ul className="text-xs text-gray-300 space-y-0.5 list-disc list-inside">
                <li>No position (posQty = 0): "= Pos" disabled, "Clear" works</li>
                <li>Small position (1 share): "= Pos (1)" sets qty to 1</li>
                <li>Huge position (999,999): "= Pos (999,999)" sets qty to 999999</li>
                <li>Short position: absPos used (e.g. -500 becomes 500 for quick-fill)</li>
                <li>Non-step-aligned (e.g. 137 shares): exact value used (no rounding needed for shares)</li>
              </ul>
            </div>
          </div>
        );
      })()}

      {/* Add ticker modal: SEC EDGAR validation, same as Curate tab */}
      {addTickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-ticker-title"
        >
          <div className="bg-gray-900 border border-gray-600 rounded-xl shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-gray-600">
              <h2 id="add-ticker-title" className="text-xl font-bold text-white">
                Add position box (no position required)
              </h2>
              <button
                type="button"
                onClick={() => {
                  setAddTickerOpen(false);
                  setAddTickerInput("");
                  setAddTickerName("");
                  setAddTickerError(null);
                }}
                className="min-h-[44px] min-w-[44px] px-4 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-base font-medium"
              >
                Close
              </button>
            </div>
            <div className="px-4 py-4 space-y-4">
              <p className="text-sm text-gray-400">
                Enter a ticker to create a position box and get a stock quote. Use the same SEC EDGAR validation as the Curate tab.
              </p>
              <div className="relative">
                <label className="block text-sm text-gray-400 mb-1">Ticker</label>
                <input
                  ref={addTickerInputRef}
                  type="text"
                  value={addTickerInput}
                  onChange={(e) => {
                    setAddTickerInput(e.target.value.toUpperCase());
                    setAddTickerError(null);
                  }}
                  onFocus={() => addTickerSuggestions.length > 0 && setAddTickerShowSuggestions(true)}
                  placeholder="e.g. AAPL"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-gray-100 focus:border-blue-500 focus:outline-none"
                  disabled={addTickerSubmitting}
                  autoComplete="off"
                />
                {addTickerSearching && (
                  <div className="absolute right-3 top-9 text-gray-400">
                    <div className="w-4 h-4 border-2 border-gray-500 border-t-blue-500 rounded-full animate-spin" />
                  </div>
                )}
                {addTickerShowSuggestions && addTickerSuggestions.length > 0 && (
                  <div
                    ref={addTickerSuggestionsRef}
                    className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg max-h-48 overflow-y-auto"
                  >
                    {addTickerSuggestions.map((m) => (
                      <button
                        key={m.ticker}
                        type="button"
                        onClick={() => handleAddTickerSelectSuggestion(m)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2"
                      >
                        <span className="font-mono text-blue-400 font-medium min-w-[56px]">{m.ticker}</span>
                        <span className="text-gray-300 truncate">{m.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Company name (from SEC)</label>
                <input
                  type="text"
                  value={addTickerName}
                  onChange={(e) => setAddTickerName(e.target.value)}
                  placeholder="Pick from list or type"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-gray-100 focus:border-blue-500 focus:outline-none"
                  disabled={addTickerSubmitting}
                />
              </div>
              {addTickerError && (
                <p className="text-sm text-red-400">{addTickerError}</p>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-600 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setAddTickerOpen(false);
                  setAddTickerInput("");
                  setAddTickerName("");
                  setAddTickerError(null);
                }}
                className="min-h-[44px] px-4 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddTickerConfirm}
                disabled={addTickerSubmitting}
                className="min-h-[44px] px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50"
              >
                {addTickerSubmitting ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Full-screen unified trade ticket overlay ---- */}
      {stockOrderKey != null && (() => {
        const posQty = stockOrderStkPosition;
        const tickerForQuote = stockOrderTicker;
        const liveQuote = quotes[tickerForQuote];
        const spotPrice = liveQuote && "price" in liveQuote ? liveQuote.price : null;
        const spotError = liveQuote && "error" in liveQuote ? liveQuote.error : null;
        const sign = stockOrderDeltaSign;
        const isOpt = ticketSecType === "OPT";
        const unitLabel = isOpt ? "contracts" : "shares";
        const costMultiplier = isOpt ? 100 : 1;
        // Qty delta values — smaller for options
        const qtyDeltas = isOpt ? [1, 2, 5, 10, 25, 50, 100] : [1, 5, 10, 25, 50, 100, 500, 1000];
        // Price delta values — smaller for options
        const priceDeltas = isOpt ? [0.01, 0.02, 0.05, 0.1, 0.25, 0.5] : [0.01, 0.05, 0.1, 0.5, 1, 10];
        const applyQtyDelta = (d: number) => {
          const cur = parseInt(stockOrderQty) || 0;
          setStockOrderQty(String(Math.max(0, cur + d * sign)));
        };
        const applyPriceDelta = (setter: (v: string) => void, current: string, d: number) => {
          const cur = parseFloat(current) || 0;
          setter(Math.max(0, cur + d * sign).toFixed(2));
        };
        return (
        <div className="fixed inset-0 z-50 bg-gray-950/95 overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget) closeStockOrder(); }}>
          <div className="max-w-6xl mx-auto px-5 py-4 min-h-screen flex flex-col">
            {/* ── Top bar: BUY/SELL toggle + contract info + spot + account + close ── */}
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              {/* BUY / SELL toggle */}
              <div className="flex rounded-xl overflow-hidden border border-gray-600">
                <button
                  type="button"
                  onClick={() => setStockOrderAction("BUY")}
                  className={`min-h-[52px] px-6 text-xl font-extrabold transition-colors ${
                    stockOrderAction === "BUY"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  BUY
                </button>
                <button
                  type="button"
                  onClick={() => setStockOrderAction("SELL")}
                  className={`min-h-[52px] px-6 text-xl font-extrabold transition-colors ${
                    stockOrderAction === "SELL"
                      ? "bg-red-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  SELL
                </button>
              </div>
              <span className="text-3xl font-extrabold text-white">
                {stockOrderTicker}
                {isOpt && (
                  <span className="text-2xl ml-2 text-gray-300">
                    {ticketExpiry.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")} {ticketStrike} {ticketRight === "C" ? "Call" : "Put"}
                  </span>
                )}
              </span>
              {/* Live spot price + refresh + snap-to-price */}
              <div className="flex items-center gap-2">
                {spotPrice != null && (
                  <span className="text-2xl font-bold text-green-400">${spotPrice.toFixed(2)}</span>
                )}
                {spotError && (
                  <span className="text-base text-red-400">No quote</span>
                )}
                {!liveQuote && !stockOrderQuoteRefreshing && (
                  <span className="text-base text-gray-500">fetching...</span>
                )}
                <button
                  type="button"
                  disabled={stockOrderQuoteRefreshing}
                  onClick={async () => {
                    setStockOrderQuoteRefreshing(true);
                    await fetchQuote(tickerForQuote);
                    setStockOrderQuoteRefreshing(false);
                  }}
                  className="min-h-[40px] min-w-[40px] rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-lg disabled:opacity-40"
                  title="Refresh quote"
                >
                  {stockOrderQuoteRefreshing ? "..." : "\u21BB"}
                </button>
                {spotPrice != null && stockOrderType !== "MOC" && (
                  <button
                    type="button"
                    onClick={() => setStockOrderLmtPrice(spotPrice.toFixed(2))}
                    className="min-h-[40px] px-3 rounded-lg bg-green-800 hover:bg-green-700 text-green-200 text-sm font-medium"
                    title="Set limit price to spot"
                  >
                    Use as price
                  </button>
                )}
              </div>
              {(data?.accounts?.length ?? 0) > 1 && (
                <select
                  value={stockOrderAccount}
                  onChange={(e) => setStockOrderAccount(e.target.value)}
                  className="min-h-[48px] rounded-xl bg-gray-800 border-2 border-gray-600 text-white text-lg px-4 py-2"
                >
                  {data?.accounts?.map((a) => (
                    <option key={a} value={a}>{getAccountLabel(a, userAlias)}</option>
                  ))}
                </select>
              )}
              {posQty > 0 && (
                <span className="text-base text-gray-400">Position: <span className="text-white font-semibold">{posQty.toLocaleString()}</span></span>
              )}
              <div className="ml-auto">
                <button type="button" onClick={closeStockOrder} className="min-h-[52px] min-w-[52px] rounded-xl bg-gray-700 hover:bg-gray-600 text-white text-2xl font-bold">
                  ✕
                </button>
              </div>
            </div>

            {/* ── +/- Toggle ── */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm text-gray-400 mr-1">Delta mode:</span>
              <button
                type="button"
                onClick={() => setStockOrderDeltaSign(1)}
                className={`min-h-[52px] min-w-[80px] rounded-xl text-2xl font-extrabold transition-colors ${
                  sign === 1
                    ? "bg-green-700 text-white ring-2 ring-green-400"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-600"
                }`}
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setStockOrderDeltaSign(-1)}
                className={`min-h-[52px] min-w-[80px] rounded-xl text-2xl font-extrabold transition-colors ${
                  sign === -1
                    ? "bg-red-700 text-white ring-2 ring-red-400"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-600"
                }`}
              >
                −
              </button>
            </div>

            {/* ── Main body: 3-column layout ── */}
            <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_1fr] gap-5 flex-1">

              {/* Column 1: Order type + TIF */}
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Order type</label>
                  <div className="flex flex-col gap-2">
                    {(["LMT", "STP LMT", "MOC"] as StockOrderType[]).map((ot) => (
                      <button
                        key={ot}
                        type="button"
                        onClick={() => setStockOrderType(ot)}
                        className={`w-full min-h-[60px] rounded-xl text-xl font-bold transition-colors ${
                          stockOrderType === ot
                            ? "bg-indigo-600 text-white ring-2 ring-indigo-400"
                            : "bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-600"
                        }`}
                      >
                        {ot === "STP LMT" ? "Stop Limit" : ot === "MOC" ? "MOC" : "Limit"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Time in force</label>
                  <div className="flex flex-col gap-2">
                    {(["DAY", "GTC"] as StockOrderTif[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setStockOrderTif(t)}
                        className={`w-full min-h-[60px] rounded-xl text-xl font-bold transition-colors ${
                          stockOrderTif === t
                            ? "bg-indigo-600 text-white ring-2 ring-indigo-400"
                            : "bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-600"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Column 2: Quantity (delta-based) */}
              <div className="flex flex-col">
                <label className="block text-sm text-gray-400 mb-1.5">Quantity ({unitLabel})</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={stockOrderQty}
                  onChange={(e) => setStockOrderQty(e.target.value)}
                  placeholder="0"
                  className="w-full min-h-[72px] rounded-xl bg-gray-800 border-2 border-gray-600 text-white text-4xl font-extrabold text-center px-4 py-4 placeholder-gray-600 focus:ring-2 focus:ring-indigo-400 focus:outline-none mb-3"
                />

                {/* ── Absolute quantity buttons (mode-independent) ── */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setStockOrderQty("0")}
                    className="min-h-[68px] rounded-xl border-2 border-gray-500 bg-gray-700 hover:bg-gray-600 text-white text-2xl font-extrabold"
                  >
                    Clear (0)
                  </button>
                  <button
                    type="button"
                    onClick={() => setStockOrderQty(posQty > 0 ? String(posQty) : "0")}
                    disabled={posQty <= 0}
                    className={`min-h-[68px] rounded-xl border-2 text-2xl font-extrabold ${
                      posQty > 0
                        ? "border-cyan-500 bg-cyan-900/60 hover:bg-cyan-800/60 text-cyan-100"
                        : "border-gray-600 bg-gray-800 text-gray-500 cursor-not-allowed opacity-50"
                    }`}
                    title={posQty > 0 ? `Set quantity to position size: ${posQty.toLocaleString()}` : "No position"}
                  >
                    = Pos{posQty > 0 ? ` (${posQty.toLocaleString()})` : ""}
                  </button>
                </div>

                {/* ── Delta buttons (sign-mode-dependent) ── */}
                <div className="grid grid-cols-2 gap-2 flex-1 content-start">
                  {posQty > 0 && (
                    <button
                      type="button"
                      onClick={() => applyQtyDelta(posQty)}
                      className="min-h-[68px] rounded-xl border bg-amber-800/60 hover:bg-amber-700/60 border-amber-500 text-amber-200 text-2xl font-bold col-span-2"
                    >
                      {sign === 1 ? "+" : "−"}{posQty.toLocaleString()} (pos)
                    </button>
                  )}
                  {qtyDeltas.map((d) => (
                    <button
                      key={`qd-${d}`}
                      type="button"
                      onClick={() => applyQtyDelta(d)}
                      className={`min-h-[68px] rounded-xl border text-2xl font-bold ${
                        sign === 1
                          ? "bg-gray-800 hover:bg-gray-700 border-gray-600 text-green-300"
                          : "bg-gray-800 hover:bg-gray-700 border-gray-600 text-red-300"
                      }`}
                    >
                      {sign === 1 ? "+" : "−"}{d.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Column 3: Prices (delta-based) */}
              <div className="flex flex-col">
                {/* Limit price (not shown for MOC) */}
                {stockOrderType !== "MOC" && (
                  <div className="mb-3">
                    <label className="block text-sm text-gray-400 mb-1.5">Limit price</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={stockOrderLmtPrice}
                      onChange={(e) => setStockOrderLmtPrice(e.target.value)}
                      placeholder="0.00"
                      className="w-full min-h-[72px] rounded-xl bg-gray-800 border-2 border-gray-600 text-white text-4xl font-extrabold text-center px-4 py-4 placeholder-gray-600 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                    />
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      {priceDeltas.map((d) => (
                        <button
                          key={`lmt-${d}`}
                          type="button"
                          onClick={() => applyPriceDelta(setStockOrderLmtPrice, stockOrderLmtPrice, d)}
                          className={`min-h-[68px] rounded-xl border text-2xl font-bold ${
                            sign === 1
                              ? "bg-gray-800 hover:bg-gray-700 border-gray-600 text-green-300"
                              : "bg-gray-800 hover:bg-gray-700 border-gray-600 text-red-300"
                          }`}
                        >
                          {sign === 1 ? "+" : "−"}{d < 1 ? d.toFixed(2) : d}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Stop price (only for STP LMT) */}
                {stockOrderType === "STP LMT" && (
                  <div className="mb-3">
                    <label className="block text-sm text-gray-400 mb-1.5">Stop price</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={stockOrderStopPrice}
                      onChange={(e) => setStockOrderStopPrice(e.target.value)}
                      placeholder="0.00"
                      className="w-full min-h-[72px] rounded-xl bg-gray-800 border-2 border-gray-600 text-white text-4xl font-extrabold text-center px-4 py-4 placeholder-gray-600 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                    />
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      {priceDeltas.map((d) => (
                        <button
                          key={`stp-${d}`}
                          type="button"
                          onClick={() => applyPriceDelta(setStockOrderStopPrice, stockOrderStopPrice, d)}
                          className={`min-h-[68px] rounded-xl border text-2xl font-bold ${
                            sign === 1
                              ? "bg-gray-800 hover:bg-gray-700 border-gray-600 text-green-300"
                              : "bg-gray-800 hover:bg-gray-700 border-gray-600 text-red-300"
                          }`}
                        >
                          {sign === 1 ? "+" : "−"}{d < 1 ? d.toFixed(2) : d}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* MOC note */}
                {stockOrderType === "MOC" && (
                  <div className="p-4 rounded-xl bg-gray-800 border border-gray-600 text-gray-300 text-lg">
                    Market on Close — no price needed. Order will execute at closing price.
                  </div>
                )}
              </div>
            </div>

            {/* ── Bottom bar: summary + submit ── */}
            <div className="mt-4 pt-4 border-t border-gray-700 space-y-3">
              {stockOrderQty && parseFloat(stockOrderQty) > 0 && (
                <div className="text-xl text-gray-200 text-center">
                  {stockOrderAction} <span className="font-bold text-white">{stockOrderQty}</span> {stockOrderTicker}{isOpt ? ` ${ticketExpiry.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")} ${ticketStrike} ${ticketRight}` : ""} @{" "}
                  {stockOrderType === "MOC"
                    ? "Market on Close"
                    : stockOrderType === "STP LMT"
                      ? `Stop ${stockOrderStopPrice || "—"} / Limit ${stockOrderLmtPrice || "—"}`
                      : `Limit ${stockOrderLmtPrice || "—"}`}
                  {" · "}
                  {stockOrderTif}
                  {stockOrderLmtPrice && stockOrderType !== "MOC" && (
                    <span className="ml-3 font-extrabold text-white text-2xl">
                      ≈ ${(parseFloat(stockOrderQty) * parseFloat(stockOrderLmtPrice) * costMultiplier).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={submitStockOrder}
                disabled={stockOrderSubmitting || !stockOrderQty || parseFloat(stockOrderQty) <= 0}
                className={`w-full min-h-[80px] rounded-2xl text-2xl font-extrabold transition-colors disabled:opacity-40 ${
                  stockOrderAction === "BUY"
                    ? "bg-blue-600 hover:bg-blue-500 text-white"
                    : "bg-red-600 hover:bg-red-500 text-white"
                }`}
              >
                {stockOrderSubmitting
                  ? "Sending order…"
                  : `${stockOrderAction} ${stockOrderQty || "0"} ${unitLabel}`}
              </button>
              {stockOrderResult?.error && (
                <div className="p-4 rounded-xl bg-red-900/50 border border-red-700 text-red-200 text-lg">
                  {stockOrderResult.error}
                </div>
              )}
              {stockOrderResult?.orderId && !stockOrderResult.error && (
                <div className="p-4 rounded-xl bg-green-900/50 border border-green-700 text-green-200 text-lg">
                  Order #{stockOrderResult.orderId} — {stockOrderResult.status || "Submitted"}
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })()}

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
                    ? `Scan calls — ${sellScanTicker}`
                    : `Scan puts — ${sellScanTicker}`}
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
              {sellScanResult && !sellScanLoading && (() => {
                const contracts = sellScanResult.contracts;
                const byExpiry = new Map<string, SellScanContract[]>();
                for (const c of contracts) {
                  const list = byExpiry.get(c.expiry) ?? [];
                  list.push(c);
                  byExpiry.set(c.expiry, list);
                }
                const expiryOrder = sellScanResult.expirations?.length
                  ? sellScanResult.expirations
                  : [...byExpiry.keys()].sort();
                const strikeCount = new Map<number, number>();
                for (const c of contracts) {
                  strikeCount.set(c.strike, (strikeCount.get(c.strike) ?? 0) + 1);
                }
                const repeatedStrikes = new Set<number>([...strikeCount.entries()].filter(([, n]) => n > 1).map(([k]) => k));
                const groupBg = ["bg-gray-800", "bg-gray-800/90", "bg-gray-700/70"];
                const groupBorder = "border-t-2 border-gray-500";
                return (
                  <div className="space-y-4">
                    <p className="text-base text-gray-200">
                      Last trade: <span className="font-semibold text-white tabular-nums">${sellScanResult.spotPrice.toFixed(2)}</span>
                      {" · "}
                      {contracts.length} contracts (0–15 business days, near the money)
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-gray-500 overflow-hidden">
                      <table className="w-full text-base border-collapse">
                        <thead>
                          <tr className="bg-gray-700 text-gray-100 border-b-2 border-gray-500">
                            <th className="text-left py-3 px-3 font-bold">Expiration</th>
                            <th className="text-right py-3 px-3 font-bold">Strike</th>
                            <th className="text-right py-3 px-3 font-bold">Bid</th>
                            <th className="text-right py-3 px-3 font-bold">Ask</th>
                            <th className="text-right py-3 px-3 font-bold">Mid</th>
                            <th className="text-right py-3 px-3 font-bold">Vol</th>
                            <th className="text-right py-3 px-3 font-bold">OI</th>
                            <th className="text-right py-3 px-3 font-bold">Delta</th>
                            <th className="text-center py-3 px-2 font-bold">Trade</th>
                          </tr>
                        </thead>
                        <tbody>
                          {expiryOrder.map((expiry, groupIdx) => {
                            const rows = byExpiry.get(expiry) ?? [];
                            const expDisplay = expiry.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
                            const bg = groupBg[groupIdx % groupBg.length];
                            return (
                              <Fragment key={expiry}>
                                <tr className={`${groupBorder} ${bg}`} aria-label={`Expiration ${expDisplay}`}>
                                  <td colSpan={9} className="py-1.5 px-3 text-sm font-bold text-amber-200/95 tracking-wide">
                                    {expDisplay}
                                  </td>
                                </tr>
                                {rows.map((c, i) => {
                                  const isRepeatedStrike = repeatedStrikes.has(c.strike);
                                  return (
                                    <tr
                                      key={`${c.expiry}-${c.strike}-${i}`}
                                      className={`${bg} border-b border-gray-600/80 hover:brightness-110`}
                                    >
                                      <td className="py-2.5 px-3 text-gray-500/80 text-sm" aria-hidden="true">&nbsp;</td>
                                      <td className={`py-2.5 px-3 text-right tabular-nums font-medium ${isRepeatedStrike ? "text-amber-200 font-bold border-l-2 border-amber-500/80 pl-2" : "text-white"}`}>
                                        {c.strike}
                                      </td>
                                      <td className="py-2.5 px-3 text-right text-gray-100 tabular-nums">{c.bid?.toFixed(2) ?? "—"}</td>
                                      <td className="py-2.5 px-3 text-right text-gray-100 tabular-nums">{c.ask?.toFixed(2) ?? "—"}</td>
                                      <td className="py-2.5 px-3 text-right text-white tabular-nums font-bold">{c.mid?.toFixed(2) ?? "—"}</td>
                                      <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{c.volume ?? "—"}</td>
                                      <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{c.open_interest ?? "—"}</td>
                                      <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">
                                        {c.delta != null ? c.delta.toFixed(2) : "—"}
                                      </td>
                                      <td className="py-2 px-2 text-center whitespace-nowrap">
                                        <div className="flex items-center justify-center gap-1">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const g = groups.find((gg) => gg.key === sellScanGroupKey) || syntheticGroup(sellScanGroupKey);
                                              openTradeTicketForScan(sellScanGroupKey, g, c, "BUY");
                                              setSellScanTicker(null);
                                            }}
                                            className="min-h-[36px] px-2.5 py-1 rounded text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white"
                                          >
                                            Buy
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const g = groups.find((gg) => gg.key === sellScanGroupKey) || syntheticGroup(sellScanGroupKey);
                                              openTradeTicketForScan(sellScanGroupKey, g, c, "SELL");
                                              setSellScanTicker(null);
                                            }}
                                            className="min-h-[36px] px-2.5 py-1 rounded text-sm font-semibold bg-red-600 hover:bg-red-500 text-white"
                                          >
                                            Sell
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
