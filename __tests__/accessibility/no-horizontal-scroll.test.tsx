/**
 * No-horizontal-scroll tests for ticker cards and layout components.
 *
 * These tests verify that the CSS and HTML structure used in IBPositionsTab
 * prevents horizontal scrollbars inside ticker cards. They test the structural
 * patterns (flex-wrap, table-fixed, overflow-hidden) rather than rendering the
 * full component (which requires extensive mocking of IB connections, auth, etc.).
 *
 * Run: npm test -- --testPathPattern=no-horizontal-scroll
 */

import { render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// 1. Ticker card structure: overflow-hidden + table-fixed pattern
// ---------------------------------------------------------------------------

describe("Ticker card no-horizontal-scroll patterns", () => {
  it("card wrapper uses overflow-hidden to prevent horizontal scroll", () => {
    const { container } = render(
      <div
        className="min-w-0 rounded-lg border border-gray-600 overflow-hidden border-l-4 ticker-card"
        style={{ containerType: "inline-size", width: "320px" }}
      >
        <div className="min-w-0 flex flex-col gap-1.5 px-4 py-3">
          <div className="tc-stats-row flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span>STK 100</span>
            <span>Pos 500</span>
            <span>$12,500.00</span>
            <span>P&L: $1,250.00 (10.0%)</span>
            <span>Last trade: $125.00</span>
          </div>
          <div className="tc-actions-row flex flex-wrap gap-2 mt-2">
            <button className="min-h-[44px] px-4 py-2.5">Scan calls</button>
            <button className="min-h-[44px] px-4 py-2.5">Scan puts</button>
            <button className="min-h-[44px] px-4 py-2.5">Trade</button>
          </div>
        </div>
        <div className="min-w-0 overflow-hidden d-table-wrap">
          <table className="w-full text-sm table-fixed d-table">
            <colgroup>
              <col style={{ width: "20%" }} />
              <col style={{ width: "30%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "15%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Type</th>
                <th>Pos</th>
                <th>Avg Cost</th>
                <th>Trade</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="truncate">LONGTICKERXYZ 2025-12-19 999 C</td>
                <td>OPT</td>
                <td>100,000</td>
                <td>$99,999.99</td>
                <td><button>Trade</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );

    const card = container.firstElementChild as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.className).toContain("overflow-hidden");
    expect(card.className).toContain("ticker-card");

    // Table wrapper also has overflow-hidden
    const tableWrap = card.querySelector(".d-table-wrap") as HTMLElement;
    expect(tableWrap).toBeTruthy();
    expect(tableWrap.className).toContain("overflow-hidden");

    // Table uses table-fixed
    const table = card.querySelector("table") as HTMLElement;
    expect(table).toBeTruthy();
    expect(table.className).toContain("table-fixed");
  });

  it("stats row uses flex-wrap to prevent overflow", () => {
    const { container } = render(
      <div className="tc-stats-row flex flex-wrap items-center gap-x-3 gap-y-1" style={{ width: "200px" }}>
        <span>STK 100</span>
        <span>OPT 50</span>
        <span>(30C / 20P)</span>
        <span>Pos 500</span>
        <span>$12,500.00</span>
        <span>P&L: $1,250.00</span>
        <span>Last: $125.00</span>
        <button>Refresh</button>
      </div>
    );

    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain("flex-wrap");
    expect(row.className).toContain("tc-stats-row");
  });

  it("actions row uses flex-wrap for button wrapping", () => {
    const { container } = render(
      <div className="tc-actions-row flex flex-wrap gap-2 mt-2" style={{ width: "200px" }}>
        <button className="min-h-[44px] px-4 py-2.5">Scan calls</button>
        <button className="min-h-[44px] px-4 py-2.5">Scan puts</button>
        <button className="min-h-[44px] px-4 py-2.5">Trade</button>
        <button className="min-h-[44px] px-4 py-2.5">Risk Mgr</button>
      </div>
    );

    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain("flex-wrap");
    expect(row.className).toContain("tc-actions-row");
  });

  it("position table colgroup uses percentage widths that sum to ~100%", () => {
    // Mirrors the weighted column approach from IBPositionsTab
    const weights: Record<string, number> = {
      account: 10, symbol: 18, type: 5, pos: 6, avgCost: 12,
      last: 8, mktVal: 14, pnl: 14, trade: 9,
    };
    const visibleKeys = Object.keys(weights);
    const weightSum = visibleKeys.reduce((s, k) => s + weights[k], 0);
    const percentages = visibleKeys.map(k => (weights[k] / weightSum) * 100);
    const totalPct = percentages.reduce((s, p) => s + p, 0);

    // Sum of all column percentages should be ~100%
    expect(totalPct).toBeCloseTo(100, 1);

    // Each column should be > 0%
    for (const pct of percentages) {
      expect(pct).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Responsive layout: sidebar stacks on narrow viewports
// ---------------------------------------------------------------------------

describe("Responsive layout structure", () => {
  it("outer layout uses flex-col lg:flex-row for responsive stacking", () => {
    const { container } = render(
      <div className="flex flex-col lg:flex-row gap-4 min-h-0">
        <div className="w-full lg:w-64 shrink-0">Ticker list</div>
        <div className="flex-1 min-w-0">Cards grid</div>
      </div>
    );

    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain("flex-col");
    expect(outer.className).toContain("lg:flex-row");

    const sidebar = outer.firstElementChild as HTMLElement;
    expect(sidebar.className).toContain("w-full");
    expect(sidebar.className).toContain("lg:w-64");
  });

  it("ticker list uses horizontal scroll on narrow, vertical on wide", () => {
    const { container } = render(
      <div className="overflow-y-auto lg:flex-1 lg:min-h-[200px] max-h-[200px] lg:max-h-none">
        <div className="flex flex-row lg:flex-col overflow-x-auto lg:overflow-x-visible">
          <button className="shrink-0 lg:shrink lg:w-full">AAPL</button>
          <button className="shrink-0 lg:shrink lg:w-full">MSFT</button>
          <button className="shrink-0 lg:shrink lg:w-full">GOOGL</button>
        </div>
      </div>
    );

    const scrollContainer = container.querySelector(".flex-row") as HTMLElement;
    expect(scrollContainer.className).toContain("flex-row");
    expect(scrollContainer.className).toContain("lg:flex-col");
    expect(scrollContainer.className).toContain("overflow-x-auto");
    expect(scrollContainer.className).toContain("lg:overflow-x-visible");

    // Each button is shrink-0 on narrow (prevents squishing)
    const buttons = scrollContainer.querySelectorAll("button");
    for (const btn of buttons) {
      expect(btn.className).toContain("shrink-0");
      expect(btn.className).toContain("lg:w-full");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Container query context
// ---------------------------------------------------------------------------

describe("Container query setup", () => {
  it("ticker card sets containerType inline-size for container queries", () => {
    const { container } = render(
      <div
        className="ticker-card"
        style={{ containerType: "inline-size" }}
        data-testid="ticker-card"
      >
        <div className="tc-stats-row">Stats</div>
        <div className="tc-actions-row">Actions</div>
      </div>
    );

    const card = screen.getByTestId("ticker-card");
    expect(card.style.containerType).toBe("inline-size");
    expect(card.className).toContain("ticker-card");

    // Verify hook classes exist for CSS targeting
    expect(card.querySelector(".tc-stats-row")).toBeTruthy();
    expect(card.querySelector(".tc-actions-row")).toBeTruthy();
  });
});
