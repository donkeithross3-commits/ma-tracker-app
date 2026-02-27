"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { IBPositionRow } from "../IBPositionsTab";

/* ─── Types ─── */
export type StockOrderType = "LMT" | "STP LMT" | "MOC";
export type StockOrderTif = "DAY" | "GTC";

interface InlineOrderTicketProps {
  ticker: string;
  /** Pre-fill from a position leg (OPT click) */
  prefillLeg?: IBPositionRow | null;
  /** Current spot price for the underlying */
  spotPrice?: number | null;
  /** Available accounts */
  accounts: string[];
  /** Default account */
  defaultAccount?: string;
  /** Callback to place order */
  onPlaceOrder: (params: PlaceOrderParams) => Promise<{ orderId?: number; error?: string }>;
  /** Callback when user clears the prefill */
  onClearPrefill?: () => void;
}

export interface PlaceOrderParams {
  ticker: string;
  action: "BUY" | "SELL";
  quantity: number;
  orderType: StockOrderType;
  tif: StockOrderTif;
  outsideRth: boolean;
  lmtPrice?: number;
  stopPrice?: number;
  account?: string;
  // Option-specific
  secType: "STK" | "OPT";
  expiry?: string;
  strike?: number;
  right?: string;
  multiplier?: string;
}

/* ─── Helpers ─── */
const QTY_DELTAS = [1, 2, 5, 10, 25, 50, 100];
const PRICE_DELTAS = [0.01, 0.05, 0.10, 0.25, 0.50];

function roundStep(value: number, step: number, direction: "down" | "up"): number {
  if (step <= 0) return value;
  if (direction === "down") return Math.max(0, Math.floor(value / step) * step);
  return Math.ceil(value / step) * step;
}

function getPriceRoundStep(price: number): number {
  if (price >= 100) return 1;
  if (price >= 10) return 0.5;
  if (price >= 1) return 0.25;
  return 0.05;
}

function getQtyRoundStep(qty: number): number {
  if (qty >= 1000) return 100;
  if (qty >= 100) return 10;
  return 1;
}

