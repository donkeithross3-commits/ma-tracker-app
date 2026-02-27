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

  // ─── EDITING STATE (default) ───
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
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

      {/* Row 1: BUY/SELL + Order Type + TIF + Outside RTH */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* BUY / SELL toggle */}
        <div className="flex gap-1">
          <button
            onClick={() => setAction("BUY")}
            className={`min-h-[52px] min-w-[60px] px-6 rounded-xl text-xl font-bold transition-colors ${
              action === "BUY"
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-400 hover:bg-gray-600"
            }`}
          >
            BUY
          </button>
          <button
            onClick={() => setAction("SELL")}
            className={`min-h-[52px] min-w-[60px] px-6 rounded-xl text-xl font-bold transition-colors ${
              action === "SELL"
                ? "bg-red-600 text-white"
                : "bg-gray-700 text-gray-400 hover:bg-gray-600"
            }`}
          >
            SELL
          </button>
        </div>

        {/* Delta sign toggle */}
        <div className="flex gap-0.5 border border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setDeltaSign(1)}
            className={`min-h-[52px] px-3 min-w-[60px] text-xl font-bold ${
              deltaSign === 1 ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-500"
            }`}
          >
            +
          </button>
          <button
            onClick={() => setDeltaSign(-1)}
            className={`min-h-[52px] px-3 min-w-[60px] text-xl font-bold ${
              deltaSign === -1 ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-500"
            }`}
          >
            −
          </button>
        </div>

        {/* Order type buttons */}
        <div className="flex gap-1">
          {(["LMT", "STP LMT", "MOC"] as StockOrderType[]).map((ot) => (
            <button
              key={ot}
              onClick={() => setOrderType(ot)}
              className={`min-h-[52px] px-4 rounded-lg text-base font-bold transition-colors ${
                orderType === ot
                  ? "bg-gray-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {ot}
            </button>
          ))}
        </div>

        {/* TIF buttons */}
        <div className="flex gap-1">
          {(["DAY", "GTC"] as StockOrderTif[]).map((t) => (
            <button
              key={t}
              onClick={() => setTif(t)}
              className={`min-h-[52px] px-4 rounded-lg text-base font-bold transition-colors ${
                tif === t
                  ? "bg-gray-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Outside RTH toggle */}
        <button
          onClick={() => setOutsideRth((v) => !v)}
          className={`min-h-[52px] px-4 rounded-lg text-sm font-medium transition-colors ${
            outsideRth
              ? "bg-yellow-600/30 text-yellow-400 border border-yellow-600/50"
              : "bg-gray-800 text-gray-500 hover:bg-gray-700"
          }`}
        >
          {outsideRth ? "Outside RTH: ON" : "Outside RTH: OFF"}
        </button>

        {/* Account selector */}
        {accounts.length > 1 && (
          <select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className="min-h-[52px] px-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
          >
            {accounts.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        )}
      </div>

      {/* Row 2: Quantity */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-base text-gray-300 w-14 font-medium">Qty</label>
          <input
            type="text"
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="w-36 min-h-[68px] px-3 text-4xl font-bold text-center bg-gray-800 border border-gray-700 rounded-xl text-white focus:outline-none focus:border-blue-500 font-mono inline-edit"
          />
          <button
            onClick={() => setQty("0")}
            className="min-h-[60px] px-4 bg-gray-700 hover:bg-gray-600 text-gray-300 text-base font-medium rounded-xl transition-colors"
          >
            Clear
          </button>
          <button
            onClick={() => {
              const cur = parseInt(qty) || 0;
              setQty(String(roundStep(cur, getQtyRoundStep(cur), "down")));
            }}
            className="min-h-[60px] px-3 text-lg text-gray-400 hover:text-white bg-gray-800 rounded-lg transition-colors"
            title="Round down"
          >
            ↓
          </button>
          <button
            onClick={() => {
              const cur = parseInt(qty) || 0;
              setQty(String(roundStep(cur, getQtyRoundStep(cur), "up")));
            }}
            className="min-h-[60px] px-3 text-lg text-gray-400 hover:text-white bg-gray-800 rounded-lg transition-colors"
            title="Round up"
          >
            ↑
          </button>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 pl-14">
          {QTY_DELTAS.map((d) => (
            <button
              key={d}
              onClick={() => applyQtyDelta(d)}
              className="min-h-[60px] min-w-[60px] text-lg font-bold bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 font-mono transition-colors"
            >
              {deltaSign === 1 ? "+" : "−"}{d}
            </button>
          ))}
        </div>
      </div>

      {/* Row 3: Limit Price (when not MOC) */}
      {orderType !== "MOC" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-base text-gray-300 w-14 font-medium">Limit</label>
            <input
              type="text"
              inputMode="decimal"
              value={lmtPrice}
              onChange={(e) => setLmtPrice(e.target.value)}
              className="w-36 min-h-[68px] px-3 text-4xl font-bold text-center bg-gray-800 border border-gray-700 rounded-xl text-white focus:outline-none focus:border-blue-500 font-mono inline-edit"
            />
            <button
              onClick={() => setLmtPrice("0.00")}
              className="min-h-[60px] px-4 bg-gray-700 hover:bg-gray-600 text-gray-300 text-base font-medium rounded-xl transition-colors"
            >
              Clear
            </button>
            <button
              onClick={() => setLmtPrice(String(roundStep(parseFloat(lmtPrice) || 0, getPriceRoundStep(parseFloat(lmtPrice) || 0), "down").toFixed(2)))}
              className="min-h-[60px] px-3 text-lg text-gray-400 hover:text-white bg-gray-800 rounded-lg transition-colors"
              title="Round down"
            >
              ↓
            </button>
            <button
              onClick={() => setLmtPrice(String(roundStep(parseFloat(lmtPrice) || 0, getPriceRoundStep(parseFloat(lmtPrice) || 0), "up").toFixed(2)))}
              className="min-h-[60px] px-3 text-lg text-gray-400 hover:text-white bg-gray-800 rounded-lg transition-colors"
              title="Round up"
            >
              ↑
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 pl-14">
            {PRICE_DELTAS.map((d) => (
              <button
                key={d}
                onClick={() => applyPriceDelta(setLmtPrice, lmtPrice, d)}
                className="min-h-[60px] min-w-[60px] text-lg font-bold bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 font-mono transition-colors"
              >
                {deltaSign === 1 ? "+" : "−"}{d >= 0.10 ? d.toFixed(2) : d.toString()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Row 4: Stop Price (when STP LMT) */}
      {orderType === "STP LMT" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-base text-gray-300 w-14 font-medium">Stop</label>
            <input
              type="text"
              inputMode="decimal"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              className="w-36 min-h-[68px] px-3 text-4xl font-bold text-center bg-gray-800 border border-gray-700 rounded-xl text-white focus:outline-none focus:border-blue-500 font-mono inline-edit"
            />
            <button
              onClick={() => setStopPrice("0.00")}
              className="min-h-[60px] px-4 bg-gray-700 hover:bg-gray-600 text-gray-300 text-base font-medium rounded-xl transition-colors"
            >
              Clear
            </button>
            <button
              onClick={() => setStopPrice(String(roundStep(parseFloat(stopPrice) || 0, getPriceRoundStep(parseFloat(stopPrice) || 0), "down").toFixed(2)))}
              className="min-h-[60px] px-3 text-lg text-gray-400 hover:text-white bg-gray-800 rounded-lg transition-colors"
              title="Round down"
            >
              ↓
            </button>
            <button
              onClick={() => setStopPrice(String(roundStep(parseFloat(stopPrice) || 0, getPriceRoundStep(parseFloat(stopPrice) || 0), "up").toFixed(2)))}
              className="min-h-[60px] px-3 text-lg text-gray-400 hover:text-white bg-gray-800 rounded-lg transition-colors"
              title="Round up"
            >
              ↑
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 pl-14">
            {PRICE_DELTAS.map((d) => (
              <button
                key={d}
                onClick={() => applyPriceDelta(setStopPrice, stopPrice, d)}
                className="min-h-[60px] min-w-[60px] text-lg font-bold bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 font-mono transition-colors"
              >
                {deltaSign === 1 ? "+" : "−"}{d >= 0.10 ? d.toFixed(2) : d.toString()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* MOC disclaimer */}
      {orderType === "MOC" && (
        <p className="text-xs text-yellow-400/70">Market on Close — executes at closing price. No limit price required.</p>
      )}

      {/* Order summary */}
      {qty && parseFloat(qty) > 0 && (
        <p className="text-sm text-gray-400">
          {action} <span className="font-bold text-white">{qty}</span> {ticker}{optionLabel}{" "}
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
        <p className="text-sm text-red-400">{result.error}</p>
      )}

      {/* Submit button */}
      <button
        onClick={handleSubmitClick}
        disabled={submitting || !qty || parseFloat(qty) <= 0}
        className={`min-h-[60px] w-full px-6 rounded-xl text-xl font-bold text-white transition-colors ${
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
