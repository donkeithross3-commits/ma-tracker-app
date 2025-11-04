// API Route: Generate AI Research Report

import { NextRequest, NextResponse } from "next/server";
import {
  generateResearchReport,
  getResearchReport,
  isDealReadyForAnalysis,
} from "@/lib/research/orchestrator";
import type { ReportGenerationOptions } from "@/lib/research/types";

/**
 * POST /api/research/generate-report
 *
 * Generate AI-powered research report for a deal
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dealId, options } = body as {
      dealId: string;
      options?: ReportGenerationOptions;
    };

    if (!dealId) {
      return NextResponse.json(
        { error: "Missing required field: dealId" },
        { status: 400 }
      );
    }

    // Check if deal is ready for analysis
    const readiness = await isDealReadyForAnalysis(dealId);
    if (!readiness.ready) {
      return NextResponse.json(
        {
          error: "Deal not ready for analysis",
          reason: readiness.reason,
          filingsCount: readiness.filingsCount,
          suggestion:
            "Run POST /api/research/fetch-filings first to get SEC filings",
        },
        { status: 400 }
      );
    }

    // Generate report
    const result = await generateResearchReport(dealId, options);

    return NextResponse.json({
      success: true,
      reportId: result.reportId,
      status: result.status,
      sectionsGenerated: result.sections.length,
      totalCost: result.totalCost,
      totalTimeMs: result.totalTimeMs,
      sections: result.sections.map((s) => ({
        type: s.sectionType,
        title: s.sectionTitle,
        riskScore: s.riskScore,
        riskLevel: s.riskLevel,
        confidence: s.confidence,
        keyPoints: s.keyPoints,
        model: s.aiModel,
        processingTimeMs: s.processingTimeMs,
      })),
    });
  } catch (error) {
    console.error("Error generating research report:", error);
    return NextResponse.json(
      {
        error: "Failed to generate research report",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/research/generate-report?dealId={uuid}
 *
 * Get existing research report for a deal
 */
export async function GET(request: NextRequest) {
  try {
    const dealId = request.nextUrl.searchParams.get("dealId");

    if (!dealId) {
      return NextResponse.json(
        { error: "Missing query parameter: dealId" },
        { status: 400 }
      );
    }

    const report = await getResearchReport(dealId);

    if (!report) {
      return NextResponse.json(
        {
          error: "No report found for this deal",
          suggestion: "POST to this endpoint to generate a new report",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      report: {
        id: report.id,
        dealId: report.dealId,
        version: report.reportVersion,
        status: report.status,
        generatedAt: report.generatedAt,
        overallRiskScore: report.overallRiskScore,
        antitrustRiskScore: report.antitrustRiskScore,
        contractRiskScore: report.contractRiskScore,
        toppingBidScore: report.toppingBidScore,
        executiveSummary: report.executiveSummary,
        keyFindings: report.keyFindings,
        sections: report.sections.map((s) => ({
          id: s.id,
          type: s.sectionType,
          title: s.sectionTitle,
          analysisMarkdown: s.analysisMarkdown,
          riskScore: s.riskScore,
          confidence: s.confidence,
          keyPoints: s.keyPoints,
          extractedData: s.extractedData,
          aiModel: s.aiModel,
          promptVersion: s.promptVersion,
          processingTimeMs: s.processingTimeMs,
          generatedAt: s.generatedAt,
        })),
      },
    });
  } catch (error) {
    console.error("Error retrieving research report:", error);
    return NextResponse.json(
      {
        error: "Failed to retrieve research report",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
