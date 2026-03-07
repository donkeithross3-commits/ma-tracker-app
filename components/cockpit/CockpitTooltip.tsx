"use client";

import { useState, useRef, useCallback, type ReactNode } from "react";

interface CockpitTooltipProps {
  content: string;
  children: ReactNode;
  position?: "top" | "bottom" | "left" | "right";
}

export function CockpitTooltip({ content, children, position = "top" }: CockpitTooltipProps) {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const show = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(true), 300);
  }, []);

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
  }, []);

  const posClasses: Record<string, string> = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <span className="relative inline-flex items-center" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && (
        <span
          className={`absolute z-50 px-2.5 py-1.5 text-xs leading-relaxed text-gray-200 bg-gray-800 border border-gray-600 rounded shadow-lg whitespace-normal max-w-xs pointer-events-none ${posClasses[position]}`}
        >
          {content}
        </span>
      )}
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
