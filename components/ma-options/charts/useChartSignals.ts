"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BMCStrategyState,
  PositionFill,
  PositionLedgerEntry,
  SignalHistoryEntry,
} from "./types";

const SIGNAL_POLL_MS = 5_000;
const EXEC_POLL_MS = 10_000;

interface UseChartSignalsResult {
  signals: SignalHistoryEntry[];
  currentSignal: BMCStrategyState["current_signal"] | null;
  fills: PositionFill[];
  engineRunning: boolean;
  activePositionCount: number;
}

/** Flatten position_ledger into PositionFill[] for chart markers */
function flattenFills(ledger: PositionLedgerEntry[]): PositionFill[] {
  const fills: PositionFill[] = [];

  for (const pos of ledger) {
    // Entry fill
    fills.push({
      time: pos.entry.fill_time,
      price: pos.entry.price,
      qty: pos.entry.quantity,
      level: "entry",
      pnl_pct: 0,
      positionId: pos.id,
      instrument: pos.instrument,
      status: pos.status,
      isEntry: true,
    });

    // Exit fills from fill_log (skip the entry-level fill if present)
    for (const f of pos.fill_log) {
      if (f.level === "entry") continue;
      fills.push({
        time: f.time,
        price: f.avg_price,
        qty: f.qty_filled,
        level: f.level,
        pnl_pct: f.pnl_pct,
        positionId: pos.id,
        instrument: pos.instrument,
        status: pos.status,
        isEntry: false,
      });
    }
  }

  return fills.sort((a, b) => a.time - b.time);
}

export function useChartSignals(ticker: string): UseChartSignalsResult {
  const [signals, setSignals] = useState<SignalHistoryEntry[]>([]);
  const [currentSignal, setCurrentSignal] = useState<BMCStrategyState["current_signal"] | null>(null);
  const [fills, setFills] = useState<PositionFill[]>([]);
  const [engineRunning, setEngineRunning] = useState(false);
  const [activePositionCount, setActivePositionCount] = useState(0);

  const signalPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const execPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll BMC signal endpoint
  const fetchSignal = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch("/api/ma-options/bmc-signal", {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();

      // Find strategy matching the chart ticker
      const strategies: BMCStrategyState[] = data.strategies || [];
      const match = strategies.find(
        (s) => s.ticker?.toUpperCase() === ticker.toUpperCase()
      );

      if (match) {
        setSignals(match.signal_history || []);
        setCurrentSignal(match.current_signal);
      }
    } catch {
      // silent — poll will retry
    }
  }, [ticker]);

  // Poll execution status endpoint
  const fetchExecution = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch("/api/ma-options/execution/status", {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();

      setEngineRunning(data.running ?? false);

      const ledger: PositionLedgerEntry[] = data.position_ledger || [];
      const allFills = flattenFills(ledger);

      // Filter fills to ones matching the chart ticker
      const tickerFills = allFills.filter(
        (f) => f.instrument.symbol?.toUpperCase() === ticker.toUpperCase()
      );
      setFills(tickerFills);

      setActivePositionCount(
        ledger.filter((p) => p.status === "active").length
      );
    } catch {
      // silent — poll will retry
    }
  }, [ticker]);

  // Set up polling
  useEffect(() => {
    fetchSignal();
    fetchExecution();

    signalPollRef.current = setInterval(fetchSignal, SIGNAL_POLL_MS);
    execPollRef.current = setInterval(fetchExecution, EXEC_POLL_MS);

    return () => {
      if (signalPollRef.current) clearInterval(signalPollRef.current);
      if (execPollRef.current) clearInterval(execPollRef.current);
    };
  }, [fetchSignal, fetchExecution]);

  return { signals, currentSignal, fills, engineRunning, activePositionCount };
}
