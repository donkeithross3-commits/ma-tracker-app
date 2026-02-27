"use client";

import { useState, useCallback, useMemo } from "react";
import { ColumnChooser, type ColumnDef } from "@/components/ui/ColumnChooser";
import { useUIPreferences } from "@/lib/ui-preferences";

/* ─── Types ─── */
interface IBPositionContract {
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

export interface IBOpenOrder {
  orderId: number;
  contract: IBPositionContract;
  order: {
    action: string;
    totalQuantity: number;
    orderType: string;
    lmtPrice?: number | null;
    auxPrice?: number | null;
    tif: string;
    outsideRth?: boolean;
    account: string;
    parentId?: number;
    ocaGroup?: string;
    trailStopPrice?: number | null;
    trailingPercent?: number | null;
  };
  orderState: {
    status: string;
    warningText?: string;
    commission?: number | null;
  };
}

/* ─── Column definitions ─── */
const ORDERS_COLUMNS: ColumnDef[] = [
  { key: "symbol", label: "Symbol" },
  { key: "side", label: "Side" },
  { key: "orderType", label: "Type" },
  { key: "qty", label: "Qty" },
  { key: "price", label: "Price" },
  { key: "tif", label: "TIF" },
  { key: "status", label: "Status" },
  { key: "action", label: "Action" },
];
const ORDERS_DEFAULTS = ORDERS_COLUMNS.map((c) => c.key);
const ORDERS_LOCKED = ["symbol", "action"];

/* ─── Helpers ─── */
function displayOrderSymbol(o: IBOpenOrder): string {
  const c = o.contract;
  if (c.secType === "OPT" && (c.lastTradeDateOrContractMonth || c.strike)) {
    const exp = (c.lastTradeDateOrContractMonth || "").replace(/(\d{4})(\d{2})(\d{2})/, "$2/$3");
    return `${c.symbol} ${exp} ${c.strike} ${c.right || ""}`.trim();
  }
  return c.symbol || c.localSymbol || "\u2014";
}

function formatOrderPrice(o: IBOpenOrder): string {
  const { orderType, lmtPrice, auxPrice, trailStopPrice, trailingPercent } = o.order;
  const type = (orderType ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (type === "MKT" || type === "MOC") return orderType ?? type;
  if (type === "LMT" && lmtPrice != null) return `LMT ${lmtPrice.toFixed(2)}`;
  if (type === "STP LMT" && lmtPrice != null && auxPrice != null)
    return `STP ${auxPrice.toFixed(2)} LMT ${lmtPrice.toFixed(2)}`;
  if (type === "STP" && auxPrice != null) return `STP ${auxPrice.toFixed(2)}`;
  if (type === "TRAIL LIMIT" || type === "TRAILLIMIT") {
    const parts: string[] = [];
    parts.push(trailStopPrice != null ? `Trail ${trailStopPrice.toFixed(2)}` : "Trail \u2014");
    parts.push(lmtPrice != null ? `LMT ${lmtPrice.toFixed(2)}` : "LMT \u2014");
    if (trailingPercent != null) parts.push(`${trailingPercent.toFixed(1)}%`);
    return parts.join(" ");
  }
  return orderType ?? type;
}

/* ─── Component ─── */
interface WorkingOrdersInlineProps {
  orders: IBOpenOrder[];
  onCancelOrder: (orderId: number) => Promise<void>;
  onModifyOrder: (orderId: number, updates: { qty?: number; lmtPrice?: number; stopPrice?: number }) => Promise<void>;
  cancellingOrderId?: number | null;
}

export default function WorkingOrdersInline({
  orders,
  onCancelOrder,
  onModifyOrder,
  cancellingOrderId,
}: WorkingOrdersInlineProps) {
  const { getVisibleColumns, setVisibleColumns } = useUIPreferences();
  const savedCols = getVisibleColumns("manualV2Orders");
  const visibleKeys = useMemo(() => savedCols ?? ORDERS_DEFAULTS, [savedCols]);
  const visibleSet = useMemo(() => new Set(visibleKeys), [visibleKeys]);

  // Edit state for inline modification
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editLmt, setEditLmt] = useState("");
  const [editStop, setEditStop] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const startEdit = useCallback((o: IBOpenOrder) => {
    setEditingId(o.orderId);
    setEditQty(String(o.order.totalQuantity));
    setEditLmt(o.order.lmtPrice != null ? o.order.lmtPrice.toFixed(2) : "");
    setEditStop(o.order.auxPrice != null ? o.order.auxPrice.toFixed(2) : "");
    setEditError(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditError(null);
  }, []);

  const submitEdit = useCallback(async (o: IBOpenOrder) => {
    const qty = parseFloat(editQty);
    if (!qty || qty <= 0) { setEditError("Invalid quantity"); return; }
    setEditSubmitting(true);
    setEditError(null);
    try {
      await onModifyOrder(o.orderId, {
        qty,
        lmtPrice: editLmt ? parseFloat(editLmt) : undefined,
        stopPrice: editStop ? parseFloat(editStop) : undefined,
      });
      setEditingId(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Modify failed");
    } finally {
      setEditSubmitting(false);
    }
  }, [editQty, editLmt, editStop, onModifyOrder]);

  if (orders.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-300">
          Working Orders ({orders.length})
        </h3>
        <ColumnChooser
          columns={ORDERS_COLUMNS}
          visible={visibleKeys}
          defaults={ORDERS_DEFAULTS}
          onChange={(keys) => setVisibleColumns("manualV2Orders", keys)}
          locked={ORDERS_LOCKED}
          size="sm"
        />
      </div>
      <div className="overflow-x-auto d-table-wrap" style={{ "--visible-cols": visibleKeys.length } as React.CSSProperties}>
        <table className="w-full text-sm d-table">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500 text-xs">
              {visibleSet.has("symbol") && <th className="py-1.5 px-2 text-left font-medium">Symbol</th>}
              {visibleSet.has("side") && <th className="py-1.5 px-2 text-left font-medium">Side</th>}
              {visibleSet.has("orderType") && <th className="py-1.5 px-2 text-left font-medium">Type</th>}
              {visibleSet.has("qty") && <th className="py-1.5 px-2 text-right font-medium">Qty</th>}
              {visibleSet.has("price") && <th className="py-1.5 px-2 text-right font-medium">Price</th>}
              {visibleSet.has("tif") && <th className="py-1.5 px-2 text-center font-medium">TIF</th>}
              {visibleSet.has("status") && <th className="py-1.5 px-2 text-center font-medium">Status</th>}
              {visibleSet.has("action") && <th className="py-1.5 px-2 text-center font-medium">Action</th>}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const isEditing = editingId === o.orderId;
              return (
                <tr key={o.orderId} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                  {visibleSet.has("symbol") && (
                    <td className="py-1.5 px-2 font-mono text-gray-300">
                      {displayOrderSymbol(o)}
                    </td>
                  )}
                  {visibleSet.has("side") && (
                    <td className={`py-1.5 px-2 font-semibold ${
                      o.order.action === "BUY" ? "text-blue-400" : "text-red-400"
                    }`}>
                      {o.order.action}
                    </td>
                  )}
                  {visibleSet.has("orderType") && (
                    <td className="py-1.5 px-2 text-gray-400 text-xs">
                      {o.order.orderType}
                    </td>
                  )}
                  {visibleSet.has("qty") && (
                    <td className="py-1.5 px-2 text-right font-mono">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editQty}
                          onChange={(e) => setEditQty(e.target.value)}
                          className="w-16 px-1 py-0.5 text-right text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 font-mono inline-edit"
                        />
                      ) : (
                        o.order.totalQuantity
                      )}
                    </td>
                  )}
                  {visibleSet.has("price") && (
                    <td className="py-1.5 px-2 text-right font-mono text-gray-300">
                      {isEditing ? (
                        <div className="flex gap-1 justify-end">
                          {(o.order.orderType === "LMT" || o.order.orderType === "STP LMT") && (
                            <input
                              type="text"
                              value={editLmt}
                              onChange={(e) => setEditLmt(e.target.value)}
                              placeholder="Limit"
                              className="w-20 px-1 py-0.5 text-right text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 font-mono inline-edit"
                            />
                          )}
                          {(o.order.orderType === "STP LMT" || o.order.orderType === "STP") && (
                            <input
                              type="text"
                              value={editStop}
                              onChange={(e) => setEditStop(e.target.value)}
                              placeholder="Stop"
                              className="w-20 px-1 py-0.5 text-right text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 font-mono inline-edit"
                            />
                          )}
                        </div>
                      ) : (
                        formatOrderPrice(o)
                      )}
                    </td>
                  )}
                  {visibleSet.has("tif") && (
                    <td className="py-1.5 px-2 text-center text-gray-400 text-xs">
                      {o.order.tif}
                    </td>
                  )}
                  {visibleSet.has("status") && (
                    <td className="py-1.5 px-2 text-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        o.orderState.status === "Filled" ? "bg-green-500/15 text-green-400" :
                        o.orderState.status === "Cancelled" ? "bg-gray-700 text-gray-500" :
                        "bg-blue-500/15 text-blue-400"
                      }`}>
                        {o.orderState.status}
                      </span>
                    </td>
                  )}
                  {visibleSet.has("action") && (
                    <td className="py-1.5 px-2 text-center">
                      {isEditing ? (
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={() => submitEdit(o)}
                            disabled={editSubmitting}
                            className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded text-white disabled:opacity-50"
                          >
                            {editSubmitting ? "..." : "Save"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={() => startEdit(o)}
                            className="px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded"
                            title="Modify order"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => onCancelOrder(o.orderId)}
                            disabled={cancellingOrderId === o.orderId}
                            className="px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded disabled:opacity-50"
                            title="Cancel order"
                          >
                            {cancellingOrderId === o.orderId ? "..." : "Cancel"}
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editError && (
        <p className="text-xs text-red-400 mt-1">{editError}</p>
      )}
    </div>
  );
}
