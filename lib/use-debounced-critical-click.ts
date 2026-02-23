"use client";

import { useRef, useCallback } from "react";

/**
 * Returns a wrapped click handler that ignores subsequent invocations within
 * `cooldownMs`. Used for critical actions (order confirm, cancel order) to
 * prevent tremor-induced double-taps from firing twice.
 *
 * PD best practice: debounce 300–500ms (see docs/parkinsons-ui.md).
 * Does not add delay to the first click — only blocks repeats.
 */
export function useDebouncedCriticalClick<T extends (...args: unknown[]) => unknown>(
  callback: T,
  cooldownMs: number = 500
): T {
  const lastFiredRef = useRef(0);

  return useCallback(
    ((...args: unknown[]) => {
      const now = Date.now();
      if (now - lastFiredRef.current < cooldownMs) return;
      lastFiredRef.current = now;
      return callback(...args);
    }) as T,
    [callback, cooldownMs]
  );
}
