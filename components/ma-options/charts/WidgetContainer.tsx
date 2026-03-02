"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, AlertCircle, Loader2, X } from "lucide-react";

interface WidgetContainerProps {
  title: string;
  loading?: boolean;
  error?: string | null;
  children: (size: { width: number; height: number }) => React.ReactNode;
  /** Extra content rendered in the header after the title (e.g., inline controls) */
  headerExtra?: React.ReactNode;
  /** If provided, shows a close button that calls this callback */
  onRemove?: () => void;
}

const HEADER_HEIGHT_PX = 32;

export default function WidgetContainer({
  title,
  loading = false,
  error = null,
  children,
  headerExtra,
  onRemove,
}: WidgetContainerProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const updateSize = useCallback(() => {
    if (!contentRef.current) return;
    const rect = contentRef.current.getBoundingClientRect();
    setSize({
      width: Math.floor(rect.width),
      height: Math.floor(rect.height),
    });
  }, []);

  useEffect(() => {
    if (!contentRef.current) return;

    const observer = new ResizeObserver(() => {
      updateSize();
    });

    observer.observe(contentRef.current);
    updateSize(); // Initial measurement

    return () => observer.disconnect();
  }, [updateSize]);

  return (
    <div
      className="bg-gray-900 border border-gray-700 rounded-md overflow-hidden h-full flex flex-col"
    >
      {/* Header — drag-handle only on grip+title; controls sit outside for mobile touch */}
      <div
        className="flex items-center gap-1.5 px-2 border-b border-gray-800 shrink-0"
        style={{ height: HEADER_HEIGHT_PX }}
      >
        {/* Draggable zone: grip icon + title only */}
        <div className="drag-handle flex items-center gap-1.5 cursor-grab active:cursor-grabbing min-w-0 select-none">
          <GripVertical className="h-3.5 w-3.5 text-gray-500 shrink-0" />
          <span className="text-xs font-medium text-gray-300 truncate">
            {title}
          </span>
        </div>
        {/* Controls sit outside drag-handle — touchAction ensures fast mobile taps */}
        <div className="flex items-center min-w-0" style={{ touchAction: "manipulation" }}>
          {headerExtra}
        </div>
        <div className="flex items-center gap-1 ml-auto shrink-0">
          {loading && (
            <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />
          )}
          {onRemove && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className="p-0.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition-colors"
              title="Remove widget"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Content — measured directly to avoid border-pixel math errors */}
      <div ref={contentRef} className="flex-1 min-h-0 overflow-hidden">
        {error ? (
          <div className="flex items-center justify-center h-full gap-2 px-3">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
            <span className="text-xs text-red-400 truncate">{error}</span>
          </div>
        ) : size.width > 0 && size.height > 0 ? (
          children(size)
        ) : null}
      </div>
    </div>
  );
}
