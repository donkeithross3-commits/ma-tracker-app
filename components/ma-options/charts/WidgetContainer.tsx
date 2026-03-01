"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, AlertCircle, Loader2 } from "lucide-react";

interface WidgetContainerProps {
  title: string;
  loading?: boolean;
  error?: string | null;
  children: (size: { width: number; height: number }) => React.ReactNode;
}

const HEADER_HEIGHT = 32;

export default function WidgetContainer({
  title,
  loading = false,
  error = null,
  children,
}: WidgetContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const updateSize = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setSize({
      width: Math.floor(rect.width),
      height: Math.floor(rect.height) - HEADER_HEIGHT,
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver(() => {
      updateSize();
    });

    observer.observe(containerRef.current);
    updateSize(); // Initial measurement

    return () => observer.disconnect();
  }, [updateSize]);

  return (
    <div
      ref={containerRef}
      className="bg-gray-900 border border-gray-700 rounded-md overflow-hidden h-full flex flex-col"
    >
      {/* Header — drag handle zone */}
      <div
        className="drag-handle flex items-center gap-1.5 px-2 border-b border-gray-800 cursor-grab active:cursor-grabbing select-none shrink-0"
        style={{ height: HEADER_HEIGHT }}
      >
        <GripVertical className="h-3.5 w-3.5 text-gray-500" />
        <span className="text-xs font-medium text-gray-300 truncate">
          {title}
        </span>
        {loading && (
          <Loader2 className="h-3 w-3 text-blue-400 animate-spin ml-auto" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
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
