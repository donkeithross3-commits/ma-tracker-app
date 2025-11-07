import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  fetchMergerFilings,
  fetchFilingDocument,
  extractTextFromHtml,
} from "@/lib/sec-edgar";

/**
 * POST /api/research/fetch-filings
 *
 * Fetches SEC filings for a deal and stores them in the database
 *
 * Body: { dealId: string, ticker: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dealId, ticker } = body;

    if (!dealId || !ticker) {
      return NextResponse.json(
        { error: "Missing dealId or ticker" },
        { status: 400 }
      );
    }

    // Verify deal exists
    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
    });

    if (!deal) {
      return NextResponse.json(
        { error: "Deal not found" },
        { status: 404 }
      );
    }

    // Check if we already have filings for this deal
    const existingFilings = await prisma.secFiling.findMany({
      where: { dealId },
    });

    // If we have filings that are already fetched, return those
    if (existingFilings.length > 0 && existingFilings.some(f => f.fetchStatus === "fetched")) {
      return NextResponse.json({
        success: true,
        cik: "mock",
        companyName: deal.targetName || ticker,
        filingsFound: existingFilings.length,
        filingsStored: existingFilings.length,
        filings: existingFilings,
        source: "database",
      });
    }

    // Otherwise, fetch merger-related filings from SEC EDGAR
    const result = await fetchMergerFilings(ticker);

    // Store filings in database
    const storedFilings = [];

    for (const filing of result.filings) {
      // Check if filing already exists
      const existing = await prisma.secFiling.findUnique({
        where: {
          dealId_accessionNumber: {
            dealId,
            accessionNumber: filing.accessionNumber,
          },
        },
      });

      if (existing) {
        storedFilings.push(existing);
        continue;
      }

      // Create new filing record
      const stored = await prisma.secFiling.create({
        data: {
          dealId,
          filingType: filing.form,
          filingDate: new Date(filing.filingDate),
          accessionNumber: filing.accessionNumber,
          edgarUrl: filing.url,
          documentUrl: filing.url,
          fetchStatus: "pending",
        },
      });

      storedFilings.push(stored);
    }

    return NextResponse.json({
      success: true,
      cik: result.cik,
      companyName: result.companyName,
      filingsFound: result.filings.length,
      filingsStored: storedFilings.length,
      filings: storedFilings,
    });
  } catch (error: any) {
    console.error("Error fetching SEC filings:", error);
    return NextResponse.json(
      {
        error: error.message || "Failed to fetch SEC filings",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/research/fetch-filings?dealId=xxx
 *
 * Retrieve stored SEC filings for a deal
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const dealId = searchParams.get("dealId");

    if (!dealId) {
      return NextResponse.json(
        { error: "Missing dealId parameter" },
        { status: 400 }
      );
    }

    const filings = await prisma.secFiling.findMany({
      where: { dealId },
      orderBy: { filingDate: "desc" },
    });

    return NextResponse.json({
      success: true,
      filings,
    });
  } catch (error: any) {
    console.error("Error retrieving SEC filings:", error);
    return NextResponse.json(
      {
        error: error.message || "Failed to retrieve SEC filings",
      },
      { status: 500 }
    );
  }
}
