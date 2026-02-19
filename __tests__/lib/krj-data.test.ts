/**
 * Tests for KRJ list data: composition warning and expected ranges.
 */
import {
  INDEX_EXPECTED_RANGES,
  getCompositionWarning,
} from "@/lib/krj-data";

describe("INDEX_EXPECTED_RANGES", () => {
  it("defines expected ranges for sp500, sp100, ndx100", () => {
    expect(INDEX_EXPECTED_RANGES.sp500).toEqual({ min: 498, max: 505 });
    expect(INDEX_EXPECTED_RANGES.sp100).toEqual({ min: 98, max: 102 });
    expect(INDEX_EXPECTED_RANGES.ndx100).toEqual({ min: 98, max: 102 });
  });
});

describe("getCompositionWarning", () => {
  it("returns undefined when count is in range", () => {
    expect(getCompositionWarning("sp500", 500, "SP500")).toBeUndefined();
    expect(getCompositionWarning("sp500", 498, "SP500")).toBeUndefined();
    expect(getCompositionWarning("sp500", 505, "SP500")).toBeUndefined();
    expect(getCompositionWarning("sp100", 100, "SP100")).toBeUndefined();
    expect(getCompositionWarning("ndx100", 100, "NDX100")).toBeUndefined();
  });

  it("returns warning when count is below range", () => {
    const msg = getCompositionWarning("sp500", 493, "SP500");
    expect(msg).toBeDefined();
    expect(msg).toContain("493");
    expect(msg).toContain("498");
    expect(msg).toContain("505");
    expect(msg).toContain("Index composition may be incomplete");
  });

  it("returns warning when count is above range", () => {
    const msg = getCompositionWarning("sp500", 510, "SP500");
    expect(msg).toBeDefined();
    expect(msg).toContain("510");
  });

  it("returns undefined for unknown slug", () => {
    expect(getCompositionWarning("equities", 100, "Equities")).toBeUndefined();
  });

  it("uses listName in message", () => {
    const msg = getCompositionWarning("sp100", 90, "S&P 100");
    expect(msg).toContain("S&P 100");
  });
});
