import { NextRequest, NextResponse } from "next/server";

interface SECCompany {
  cik_str: number;
  ticker: string;
  title: string;
}

interface TickerMatch {
  ticker: string;
  name: string;
}

// In-memory cache for SEC company data
let cachedCompanies: SECCompany[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const SEC_EDGAR_BASE_URL = "https://www.sec.gov";
const USER_AGENT =
  process.env.SEC_EDGAR_USER_AGENT || "MA-Tracker-App admin@matracker.dev";

async function fetchAndCacheCompanies(): Promise<SECCompany[]> {
  const now = Date.now();

  // Return cached data if still valid
  if (cachedCompanies && now - cacheTimestamp < CACHE_TTL) {
    return cachedCompanies;
  }

  try {
    const response = await fetch(
      `${SEC_EDGAR_BASE_URL}/files/company_tickers.json`,
      {
        headers: {
          "User-Agent": USER_AGENT,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch company tickers: ${response.statusText}`);
    }

    const data = await response.json();

    // Convert object to array
    cachedCompanies = Object.values(data as Record<string, SECCompany>);
    cacheTimestamp = now;

    console.log(`Cached ${cachedCompanies.length} companies from SEC EDGAR`);
    return cachedCompanies;
  } catch (error) {
    console.error("Error fetching SEC company data:", error);

    // Return cached data even if expired, rather than failing
    if (cachedCompanies) {
      return cachedCompanies;
    }

    throw error;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q")?.trim().toUpperCase();

  if (!query || query.length < 1) {
    return NextResponse.json({ matches: [] });
  }

  try {
    const companies = await fetchAndCacheCompanies();

    // Search for matches - prioritize ticker matches, then name matches
    const tickerMatches: TickerMatch[] = [];
    const nameMatches: TickerMatch[] = [];

    for (const company of companies) {
      if (!company.ticker) continue;

      const ticker = company.ticker.toUpperCase();
      const name = company.title || "";

      // Exact ticker match goes first
      if (ticker === query) {
        tickerMatches.unshift({ ticker, name });
      }
      // Ticker starts with query
      else if (ticker.startsWith(query)) {
        tickerMatches.push({ ticker, name });
      }
      // Name contains query
      else if (name.toUpperCase().includes(query)) {
        nameMatches.push({ ticker, name });
      }
    }

    // Combine results: ticker matches first, then name matches, limit to 10
    const matches = [...tickerMatches, ...nameMatches].slice(0, 10);

    return NextResponse.json({ matches });
  } catch (error) {
    console.error("Error in ticker lookup:", error);
    return NextResponse.json(
      { error: "Failed to lookup ticker" },
      { status: 500 }
    );
  }
}
