import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const POLYGON_API_KEY = process.env.POLYGON_API_KEY || "";
const POLYGON_BASE = "https://api.polygon.io";

interface PolygonBar {
  t: number; // timestamp ms
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Fetch deal with current version and all prices
  const deal = await prisma.deal.findUnique({
    where: { id },
    include: {
      versions: {
        where: { isCurrentVersion: true },
        take: 1,
      },
      prices: {
        orderBy: { priceDate: "desc" },
        take: 1,
      },
      cvrs: {
        where: { paymentStatus: "pending" },
      },
    },
  });

  if (!deal || deal.versions.length === 0) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const version = deal.versions[0];
  const latestPrice = deal.prices[0];

  // Calculate deal price (same logic as the deal page)
  const cashComponent = version.cashPerShare?.toNumber() || 0;
  const stockComponent =
    version.stockRatio && latestPrice?.acquirorPrice
      ? version.stockRatio.toNumber() * latestPrice.acquirorPrice.toNumber()
      : 0;
  const dividends = version.dividendsOther?.toNumber() || 0;
  const cvrNpv = deal.cvrs.reduce(
    (sum: number, cvr) =>
      sum + cvr.paymentAmount.toNumber() * cvr.probability.toNumber(),
    0
  );
  const dealPrice = cashComponent + stockComponent + dividends + cvrNpv;

  if (dealPrice <= 0) {
    return NextResponse.json(
      { error: "Deal price is zero or not configured" },
      { status: 400 }
    );
  }

  // Determine date range: from announcement date (or deal creation) to today
  const announcedDate = version.announcedDate || deal.createdAt;
  const fromDate = new Date(announcedDate);
  // Go back 5 days before announcement to show the pre-deal price
  fromDate.setDate(fromDate.getDate() - 5);
  const fromStr = fromDate.toISOString().split("T")[0];
  const toStr = new Date().toISOString().split("T")[0];

  if (!POLYGON_API_KEY) {
    return NextResponse.json(
      { error: "Polygon API key not configured" },
      { status: 500 }
    );
  }

  // Fetch daily bars from Polygon
  const url = `${POLYGON_BASE}/v2/aggs/ticker/${deal.ticker}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=5000&apiKey=${POLYGON_API_KEY}`;

  try {
    const response = await fetch(url, {
      next: { revalidate: 3600 }, // Cache for 1 hour
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Polygon API error: ${response.status} ${text}`);
      return NextResponse.json(
        { error: "Failed to fetch price history" },
        { status: 502 }
      );
    }

    const data = await response.json();
    const bars: PolygonBar[] = data.results || [];

    if (bars.length === 0) {
      return NextResponse.json(
        { error: "No price history available" },
        { status: 404 }
      );
    }

    // For stock deals with an acquiror, we'd need acquiror prices too.
    // For now, compute spread using the fixed deal price.
    // If the deal has a stock component, fetch acquiror bars and compute dynamic deal price.
    let acquirorBars: Map<string, number> | null = null;
    if (version.stockRatio && deal.acquirorTicker) {
      const acqUrl = `${POLYGON_BASE}/v2/aggs/ticker/${deal.acquirorTicker}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=5000&apiKey=${POLYGON_API_KEY}`;
      try {
        const acqResp = await fetch(acqUrl, {
          next: { revalidate: 3600 },
        });
        if (acqResp.ok) {
          const acqData = await acqResp.json();
          acquirorBars = new Map();
          for (const bar of acqData.results || []) {
            const dateStr = new Date(bar.t).toISOString().split("T")[0];
            acquirorBars.set(dateStr, bar.c);
          }
        }
      } catch {
        // Fall back to fixed deal price if acquiror fetch fails
      }
    }

    const announcedDateStr = (version.announcedDate || deal.createdAt)
      .toISOString()
      .split("T")[0];

    const spreadHistory = bars.map((bar) => {
      const dateStr = new Date(bar.t).toISOString().split("T")[0];

      // Compute dynamic deal price if stock component exists
      let effectiveDealPrice = dealPrice;
      if (acquirorBars && version.stockRatio) {
        const acqClose = acquirorBars.get(dateStr);
        if (acqClose !== undefined) {
          effectiveDealPrice =
            cashComponent +
            version.stockRatio.toNumber() * acqClose +
            dividends +
            cvrNpv;
        }
      }

      const spreadPct =
        ((effectiveDealPrice - bar.c) / bar.c) * 100;

      return {
        date: dateStr,
        close: bar.c,
        dealPrice: Math.round(effectiveDealPrice * 10000) / 10000,
        spreadPct: Math.round(spreadPct * 100) / 100,
      };
    });

    return NextResponse.json({
      ticker: deal.ticker,
      dealPrice,
      announcedDate: announcedDateStr,
      acquirorTicker: deal.acquirorTicker,
      hasStockComponent: !!(version.stockRatio && deal.acquirorTicker),
      history: spreadHistory,
    });
  } catch (err) {
    console.error("Error fetching spread history:", err);
    return NextResponse.json(
      { error: "Internal error fetching price history" },
      { status: 500 }
    );
  }
}
