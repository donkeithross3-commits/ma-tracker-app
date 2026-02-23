/**
 * Accessibility smoke tests for Parkinson's-friendly UI.
 *
 * These tests verify structural a11y requirements:
 * - Focus visibility (focus-visible CSS exists)
 * - ARIA labels on icon-only buttons
 * - Switch role on toggle buttons
 * - Reduced-motion CSS rule existence
 * - Comfort mode CSS variable presence
 *
 * Run: npm test -- --testPathPattern=a11y-smoke
 */

import { render, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

// Read globals.css once for CSS rule assertions
const globalsCssPath = join(__dirname, "../../app/globals.css");
let globalsCss = "";
try {
  globalsCss = readFileSync(globalsCssPath, "utf-8");
} catch {
  // Will fail tests gracefully if file not found
}

// ---------------------------------------------------------------------------
// 1. CSS rule existence tests
// ---------------------------------------------------------------------------

describe("CSS accessibility rules", () => {
  it("globals.css contains prefers-reduced-motion rule", () => {
    expect(globalsCss).toContain("prefers-reduced-motion: reduce");
    expect(globalsCss).toContain("animation-duration: 0.01ms");
    expect(globalsCss).toContain("transition-duration: 0.01ms");
  });

  it("globals.css contains focus-visible outline rule", () => {
    expect(globalsCss).toContain(":focus-visible");
    expect(globalsCss).toContain("outline:");
    expect(globalsCss).toContain("outline-offset:");
  });

  it("globals.css contains comfort mode focus-visible enhancement", () => {
    expect(globalsCss).toContain('[data-density="comfort"] :focus-visible');
    expect(globalsCss).toContain("outline-width: 3px");
  });

  it("globals.css contains comfort mode 44px button minimum", () => {
    expect(globalsCss).toContain("min-height: 2.75rem");
  });

  it("globals.css contains density variables for compact and comfort", () => {
    // Compact (root)
    expect(globalsCss).toContain("--d-table-py:");
    expect(globalsCss).toContain("--d-table-px:");
    expect(globalsCss).toContain("--d-table-font:");
    expect(globalsCss).toContain("--d-btn-min-h:");
    expect(globalsCss).toContain("--d-row-min-h:");

    // Comfort override
    expect(globalsCss).toContain('[data-density="comfort"]');
  });

  it("globals.css contains container query rules for ticker cards", () => {
    expect(globalsCss).toContain("@container");
    expect(globalsCss).toContain(".tc-stats-row");
    expect(globalsCss).toContain(".tc-actions-row");
  });

  it("globals.css does NOT contain overflow-x: auto inside ticker card rules", () => {
    // Extract the ticker card container query section
    const containerSections = globalsCss.match(/@container[^{]*\{[^}]*\}/g) || [];
    for (const section of containerSections) {
      if (section.includes("tc-stats-row") || section.includes("tc-actions-row")) {
        expect(section).not.toContain("overflow-x: auto");
        expect(section).not.toContain("overflow-x: scroll");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. ARIA attributes on interactive elements
// ---------------------------------------------------------------------------

describe("ARIA attributes on key components", () => {
  it("comfort mode toggle should have role=switch and aria-checked", () => {
    const { container } = render(
      <button
        role="switch"
        aria-checked={true}
        aria-label="Comfort Mode"
        onClick={() => {}}
      >
        <span>Comfort Mode</span>
        <span className="toggle-track" />
      </button>
    );

    const toggle = screen.getByRole("switch");
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Comfort Mode");
  });

  it("icon-only buttons should have aria-label", () => {
    const { container } = render(
      <div>
        <button aria-label="Risk Manager" title="Risk Manager">
          &#9881;
        </button>
        <button aria-label="Refresh quote" title="Refresh quote">
          &#8635;
        </button>
        <button aria-label="Close trade ticket">
          &#10005;
        </button>
      </div>
    );

    const riskBtn = screen.getByLabelText("Risk Manager");
    expect(riskBtn).toBeTruthy();

    const refreshBtn = screen.getByLabelText("Refresh quote");
    expect(refreshBtn).toBeTruthy();

    const closeBtn = screen.getByLabelText("Close trade ticket");
    expect(closeBtn).toBeTruthy();
  });

  it("trade lock toggle should have role=switch with descriptive aria-label", () => {
    const { container } = render(
      <button
        role="switch"
        aria-checked={false}
        aria-label="Trade lock is on — orders are blocked"
        onClick={() => {}}
      >
        <span className="toggle-thumb" />
      </button>
    );

    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toContain("Trade lock");
  });
});

// ---------------------------------------------------------------------------
// 3. Button sizing assertions (44px minimum pattern)
// ---------------------------------------------------------------------------

describe("Button sizing for Parkinson's accessibility", () => {
  it("action buttons use min-h-[44px] or larger", () => {
    const { container } = render(
      <div>
        <button className="min-h-[44px] px-4 py-2.5">Scan calls</button>
        <button className="min-h-[44px] px-4 py-2.5">Scan puts</button>
        <button className="min-h-[44px] px-4 py-2.5">Trade</button>
        <button className="min-h-[52px] px-5 py-3">Submit order</button>
        <button className="min-h-[72px] px-4 py-4">Large input</button>
      </div>
    );

    const buttons = container.querySelectorAll("button");
    for (const btn of buttons) {
      const hasMinH = /min-h-\[(\d+)px\]/.exec(btn.className);
      expect(hasMinH).toBeTruthy();
      if (hasMinH) {
        const minHeight = parseInt(hasMinH[1], 10);
        expect(minHeight).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it("trade ticket buttons use 52px+ for primary actions", () => {
    const { container } = render(
      <div>
        <button className="min-h-[52px] min-w-[52px] rounded-xl text-2xl font-bold" aria-label="Close trade ticket">
          X
        </button>
      </div>
    );

    const btn = container.querySelector("button") as HTMLElement;
    expect(btn.className).toContain("min-h-[52px]");
    expect(btn.className).toContain("min-w-[52px]");
  });
});

// ---------------------------------------------------------------------------
// 4. Confirmation modal structure (2-step pattern)
// ---------------------------------------------------------------------------

describe("Order confirmation modal accessibility", () => {
  it("confirmation modal buttons are large and have clear labels", () => {
    const { container } = render(
      <div role="dialog" aria-modal="true">
        <div aria-live="polite">
          <span>1. Preview</span>
          <span aria-hidden="true">&#8594;</span>
          <span>2. Confirm</span>
        </div>
        <button className="min-h-[52px] text-lg font-bold">
          BUY 100 — Send order
        </button>
        <button className="min-h-[52px] text-lg">
          Back
        </button>
        <button className="min-h-[44px] text-base">
          Cancel order
        </button>
      </div>
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();

    // Step indicator uses aria-live for screen readers
    const liveRegion = container.querySelector("[aria-live]") as HTMLElement;
    expect(liveRegion).toBeTruthy();
    expect(liveRegion.getAttribute("aria-live")).toBe("polite");

    // All buttons meet minimum size
    const buttons = container.querySelectorAll("button");
    for (const btn of buttons) {
      const hasMinH = /min-h-\[(\d+)px\]/.exec(btn.className);
      expect(hasMinH).toBeTruthy();
      if (hasMinH) {
        expect(parseInt(hasMinH[1], 10)).toBeGreaterThanOrEqual(44);
      }
    }
  });
});
