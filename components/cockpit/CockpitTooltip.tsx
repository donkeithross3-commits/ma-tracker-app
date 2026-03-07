"use client";

import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface CockpitTooltipProps {
  content: string;
  children: ReactNode;
  position?: "top" | "bottom" | "auto";
}

export function CockpitTooltip({ content, children, position = "auto" }: CockpitTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(true), 300);
  }, []);

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
    setCoords(null);
  }, []);

  // Position the tooltip in a portal relative to the viewport
  useEffect(() => {
    if (!visible || !triggerRef.current) return;

    const trigger = triggerRef.current;
    const rect = trigger.getBoundingClientRect();

    // Start by placing above the trigger, centered
    const GAP = 8;
    const TOOLTIP_MAX_W = 320; // max-w-xs = 20rem = 320px

    // We'll measure after render, but estimate first
    let top: number;
    let left = rect.left + rect.width / 2 - TOOLTIP_MAX_W / 2;

    const preferTop = position === "top" || position === "auto";

    if (preferTop && rect.top > 120) {
      // Enough space above — place on top (will adjust after measure)
      top = rect.top - GAP;
    } else {
      // Place below
      top = rect.bottom + GAP;
    }

    // Clamp horizontal to viewport
    left = Math.max(8, Math.min(left, window.innerWidth - TOOLTIP_MAX_W - 8));

    setCoords({ top, left });
  }, [visible, position]);

  // After tooltip renders, adjust vertical position based on actual height
  useEffect(() => {
    if (!visible || !coords || !tooltipRef.current || !triggerRef.current) return;

    const tooltip = tooltipRef.current;
    const trigger = triggerRef.current;
    const rect = trigger.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const GAP = 8;

    const preferTop = position === "top" || position === "auto";
    let top: number;

    if (preferTop && rect.top > tipRect.height + GAP + 4) {
      // Place above: bottom of tooltip aligns with top of trigger
      top = rect.top - tipRect.height - GAP;
    } else {
      // Place below
      top = rect.bottom + GAP;
    }

    // Clamp to viewport vertically
    top = Math.max(4, Math.min(top, window.innerHeight - tipRect.height - 4));

    // Also re-clamp horizontal with actual width
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));

    if (top !== coords.top || left !== coords.left) {
      setCoords({ top, left });
    }
  }, [visible, coords, position]);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex items-center"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible && coords && typeof document !== "undefined" &&
        createPortal(
          <span
            ref={tooltipRef}
            className="fixed z-[9999] px-2.5 py-1.5 text-xs leading-relaxed text-gray-200 bg-gray-800 border border-gray-600 rounded shadow-lg whitespace-pre-line max-w-xs pointer-events-none"
            style={{ top: coords.top, left: coords.left }}
          >
            {content}
          </span>,
          document.body
        )
      }
    </span>
  );
}

/** Tiny info icon that wraps a tooltip */
export function InfoTip({ tip }: { tip: string }) {
  return (
    <CockpitTooltip content={tip}>
      <span className="ml-1 text-gray-500 hover:text-gray-300 cursor-help text-[10px]">ⓘ</span>
    </CockpitTooltip>
  );
}
