/**
 * useDebouncedCriticalClick — tremor-safe cooldown for critical actions.
 * Ensures rapid double-tap only fires once within cooldown window.
 */

import { renderHook, act } from "@testing-library/react";
import { useDebouncedCriticalClick } from "@/lib/use-debounced-critical-click";

describe("useDebouncedCriticalClick", () => {
  it("invokes callback on first click", () => {
    const fn = jest.fn();
    const { result } = renderHook(() => useDebouncedCriticalClick(fn, 500));
    act(() => {
      result.current();
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("ignores second click within cooldown", () => {
    const fn = jest.fn();
    const { result } = renderHook(() => useDebouncedCriticalClick(fn, 500));
    act(() => {
      result.current();
      result.current();
      result.current();
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("invokes again after cooldown has passed", () => {
    let now = 1000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const fn = jest.fn();
    const { result } = renderHook(() => useDebouncedCriticalClick(fn, 500));
    act(() => {
      result.current();
    });
    expect(fn).toHaveBeenCalledTimes(1);
    now += 500;
    act(() => {
      result.current();
    });
    expect(fn).toHaveBeenCalledTimes(2);
    (Date.now as jest.Mock).mockRestore();
  });
});
