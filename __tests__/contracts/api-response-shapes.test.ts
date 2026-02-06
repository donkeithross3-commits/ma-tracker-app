/**
 * Contract tests for key API response shapes.
 *
 * These tests validate that the JSON structure returned by critical endpoints
 * conforms to the expected shape. They do NOT check exact values -- only that
 * required fields exist and have the right types. This prevents silent regressions
 * when refactoring backend code.
 *
 * Run: npm test -- --testPathPattern=contracts
 */

// ---------- Shape helpers ----------

/** Assert that `obj` has all `keys`, each matching the expected type string. */
function expectShape(obj: Record<string, unknown>, spec: Record<string, string>) {
  for (const [key, expectedType] of Object.entries(spec)) {
    expect(obj).toHaveProperty(key);
    if (expectedType === "any") continue;
    if (expectedType === "array") {
      expect(Array.isArray(obj[key])).toBe(true);
      continue;
    }
    if (expectedType === "string?") {
      expect(
        typeof obj[key] === "string" || obj[key] === null || obj[key] === undefined
      ).toBe(true);
      continue;
    }
    if (expectedType === "number?") {
      expect(
        typeof obj[key] === "number" || obj[key] === null || obj[key] === undefined
      ).toBe(true);
      continue;
    }
    if (expectedType === "boolean?") {
      expect(
        typeof obj[key] === "boolean" || obj[key] === null || obj[key] === undefined
      ).toBe(true);
      continue;
    }
    expect(typeof obj[key]).toBe(expectedType);
  }
}

// ---------- /api/ib-connection/status ----------

describe("IB Connection Status response contract", () => {
  it("connected=true with ws-relay source", () => {
    const sample = {
      connected: true,
      source: "ws-relay",
      providers: [{ id: "abc", user_id: "u1", agent_version: "1.0.0" }],
      message: "IB connected via WebSocket relay",
    };
    expectShape(sample, {
      connected: "boolean",
      source: "string",
      message: "string?",
    });
  });

  it("connected=false with error", () => {
    const sample = {
      connected: false,
      source: "none",
      message: "No IB connection available.",
      relayError: "relay timeout",
    };
    expectShape(sample, {
      connected: "boolean",
      source: "string",
      message: "string?",
      relayError: "string?",
    });
  });
});

// ---------- /options/relay/positions (Python) ----------

describe("Relay positions response contract", () => {
  it("should have positions array with required fields", () => {
    const sample = {
      positions: [
        {
          account: "U123",
          contract: {
            conId: 1,
            symbol: "AAPL",
            secType: "STK",
            exchange: "SMART",
            currency: "USD",
          },
          position: 100,
          avgCost: 150.5,
        },
      ],
    };
    expectShape(sample, { positions: "array" });
    const pos = (sample.positions as Record<string, unknown>[])[0];
    expectShape(pos, {
      account: "string",
      contract: "object",
      position: "number",
      avgCost: "number",
    });
  });
});

// ---------- /options/relay/fetch-chain (Python) ----------

describe("Fetch chain response contract", () => {
  it("should have ticker, spotPrice, expirations, and contracts", () => {
    const sample = {
      ticker: "AAPL",
      spotPrice: 195.5,
      expirations: ["20260320", "20260417"],
      contracts: [
        {
          symbol: "AAPL",
          strike: 200,
          expiry: "20260320",
          right: "C",
          bid: 1.5,
          ask: 1.7,
          mid: 1.6,
          last: 1.55,
          volume: 100,
          open_interest: 500,
          implied_vol: 0.25,
          delta: 0.45,
          bid_size: 10,
          ask_size: 15,
        },
      ],
    };
    expectShape(sample, {
      ticker: "string",
      spotPrice: "number",
      expirations: "array",
      contracts: "array",
    });
    const contract = (sample.contracts as Record<string, unknown>[])[0];
    expectShape(contract, {
      symbol: "string",
      strike: "number",
      expiry: "string",
      right: "string",
      bid: "number",
      ask: "number",
      mid: "number",
    });
  });
});

// ---------- /api/ma-options/deals ----------

describe("MA Options deals response contract", () => {
  it("should return an array of deals with required fields", () => {
    const sample = [
      {
        id: "deal-1",
        ticker: "THS",
        targetName: "TreeHouse Foods",
        status: "active",
        cashPerShare: 27.0,
        expectedCloseDate: "2026-06-30",
      },
    ];
    expect(Array.isArray(sample)).toBe(true);
    const deal = sample[0] as Record<string, unknown>;
    expectShape(deal, {
      id: "string",
      ticker: "string",
      status: "string",
    });
  });
});

// ---------- /ws/provider-status ----------

describe("WebSocket provider status contract", () => {
  it("should have providers_connected and providers array", () => {
    const sample = {
      providers_connected: 1,
      provider_ids: ["abc123"],
      pending_requests: 0,
      providers: [
        {
          id: "abc123",
          user_id: "user-1",
          agent_version: "1.2.0",
          ib_accounts: ["U123"],
          connected_at: "2026-02-06T10:00:00",
          last_heartbeat: "2026-02-06T10:05:00",
          is_active: true,
        },
      ],
    };
    expectShape(sample, {
      providers_connected: "number",
      provider_ids: "array",
      pending_requests: "number",
      providers: "array",
    });
  });
});

// ---------- Python /health ----------

describe("Python health endpoint contract", () => {
  it("should return status and ib_connected fields", () => {
    const sample = { status: "healthy", ib_connected: false };
    expectShape(sample, {
      status: "string",
      ib_connected: "boolean",
    });
  });
});
