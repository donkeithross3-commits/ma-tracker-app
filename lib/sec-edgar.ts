/**
 * SEC EDGAR Filing Fetcher Service
 *
 * Fetches company filings from the SEC's EDGAR system using the public data.sec.gov API.
 *
 * API Documentation: https://www.sec.gov/edgar/sec-api-documentation
 * Rate Limit: 10 requests per second
 */

const SEC_EDGAR_BASE_URL = "https://data.sec.gov";
const SEC_EDGAR_ARCHIVE_URL = "https://www.sec.gov/cgi-bin/browse-edgar";

// SEC requires User-Agent header with contact information
// Format: "Company Name email@domain.com"
// Using environment variable or fallback to generic contact
const USER_AGENT = process.env.SEC_EDGAR_USER_AGENT || "MA-Tracker-App admin@matracker.dev";

/**
 * Lookup CIK (Central Index Key) for a ticker symbol
 * Uses the company_tickers.json endpoint
 */
export async function lookupCIK(ticker: string): Promise<string | null> {
  try {
    const response = await fetch(`${SEC_EDGAR_BASE_URL}/files/company_tickers.json`, {
      headers: {
        "User-Agent": USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch company tickers: ${response.statusText}`);
    }

    const data = await response.json();

    // Find the company by ticker
    const company = Object.values(data as Record<string, any>).find(
      (c: any) => c.ticker?.toUpperCase() === ticker.toUpperCase()
    );

    if (!company) {
      return null;
    }

    // CIK must be 10 digits with leading zeros
    const cik = company.cik_str.toString().padStart(10, "0");
    return cik;
  } catch (error) {
    console.error(`Error looking up CIK for ${ticker}:`, error);
    return null;
  }
}

interface EdgarFiling {
  accessionNumber: string;
  filingDate: string;
  reportDate: string;
  acceptanceDateTime: string;
  act: string;
  form: string;
  fileNumber: string;
  filmNumber: string;
  items: string;
  size: number;
  isXBRL: number;
  isInlineXBRL: number;
  primaryDocument: string;
  primaryDocDescription: string;
}

interface CompanyFilings {
  cik: string;
  entityType: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      acceptanceDateTime: string[];
      act: string[];
      form: string[];
      fileNumber: string[];
      filmNumber: string[];
      items: string[];
      size: number[];
      isXBRL: number[];
      isInlineXBRL: number[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
  };
}

/**
 * Fetch company filings from SEC EDGAR
 * Returns submission data including filing history
 */
export async function fetchCompanyFilings(cik: string): Promise<CompanyFilings | null> {
  try {
    const response = await fetch(`${SEC_EDGAR_BASE_URL}/submissions/CIK${cik}.json`, {
      headers: {
        "User-Agent": USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch company filings: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error fetching company filings for CIK ${cik}:`, error);
    return null;
  }
}

/**
 * Filter filings by type (e.g., DEFM14A, 8-K, DEFA14A)
 */
export function filterFilingsByType(
  filings: CompanyFilings,
  filingTypes: string[]
): EdgarFiling[] {
  const { recent } = filings.filings;
  const results: EdgarFiling[] = [];

  for (let i = 0; i < recent.form.length; i++) {
    if (filingTypes.includes(recent.form[i])) {
      results.push({
        accessionNumber: recent.accessionNumber[i],
        filingDate: recent.filingDate[i],
        reportDate: recent.reportDate[i],
        acceptanceDateTime: recent.acceptanceDateTime[i],
        act: recent.act[i],
        form: recent.form[i],
        fileNumber: recent.fileNumber[i],
        filmNumber: recent.filmNumber[i],
        items: recent.items[i],
        size: recent.size[i],
        isXBRL: recent.isXBRL[i],
        isInlineXBRL: recent.isInlineXBRL[i],
        primaryDocument: recent.primaryDocument[i],
        primaryDocDescription: recent.primaryDocDescription[i],
      });
    }
  }

  return results;
}

/**
 * Get URL to filing document on EDGAR
 */
export function getFilingUrl(cik: string, accessionNumber: string, primaryDocument: string): string {
  // Remove dashes from accession number for URL path
  const accessionNumberNoDashes = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accessionNumberNoDashes}/${primaryDocument}`;
}

/**
 * Fetch the actual filing document content (HTML/text)
 */
export async function fetchFilingDocument(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch filing document: ${response.statusText}`);
    }

    const html = await response.text();
    return html;
  } catch (error) {
    console.error(`Error fetching filing document from ${url}:`, error);
    return null;
  }
}

/**
 * Extract plain text from HTML filing document
 * Removes HTML tags but preserves structure
 */
export function extractTextFromHtml(html: string): string {
  // Simple HTML tag removal - may need enhancement for complex documents
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "") // Remove scripts
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "") // Remove styles
    .replace(/<[^>]+>/g, " ") // Remove HTML tags
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

/**
 * Main function: Fetch merger-related filings for a ticker
 * Returns DEFM14A (definitive merger proxy), 8-K (material events), and DEFA14A (additional proxy materials)
 */
export async function fetchMergerFilings(ticker: string) {
  // Step 1: Lookup CIK
  const cik = await lookupCIK(ticker);
  if (!cik) {
    throw new Error(`Could not find CIK for ticker ${ticker}`);
  }

  // Step 2: Fetch company filings
  const filings = await fetchCompanyFilings(cik);
  if (!filings) {
    throw new Error(`Could not fetch filings for CIK ${cik}`);
  }

  // Step 3: Filter for merger-related filing types
  const mergerFilingTypes = ["DEFM14A", "8-K", "DEFA14A", "PREM14A", "SC 14D9"];
  const filteredFilings = filterFilingsByType(filings, mergerFilingTypes);

  // Step 4: Add URLs to each filing
  const filingsWithUrls = filteredFilings.map((filing) => ({
    ...filing,
    url: getFilingUrl(cik, filing.accessionNumber, filing.primaryDocument),
    cik,
    companyName: filings.name,
  }));

  return {
    cik,
    companyName: filings.name,
    ticker,
    filings: filingsWithUrls,
  };
}
