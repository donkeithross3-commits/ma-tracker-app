import type { SummaryResponse, BurnRateResponse } from "../_lib/types";
import { fmtCost, fmtTokens, fmtOverhead, overheadColor, quotaColor, quotaBarColor } from "../_lib/formatters";

export function SummaryStrip({
  summary,
  burnRate,
  days,
}: {
  summary: SummaryResponse | null;
  burnRate: BurnRateResponse | null;
  days: number;
}) {
  const n = (v: number | null | undefined) => v ?? 0;
  const i = summary?.totals.interactive;
  const p = summary?.totals.programmatic;
  const subEquiv = n(i?.cost_equivalent);
  const apiSpend = n(p?.cost_usd);
  const tokens = n(i?.input_tokens) + n(i?.output_tokens) + n(p?.input_tokens) + n(p?.output_tokens);
  const sessions = n(i?.session_count);
  const cacheCreate = n(i?.cache_creation_tokens);
  const usefulTokens = n(i?.input_tokens) + n(i?.output_tokens);
  const overheadRatio = usefulTokens > 0 ? cacheCreate / usefulTokens : 0;

  const qh = burnRate?.quota_health;
  const quotaPct = qh?.pct ?? 0;

  return (
    <section className="rounded border border-gray-800 bg-gray-900 px-3 py-1.5 flex items-center gap-3 text-xs flex-wrap">
      <span className="flex items-center gap-1">
        <span className="text-gray-500">{days}d Sub Equiv</span>
        <span className="font-mono font-medium text-blue-400">{fmtCost(subEquiv)}</span>
      </span>
      <span className="text-gray-700">|</span>
      <span className="flex items-center gap-1">
        <span className="text-gray-500">API Spend</span>
        <span className="font-mono font-medium text-amber-400">{fmtCost(apiSpend)}</span>
      </span>
      <span className="text-gray-700">|</span>
      <span className="flex items-center gap-1">
        <span className="text-gray-500">Tokens</span>
        <span className="font-mono font-medium">{fmtTokens(tokens)}</span>
      </span>
      <span className="text-gray-700">|</span>
      <span className="flex items-center gap-1">
        <span className="text-gray-500">Sessions</span>
        <span className="font-mono font-medium">{sessions}</span>
      </span>
      <span className="text-gray-700">|</span>
      <span className="flex items-center gap-1">
        <span className="text-gray-500">Overhead</span>
        <span className={`font-mono font-medium ${overheadColor(overheadRatio)}`}>
          {fmtOverhead(overheadRatio)}
        </span>
      </span>
      <span className="text-gray-700">|</span>
      <span className="flex items-center gap-1.5 min-w-[130px]">
        <span className="text-gray-500">Quota</span>
        {quotaPct > 100 ? (
          <span className="text-xs font-medium text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded">
            OVER LIMIT
          </span>
        ) : (
          <span className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${quotaBarColor(quotaPct)}`}
              style={{ width: `${quotaPct}%` }}
            />
          </span>
        )}
        <span className={`font-mono tabular-nums ${quotaColor(quotaPct)}`}>
          {quotaPct.toFixed(0)}%
        </span>
      </span>
    </section>
  );
}
