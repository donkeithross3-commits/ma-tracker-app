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
  const [savedPositionsTickers, setSavedPositionsTickers] = useState<string[] | null>(null);
  const appliedSavedPositionsRef = useRef(false);
  const [sellScanTicker, setSellScanTicker] = useState<string | null>(null);
  const [sellScanRight, setSellScanRight] = useState<"C" | "P" | null>(null);
  const [sellScanLoading, setSellScanLoading] = useState(false);
  const [sellScanResult, setSellScanResult] = useState<SellScanResponse | null>(null);
  const [sellScanError, setSellScanError] = useState<string | null>(null);
  const [orderContract, setOrderContract] = useState<SellScanContract | null>(null);
  const [orderQuantity, setOrderQuantity] = useState(1);
  const [orderOrderType, setOrderOrderType] = useState<"MKT" | "LMT">("MKT");
  const [orderLmtPrice, setOrderLmtPrice] = useState("");
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  const openOrderForContract = useCallback((c: SellScanContract) => {
    setOrderContract(c);
    setOrderQuantity(1);
    setOrderOrderType("MKT");
    setOrderLmtPrice(c.mid != null ? c.mid.toFixed(2) : "");
    setOrderError(null);
  }, []);
  const [krjSignals, setKrjSignals] = useState<Record<string, "Long" | "Short" | "Neutral" | null>>({});
  // Stock quotes per group key (underlying ticker); null = not fetched, { price, timestamp } or { error }
  const [quotes, setQuotes] = useState<Record<string, { price: number; timestamp: string } | { error: string } | null>>({});
  const [quoteLoading, setQuoteLoading] = useState<Record<string, boolean>>({});

  // ---- Stock order entry state ----
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

  const openStockOrder = useCallback((groupKey: string, action: "BUY" | "SELL", group: GroupAggregate) => {
    const ticker = groupKey.split(" ")[0]?.toUpperCase() ?? groupKey;
    const q = quotes[ticker];
    const spotPrice = q && "price" in q ? q.price.toFixed(2) : "";
    setStockOrderKey(groupKey);
    setStockOrderAction(action);
    setStockOrderType("LMT");
    setStockOrderTif("DAY");
    setStockOrderQty("");
    setStockOrderLmtPrice(spotPrice);
    setStockOrderStopPrice("");
    // Default account to first row's account or first in accounts list
    const acct = group.rows[0]?.account || data?.accounts?.[0] || "";
    setStockOrderAccount(acct);
    setStockOrderSubmitting(false);
    setStockOrderResult(null);
  }, [quotes, data]);

  const closeStockOrder = useCallback(() => {
    setStockOrderKey(null);
    setStockOrderResult(null);
  }, []);

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
        secType: "STK",
        exchange: "SMART",
        currency: "USD",
      };
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
      }
    } catch (e) {
      setStockOrderResult({ error: e instanceof Error ? e.message : "Order failed" });
    } finally {
      setStockOrderSubmitting(false);
    }
  }, [stockOrderKey, stockOrderAction, stockOrderType, stockOrderTif, stockOrderQty, stockOrderLmtPrice, stockOrderStopPrice, stockOrderAccount]);

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
    setOrderContract(null);
    setOrderError(null);
  }, []);

  /** Underlying ticker for a group key (e.g. AAPL or SPCE 250117). */
  const underlyingTickerForGroupKey = useCallback((key: string) => key.split(" ")[0]?.toUpperCase() ?? key, []);

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

  const placeOrderFromScan = useCallback(
    async (contract: SellScanContract, quantity: number, orderType: "MKT" | "LMT", lmtPrice?: number) => {
      setOrderSubmitting(true);
      setOrderError(null);
      try {
        const payload = {
          contract: {
            symbol: contract.symbol,
            secType: "OPT",
            exchange: "SMART",
            currency: "USD",
            lastTradeDateOrContractMonth: contract.expiry,
            strike: contract.strike,
            right: contract.right,
            multiplier: "100",
          },
          order: {
            action: "SELL",
            totalQuantity: quantity,
            orderType,
            ...(orderType === "LMT" && lmtPrice != null && { lmtPrice }),
          },
          timeout_sec: 30,
        };
        const res = await fetch("/api/ib-connection/place-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) {
          setOrderError(data?.error ?? `Order failed: ${res.status}`);
          return;
        }
        setOrderContract(null);
        setOrderError(null);
      } catch (e) {
        setOrderError(e instanceof Error ? e.message : "Order failed");
      } finally {
        setOrderSubmitting(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  useEffect(() => {
    if (!autoRefresh || !isConnected) return;
    const interval = setInterval(fetchPositions, 60000);
    return () => clearInterval(interval);
  }, [autoRefresh, isConnected, fetchPositions]);

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
                  className="shrink-0 min-h-[36px] px-2.5 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white"
                >
                  Add ticker
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
                            <span
                              className={`text-sm font-medium px-2 py-0.5 rounded ${
                                krjSignals[group.key] === "Long"
                                  ? "bg-blue-900/60 text-blue-200"
                                  : krjSignals[group.key] === "Short"
                                    ? "bg-red-900/60 text-red-200"
                                    : krjSignals[group.key] === "Neutral"
                                      ? "bg-gray-600/60 text-gray-200"
                                      : "bg-gray-700/40 text-gray-500"
                              }`}
                              title="KRJ weekly signal"
                            >
                              KRJ: {krjSignals[group.key] ?? "Not available"}
                            </span>
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
                            <span className="tabular-nums text-gray-300">
                              Spot:{" "}
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
                              onClick={() => fetchQuote(underlyingTicker)}
                              disabled={quoteLoadingThis}
                              className="min-h-[32px] px-2 py-1 rounded text-xs font-medium bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white"
                            >
                              Refresh quote
                            </button>
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
                            <button
                              type="button"
                              onClick={() => openStockOrder(group.key, "BUY", group)}
                              className="min-h-[44px] px-4 py-2.5 rounded-lg text-base font-bold bg-blue-700 hover:bg-blue-600 text-white"
                            >
                              Buy stock
                            </button>
                            <button
                              type="button"
                              onClick={() => openStockOrder(group.key, "SELL", group)}
                              className="min-h-[44px] px-4 py-2.5 rounded-lg text-base font-bold bg-red-700 hover:bg-red-600 text-white"
                            >
                              Sell stock
                            </button>
                          </div>
                          {/* ---- Full-screen stock order overlay ---- */}
                          {stockOrderKey === group.key && (
                            <div className="fixed inset-0 z-50 bg-gray-950/95 overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget) closeStockOrder(); }}>
                              <div className="max-w-2xl mx-auto px-4 py-6 min-h-screen flex flex-col">
                                {/* Header */}
                                <div className="flex items-center justify-between mb-6">
                                  <span className={`text-3xl font-extrabold ${stockOrderAction === "BUY" ? "text-blue-300" : "text-red-300"}`}>
                                    {stockOrderAction} {underlyingTicker}
                                  </span>
                                  <button type="button" onClick={closeStockOrder} className="min-h-[56px] min-w-[56px] rounded-xl bg-gray-700 hover:bg-gray-600 text-white text-2xl font-bold">
                                    ✕
                                  </button>
                                </div>

                                {/* Account selector (if multiple) */}
                                {(data?.accounts?.length ?? 0) > 1 && (
                                  <div className="mb-5">
                                    <label className="block text-base text-gray-400 mb-1">Account</label>
                                    <select
                                      value={stockOrderAccount}
                                      onChange={(e) => setStockOrderAccount(e.target.value)}
                                      className="w-full min-h-[56px] rounded-xl bg-gray-800 border-2 border-gray-600 text-white text-xl px-4 py-3"
                                    >
                                      {data?.accounts?.map((a) => (
                                        <option key={a} value={a}>{getAccountLabel(a, userAlias)}</option>
                                      ))}
                                    </select>
                                  </div>
                                )}

                                {/* Order type + TIF side by side */}
                                <div className="grid grid-cols-2 gap-4 mb-5">
                                  <div>
                                    <label className="block text-base text-gray-400 mb-2">Order type</label>
                                    <div className="flex flex-col gap-2">
                                      {(["LMT", "STP LMT", "MOC"] as StockOrderType[]).map((ot) => (
                                        <button
                                          key={ot}
                                          type="button"
                                          onClick={() => setStockOrderType(ot)}
                                          className={`w-full min-h-[64px] rounded-xl text-xl font-bold transition-colors ${
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
                                    <label className="block text-base text-gray-400 mb-2">Time in force</label>
                                    <div className="flex flex-col gap-2">
                                      {(["DAY", "GTC"] as StockOrderTif[]).map((t) => (
                                        <button
                                          key={t}
                                          type="button"
                                          onClick={() => setStockOrderTif(t)}
                                          className={`w-full min-h-[64px] rounded-xl text-xl font-bold transition-colors ${
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

                                {/* Quantity */}
                                <div className="mb-5">
                                  <label className="block text-base text-gray-400 mb-2">Quantity (shares)</label>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min="1"
                                    step="1"
                                    value={stockOrderQty}
                                    onChange={(e) => setStockOrderQty(e.target.value)}
                                    placeholder="0"
                                    className="w-full min-h-[72px] rounded-xl bg-gray-800 border-2 border-gray-600 text-white text-4xl font-extrabold text-center px-4 py-4 placeholder-gray-600 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                                  />
                                  <div className="grid grid-cols-3 gap-3 mt-3">
                                    {[10, 25, 50, 100, 250, 500].map((n) => (
                                      <button
                                        key={n}
                                        type="button"
                                        onClick={() => setStockOrderQty(String(n))}
                                        className="min-h-[72px] rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-100 text-2xl font-bold"
                                      >
                                        {n}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* Limit price (not shown for MOC) */}
                                {stockOrderType !== "MOC" && (
                                  <div className="mb-5">
                                    <label className="block text-base text-gray-400 mb-2">Limit price</label>
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
                                    <div className="grid grid-cols-3 gap-3 mt-3">
                                      {[-0.10, -0.05, -0.01, +0.01, +0.05, +0.10].map((delta) => (
                                        <button
                                          key={delta}
                                          type="button"
                                          onClick={() => {
                                            const cur = parseFloat(stockOrderLmtPrice) || 0;
                                            setStockOrderLmtPrice(Math.max(0, cur + delta).toFixed(2));
                                          }}
                                          className="min-h-[72px] rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-100 text-2xl font-bold"
                                        >
                                          {delta > 0 ? "+" : ""}{delta.toFixed(2)}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Stop price (only for STP LMT) */}
                                {stockOrderType === "STP LMT" && (
                                  <div className="mb-5">
                                    <label className="block text-base text-gray-400 mb-2">Stop price</label>
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
                                    <div className="grid grid-cols-3 gap-3 mt-3">
                                      {[-0.10, -0.05, -0.01, +0.01, +0.05, +0.10].map((delta) => (
                                        <button
                                          key={delta}
                                          type="button"
                                          onClick={() => {
                                            const cur = parseFloat(stockOrderStopPrice) || 0;
                                            setStockOrderStopPrice(Math.max(0, cur + delta).toFixed(2));
                                          }}
                                          className="min-h-[72px] rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-100 text-2xl font-bold"
                                        >
                                          {delta > 0 ? "+" : ""}{delta.toFixed(2)}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Order summary & submit - sticky at bottom */}
                                <div className="mt-auto pt-6 space-y-3">
                                  {stockOrderQty && parseFloat(stockOrderQty) > 0 && (
                                    <div className="text-xl text-gray-200 text-center">
                                      {stockOrderAction} <span className="font-bold text-white">{stockOrderQty}</span> {underlyingTicker} @{" "}
                                      {stockOrderType === "MOC"
                                        ? "Market on Close"
                                        : stockOrderType === "STP LMT"
                                          ? `Stop ${stockOrderStopPrice || "—"} / Limit ${stockOrderLmtPrice || "—"}`
                                          : `Limit ${stockOrderLmtPrice || "—"}`}
                                      {" · "}
                                      {stockOrderTif}
                                      {stockOrderLmtPrice && stockOrderType !== "MOC" && (
                                        <span className="ml-3 font-extrabold text-white text-2xl">
                                          ≈ ${(parseFloat(stockOrderQty) * parseFloat(stockOrderLmtPrice)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                                      : `${stockOrderAction} ${stockOrderQty || "0"} shares`}
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
                          )}
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
                      Spot: <span className="font-semibold text-white tabular-nums">${sellScanResult.spotPrice.toFixed(2)}</span>
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
                            <th className="text-center py-3 px-2 font-bold w-20">Trade</th>
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
                                      <td className="py-2 px-2 text-center">
                                        <button
                                          type="button"
                                          onClick={() => openOrderForContract(c)}
                                          className="min-h-[40px] px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white"
                                        >
                                          Trade
                                        </button>
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

      {/* Order entry modal (from sell-scan Trade button) */}
      {orderContract != null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80"
          role="dialog"
          aria-modal="true"
          aria-labelledby="order-modal-title"
        >
          <div className="bg-gray-900 border border-gray-600 rounded-xl shadow-xl max-w-md w-full">
            <div className="px-4 py-3 border-b border-gray-600">
              <h2 id="order-modal-title" className="text-xl font-bold text-white">
                Place order
              </h2>
            </div>
            <div className="px-4 py-4 space-y-4">
              <div className="bg-gray-800 rounded-lg px-3 py-2">
                <div className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Contract</div>
                <div className="font-mono text-base text-white">
                  {orderContract.symbol} {orderContract.expiry.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")} {orderContract.strike} {orderContract.right === "C" ? "Call" : "Put"}
                </div>
                <div className="text-sm text-gray-400 mt-1">
                  Bid {orderContract.bid?.toFixed(2) ?? "—"} / Ask {orderContract.ask?.toFixed(2) ?? "—"} / Mid {orderContract.mid?.toFixed(2) ?? "—"}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Action</label>
                  <div className="py-2 px-3 rounded-lg bg-gray-800 text-white font-medium">SELL</div>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Quantity</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={orderQuantity}
                    onChange={(e) => setOrderQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full py-2 px-3 rounded-lg bg-gray-800 border border-gray-600 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Order type</label>
                <select
                  value={orderOrderType}
                  onChange={(e) => setOrderOrderType(e.target.value as "MKT" | "LMT")}
                  className="w-full py-2 px-3 rounded-lg bg-gray-800 border border-gray-600 text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="MKT">Market</option>
                  <option value="LMT">Limit</option>
                </select>
              </div>
              {orderOrderType === "LMT" && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Limit price</label>
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    value={orderLmtPrice}
                    onChange={(e) => setOrderLmtPrice(e.target.value)}
                    placeholder={orderContract.mid?.toFixed(2)}
                    className="w-full py-2 px-3 rounded-lg bg-gray-800 border border-gray-600 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
              )}
              {orderError && (
                <p className="text-sm text-red-300 font-medium">{orderError}</p>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-600 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setOrderContract(null); setOrderError(null); }}
                disabled={orderSubmitting}
                className="min-h-[44px] px-4 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const qty = Math.max(1, orderQuantity);
                  const lmt = orderOrderType === "LMT" ? parseFloat(orderLmtPrice) : undefined;
                  if (orderOrderType === "LMT" && (lmt == null || isNaN(lmt) || lmt < 0)) {
                    setOrderError("Enter a valid limit price");
                    return;
                  }
                  placeOrderFromScan(orderContract, qty, orderOrderType, lmt);
                }}
                disabled={orderSubmitting}
                className="min-h-[44px] px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50"
              >
                {orderSubmitting ? "Sending…" : "Place order"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