/* ─── Component ─── */
export default function InlineOrderTicket({
  ticker,
  prefillLeg,
  spotPrice,
  accounts,
  defaultAccount,
  onPlaceOrder,
  onClearPrefill,
}: InlineOrderTicketProps) {
  // Determine if trading an option or stock
  const isOption = prefillLeg?.contract?.secType === "OPT";
  const secType = isOption ? "OPT" : "STK";

  // Order state
  const [action, setAction] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<StockOrderType>("LMT");
  const [tif, setTif] = useState<StockOrderTif>("DAY");
  const [qty, setQty] = useState("");
  const [lmtPrice, setLmtPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [outsideRth, setOutsideRth] = useState(false);
  const [account, setAccount] = useState(defaultAccount || accounts[0] || "");
  const [deltaSign, setDeltaSign] = useState<1 | -1>(1);

  // Confirmation state (inline, not modal)
  const [confirmState, setConfirmState] = useState<"editing" | "confirming" | "submitted">("editing");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ orderId?: number; error?: string } | null>(null);

  // Debounce protection for submit
  const lastSubmitRef = useRef(0);

  // Pre-fill from option leg
  useEffect(() => {
    if (prefillLeg) {
      const c = prefillLeg.contract;
      const posQty = Math.abs(prefillLeg.position);
      const exitAction: "BUY" | "SELL" = prefillLeg.position > 0 ? "SELL" : "BUY";
      setAction(exitAction);
      setQty(posQty > 0 ? String(posQty) : "");
      setOrderType("LMT");
      setTif("DAY");
      setOutsideRth(false);
      setDeltaSign(1);
      setConfirmState("editing");
      setResult(null);
      // Price pre-fill: for options we'd need the option quote, use spot as fallback
      if (c.secType === "STK" && spotPrice) {
        setLmtPrice(spotPrice.toFixed(2));
        setStopPrice(spotPrice.toFixed(2));
      }
    }
  }, [prefillLeg, spotPrice]);

  // Pre-fill stock defaults when no option is selected
  useEffect(() => {
    if (!prefillLeg && spotPrice && !lmtPrice) {
      setLmtPrice(spotPrice.toFixed(2));
      setStopPrice(spotPrice.toFixed(2));
    }
  }, [spotPrice, prefillLeg, lmtPrice]);

  const applyQtyDelta = useCallback((delta: number) => {
    const cur = parseInt(qty) || 0;
    setQty(String(Math.max(0, cur + delta * deltaSign)));
  }, [qty, deltaSign]);

  const applyPriceDelta = useCallback((
    setter: (v: string) => void,
    current: string,
    delta: number
  ) => {
    const cur = parseFloat(current) || 0;
    const next = Math.max(0, cur + delta * deltaSign);
    setter(next.toFixed(2));
  }, [deltaSign]);

  const handleSubmitClick = useCallback(() => {
    // Validate before showing confirmation
    const qtyNum = parseFloat(qty);
    if (!qtyNum || qtyNum <= 0) {
      setResult({ error: "Enter a valid quantity" });
      return;
    }
    if (orderType !== "MOC" && (!lmtPrice || parseFloat(lmtPrice) <= 0)) {
      setResult({ error: "Enter a valid limit price" });
      return;
    }
    if (orderType === "STP LMT" && (!stopPrice || parseFloat(stopPrice) <= 0)) {
      setResult({ error: "Enter a valid stop price" });
      return;
    }
    setResult(null);
    setConfirmState("confirming");
  }, [qty, orderType, lmtPrice, stopPrice]);

  const handleConfirm = useCallback(async () => {
    // Debounce double-clicks
    const now = Date.now();
    if (now - lastSubmitRef.current < 2000) return;
    lastSubmitRef.current = now;

    setSubmitting(true);
    setResult(null);
    try {
      const params: PlaceOrderParams = {
        ticker,
        action,
        quantity: parseFloat(qty),
        orderType,
        tif,
        outsideRth,
        account: account || undefined,
        secType,
        ...(orderType !== "MOC" && { lmtPrice: parseFloat(lmtPrice) }),
        ...(orderType === "STP LMT" && { stopPrice: parseFloat(stopPrice) }),
        ...(isOption && prefillLeg && {
          expiry: prefillLeg.contract.lastTradeDateOrContractMonth,
          strike: prefillLeg.contract.strike,
          right: prefillLeg.contract.right,
          multiplier: prefillLeg.contract.multiplier,
        }),
      };
      const res = await onPlaceOrder(params);
      setResult(res);
      if (!res.error) {
        setConfirmState("submitted");
      } else {
        setConfirmState("editing");
      }
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Order failed" });
      setConfirmState("editing");
    } finally {
      setSubmitting(false);
    }
  }, [ticker, action, qty, orderType, tif, outsideRth, account, secType, lmtPrice, stopPrice, isOption, prefillLeg, onPlaceOrder]);

  const handleCancelConfirm = useCallback(() => {
    setConfirmState("editing");
  }, []);

  const resetForNewOrder = useCallback(() => {
    setConfirmState("editing");
    setResult(null);
    setQty("");
    setLmtPrice(spotPrice?.toFixed(2) || "");
    setStopPrice(spotPrice?.toFixed(2) || "");
    if (onClearPrefill) onClearPrefill();
  }, [spotPrice, onClearPrefill]);

  // Option details string
  const optionLabel = isOption && prefillLeg
    ? ` ${(prefillLeg.contract.lastTradeDateOrContractMonth || "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")} ${prefillLeg.contract.strike} ${prefillLeg.contract.right}`
    : "";

  const costMultiplier = isOption ? (parseInt(prefillLeg?.contract?.multiplier || "100", 10) || 100) : 1;
  const unitLabel = isOption ? "contract(s)" : "share(s)";

  // ─── CONFIRMATION STATE ───
  if (confirmState === "confirming") {
    return (
      <div className="bg-gray-900 border border-yellow-600/50 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-yellow-400 mb-3">Confirm Order</h3>
        <div className="text-base text-gray-200 mb-4">
          <span className={action === "BUY" ? "text-blue-400 font-bold" : "text-red-400 font-bold"}>
            {action}
          </span>{" "}
          <span className="font-bold text-white">{qty}</span>{" "}
          {ticker}{optionLabel}{" "}
          {orderType === "MOC"
            ? "at Market on Close"
            : orderType === "STP LMT"
              ? `Stop ${stopPrice} / Limit ${lmtPrice}`
              : `Limit ${lmtPrice}`}
          {" "}{tif}
          {lmtPrice && orderType !== "MOC" && (
            <span className="text-gray-400 ml-2">
              ≈ ${(parseFloat(qty) * parseFloat(lmtPrice) * costMultiplier).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className={`min-h-[52px] px-6 rounded-xl text-lg font-bold text-white transition-colors ${
              action === "BUY"
                ? "bg-blue-600 hover:bg-blue-500"
                : "bg-red-600 hover:bg-red-500"
            } disabled:opacity-50`}
          >
            {submitting ? "Sending..." : `Confirm ${action} ${qty} — Send Order`}
          </button>
          <button
            onClick={handleCancelConfirm}
            disabled={submitting}
            className="min-h-[52px] px-6 rounded-xl text-lg font-bold bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ─── SUBMITTED STATE ───
  if (confirmState === "submitted" && result && !result.error) {
    return (
      <div className="bg-gray-900 border border-green-600/50 rounded-lg p-4">
        <p className="text-green-400 font-semibold mb-2">
          Order #{result.orderId} submitted successfully
        </p>
        <button
          onClick={resetForNewOrder}
          className="min-h-[52px] px-6 rounded-lg text-base font-semibold bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
        >
          Place Another Order
        </button>
      </div>
    );
  }

  // ─── Order type label map ───
  const ORDER_TYPE_LABELS: Record<StockOrderType, string> = {
    "LMT": "Limit",
    "STP LMT": "Stop Limit",
    "MOC": "MOC",
  };

  // ─── Delta button color classes (green for +, red for −) ───
  const deltaColorCls = deltaSign === 1
    ? "bg-gray-800 hover:bg-gray-700 border border-gray-600 text-green-300"
    : "bg-gray-800 hover:bg-gray-700 border border-gray-600 text-red-300";

  // ─── Utility button classes (Clear / Round) ───
  const utilityCls = "min-h-[48px] rounded-lg border border-gray-600 bg-gray-700/80 hover:bg-gray-600 text-gray-200 text-base font-bold transition-colors";

  // ─── EDITING STATE (default) ───
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300">
          Order Ticket — {ticker}{optionLabel || " (Stock)"}
        </h3>
        {isOption && onClearPrefill && (
          <button
            onClick={onClearPrefill}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Switch to Stock
          </button>
        )}
      </div>

      {/* 3-column grid: controls | qty | price */}
      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_1fr] gap-4">

        {/* ── Left column: Order controls ── */}
        <div className="flex flex-col gap-3">
          {/* BUY / SELL */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => setAction("BUY")}
              className={`min-h-[52px] rounded-xl text-xl font-bold transition-colors ${
                action === "BUY"
                  ? "bg-blue-600 text-white ring-2 ring-blue-400"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-600"
              }`}
            >
              BUY
            </button>
            <button
              onClick={() => setAction("SELL")}
              className={`min-h-[52px] rounded-xl text-xl font-bold transition-colors ${
                action === "SELL"
                  ? "bg-red-600 text-white ring-2 ring-red-400"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-600"
              }`}
            >
              SELL
            </button>
          </div>

          {/* Delta sign toggle (+/−) — green/red color-coded */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => setDeltaSign(1)}
              className={`min-h-[44px] rounded-lg text-lg font-bold transition-colors ${
                deltaSign === 1
                  ? "bg-green-700 text-white ring-2 ring-green-400"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-600"
              }`}
            >
              +
            </button>
            <button
              onClick={() => setDeltaSign(-1)}
              className={`min-h-[44px] rounded-lg text-lg font-bold transition-colors ${
                deltaSign === -1
                  ? "bg-red-700 text-white ring-2 ring-red-400"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-600"
              }`}
            >
              −
            </button>
          </div>

          {/* Order type — stacked vertically with friendly labels */}
          <div className="flex flex-col gap-1.5">
            {(["LMT", "STP LMT", "MOC"] as StockOrderType[]).map((ot) => (
              <button
                key={ot}
                onClick={() => setOrderType(ot)}
                className={`w-full min-h-[48px] rounded-lg text-base font-bold transition-colors ${
                  orderType === ot
                    ? "bg-indigo-600 text-white ring-2 ring-indigo-400"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-600"
                }`}
              >
                {ORDER_TYPE_LABELS[ot]}
              </button>
            ))}
          </div>

          {/* TIF */}
          <div className="grid grid-cols-2 gap-1.5">
            {(["DAY", "GTC"] as StockOrderTif[]).map((t) => (
              <button
                key={t}
                onClick={() => setTif(t)}
                className={`min-h-[44px] rounded-lg text-base font-bold transition-colors ${
                  tif === t
                    ? "bg-indigo-600 text-white ring-2 ring-indigo-400"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-600"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Outside RTH toggle */}
          <button
            onClick={() => setOutsideRth((v) => !v)}
            className={`w-full min-h-[44px] rounded-lg text-sm font-bold transition-colors ${
              outsideRth
                ? "bg-amber-600 text-white ring-2 ring-amber-400"
                : "bg-gray-800 text-gray-500 hover:bg-gray-700 border border-gray-600"
            }`}
          >
            {outsideRth ? "RTH: ON" : "RTH: OFF"}
          </button>

          {/* Account selector (conditional) */}
          {accounts.length > 1 && (
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              className="min-h-[44px] px-2 text-sm bg-gray-800 border border-gray-600 rounded-lg text-gray-200"
            >
              {accounts.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          )}
        </div>

        {/* ── Center column: Quantity ── */}
        <div className="flex flex-col">
          <label className="text-sm text-gray-400 mb-1">Qty</label>
          <input
            type="text"
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="0"
            className="w-full min-h-[68px] px-3 text-4xl font-bold text-center bg-gray-800 border-2 border-gray-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-400 font-mono inline-edit mb-2 placeholder-gray-600"
          />

          {/* Utility row: Clear + Round */}
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            <button onClick={() => setQty("0")} className={utilityCls}>
              Clear
            </button>
            <button
              onClick={() => {
                const cur = parseInt(qty) || 0;
                setQty(String(roundStep(cur, getQtyRoundStep(cur), "down")));
              }}
              className={utilityCls}
              title="Round down"
            >
              ↓ Round
            </button>
            <button
              onClick={() => {
                const cur = parseInt(qty) || 0;
                setQty(String(roundStep(cur, getQtyRoundStep(cur), "up")));
              }}
              className={utilityCls}
              title="Round up"
            >
              ↑ Round
            </button>
          </div>

          {/* Delta buttons — green/red based on sign, grid-cols-4 fills column */}
          <div className="grid grid-cols-4 gap-1.5">
            {QTY_DELTAS.map((d) => (
              <button
                key={d}
                onClick={() => applyQtyDelta(d)}
                className={`min-h-[52px] text-lg font-bold rounded-lg font-mono transition-colors ${deltaColorCls}`}
              >
                {deltaSign === 1 ? "+" : "−"}{d}
              </button>
            ))}
          </div>
        </div>

        {/* ── Right column: Price(s) ── */}
        <div className="flex flex-col">
          {orderType !== "MOC" ? (
            <>
              {/* Limit price */}
              <label className="text-sm text-gray-400 mb-1">Limit Price</label>
              <input
                type="text"
                inputMode="decimal"
                value={lmtPrice}
                onChange={(e) => setLmtPrice(e.target.value)}
                placeholder="0.00"
                className="w-full min-h-[68px] px-3 text-4xl font-bold text-center bg-gray-800 border-2 border-gray-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-400 font-mono inline-edit mb-2 placeholder-gray-600"
              />

              {/* Utility row: Clear + Round */}
              <div className="grid grid-cols-3 gap-1.5 mb-2">
                <button onClick={() => setLmtPrice("0.00")} className={utilityCls}>
                  Clear
                </button>
                <button
                  onClick={() => setLmtPrice(String(roundStep(parseFloat(lmtPrice) || 0, getPriceRoundStep(parseFloat(lmtPrice) || 0), "down").toFixed(2)))}
                  className={utilityCls}
                  title="Round down"
                >
                  ↓ Round
                </button>
                <button
                  onClick={() => setLmtPrice(String(roundStep(parseFloat(lmtPrice) || 0, getPriceRoundStep(parseFloat(lmtPrice) || 0), "up").toFixed(2)))}
                  className={utilityCls}
                  title="Round up"
                >
                  ↑ Round
                </button>
              </div>

              {/* Price delta buttons — green/red based on sign */}
              <div className="grid grid-cols-3 gap-1.5">
                {PRICE_DELTAS.map((d) => (
                  <button
                    key={d}
                    onClick={() => applyPriceDelta(setLmtPrice, lmtPrice, d)}
                    className={`min-h-[52px] text-lg font-bold rounded-lg font-mono transition-colors ${deltaColorCls}`}
                  >
                    {deltaSign === 1 ? "+" : "−"}{d >= 0.10 ? d.toFixed(2) : d.toString()}
                  </button>
                ))}
              </div>

              {/* Stop price (only when STP LMT) */}
              {orderType === "STP LMT" && (
                <>
                  <label className="text-sm text-gray-400 mb-1 mt-4">Stop Price</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={stopPrice}
                    onChange={(e) => setStopPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full min-h-[68px] px-3 text-4xl font-bold text-center bg-gray-800 border-2 border-gray-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-400 font-mono inline-edit mb-2 placeholder-gray-600"
                  />

                  <div className="grid grid-cols-3 gap-1.5 mb-2">
                    <button onClick={() => setStopPrice("0.00")} className={utilityCls}>
                      Clear
                    </button>
                    <button
                      onClick={() => setStopPrice(String(roundStep(parseFloat(stopPrice) || 0, getPriceRoundStep(parseFloat(stopPrice) || 0), "down").toFixed(2)))}
                      className={utilityCls}
                      title="Round down"
                    >
                      ↓ Round
                    </button>
                    <button
                      onClick={() => setStopPrice(String(roundStep(parseFloat(stopPrice) || 0, getPriceRoundStep(parseFloat(stopPrice) || 0), "up").toFixed(2)))}
                      className={utilityCls}
                      title="Round up"
                    >
                      ↑ Round
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    {PRICE_DELTAS.map((d) => (
                      <button
                        key={d}
                        onClick={() => applyPriceDelta(setStopPrice, stopPrice, d)}
                        className={`min-h-[52px] text-lg font-bold rounded-lg font-mono transition-colors ${deltaColorCls}`}
                      >
                        {deltaSign === 1 ? "+" : "−"}{d >= 0.10 ? d.toFixed(2) : d.toString()}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            /* MOC: show message instead of empty column */
            <div className="flex items-center justify-center h-full">
              <p className="text-base text-yellow-400/70 text-center font-medium">
                Market on Close<br />No price required
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Below the grid: summary, errors, submit (full width) ── */}

      {/* Order summary */}
      {qty && parseFloat(qty) > 0 && (
        <p className="text-base text-gray-300 mt-3 text-center">
          <span className={action === "BUY" ? "text-blue-400 font-bold" : "text-red-400 font-bold"}>{action}</span>{" "}
          <span className="font-bold text-white">{qty}</span> {ticker}{optionLabel}{" "}
          {orderType === "MOC"
            ? "at Market on Close"
            : orderType === "STP LMT"
              ? `Stop ${stopPrice || "\u2014"} / Limit ${lmtPrice || "\u2014"}`
              : `Limit ${lmtPrice || "\u2014"}`}{" "}
          {tif}
          {lmtPrice && orderType !== "MOC" && (
            <span className="ml-2 text-gray-500">
              ≈ ${(parseFloat(qty) * parseFloat(lmtPrice) * costMultiplier).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
        </p>
      )}

      {/* Error display */}
      {result?.error && (
        <p className="text-sm text-red-400 mt-2">{result.error}</p>
      )}

      {/* Submit button */}
      <button
        onClick={handleSubmitClick}
        disabled={submitting || !qty || parseFloat(qty) <= 0}
        className={`min-h-[60px] w-full px-6 rounded-xl text-xl font-bold text-white transition-colors mt-3 ${
          action === "BUY"
            ? "bg-blue-600 hover:bg-blue-500"
            : "bg-red-600 hover:bg-red-500"
        } disabled:opacity-30 disabled:cursor-not-allowed`}
      >
        {`${action} ${qty || "0"} ${unitLabel}`}
      </button>
    </div>
  );
}
