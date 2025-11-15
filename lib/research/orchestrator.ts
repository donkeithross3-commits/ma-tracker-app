// Research Report Orchestrator
// Coordinates running all analysis modules and assembling the final report

import { prisma } from "../db";
import type {
  AnalysisContext,
  AnalysisModuleType,
  ReportGenerationOptions,
  AIModel,
  AnalysisResult,
} from "./types";
import { DEFAULT_MODEL } from "./anthropic-client";
import { analyzeToppingBid } from "./analyzers/toppingBidAnalyzer";
import { analyzeAntitrust } from "./analyzers/antitrustAnalyzer";
import { analyzeContract } from "./analyzers/contractAnalyzer";
import { runModelComparison } from "./ab-testing";

/**
 * Generate complete research report for a deal
 */
export async function generateResearchReport(
  dealId: string,
  options: ReportGenerationOptions = {}
): Promise<{
  reportId: string;
  status: string;
  sections: AnalysisResult[];
  totalCost: number;
  totalTimeMs: number;
}> {
  const startTime = Date.now();

  // Get deal data from database
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      secFilings: {
        where: {
          fetchStatus: "fetched",
        },
        orderBy: { filingDate: "desc" },
      },
      versions: {
        where: { isCurrentVersion: true },
        take: 1,
      },
    },
  });

  if (!deal) {
    throw new Error(`Deal not found: ${dealId}`);
  }

  if (deal.secFilings.length === 0) {
    throw new Error(
      "No SEC filings available. Run /api/research/fetch-filings first."
    );
  }

  // Get current version for deal terms
  const currentVersion = deal.versions[0];

  // Build analysis context
  const context: AnalysisContext = {
    dealId: deal.id,
    ticker: deal.ticker,
    targetCompany: deal.targetName || deal.ticker,
    acquirerCompany: deal.acquirorName || deal.acquirorTicker || "Unknown",
    dealPrice: currentVersion?.cashPerShare?.toNumber() || 0,
    dealAnnounced: currentVersion?.announcedDate || new Date(),
    filings: deal.secFilings.map((f) => ({
      id: f.id,
      type: f.filingType,
      date: f.filingDate,
      content: f.textExtracted || f.htmlText || "",
      url: f.edgarUrl,
    })),
  };

  // Create or update report record (delete existing if present)
  await prisma.dealResearchReport.deleteMany({
    where: { dealId: deal.id },
  });

  const report = await prisma.dealResearchReport.create({
    data: {
      dealId: deal.id,
      generatedAt: new Date(),
      status: "generating",
      reportVersion: 1,
    },
  });

  try {
    // Determine which modules to run
    const modules: AnalysisModuleType[] = options.modules || [
      "topping_bid",
      "antitrust",
      "contract",
    ];

    let sections: AnalysisResult[];

    // Run A/B test if requested
    if (options.compareModels) {
      sections = await runComparisonMode(context, modules);
    } else {
      // Run normal analysis with single model
      sections = await runAnalysisModules(
        context,
        modules,
        options.model || DEFAULT_MODEL,
        options.useCache ?? true
      );
    }

    // Save sections to database
    await Promise.all(
      sections.map((section) =>
        prisma.reportSection.create({
          data: {
            reportId: report.id,
            sectionType: section.sectionType,
            sectionTitle: section.sectionTitle,
            analysisMarkdown: section.analysisMarkdown,
            riskScore: section.riskScore,
            confidence: section.confidence,
            extractedData: section.extractedData as any,
            keyPoints: section.keyPoints as any,
            sourceFilingIds: section.sourceFilingIds,
            aiModel: section.aiModel,
            promptVersion: section.promptVersion,
            generatedAt: new Date(),
            status: "completed",
            processingTimeMs: section.processingTimeMs,
          },
        })
      )
    );

    // Calculate aggregate scores
    const avgRiskScore = Math.round(
      sections.reduce((sum, s) => sum + s.riskScore, 0) / sections.length
    );

    // Generate executive summary
    const executiveSummary = await generateExecutiveSummary(
      context,
      sections
    );

    // Extract key findings
    const keyFindings = sections.flatMap((s) => s.keyPoints).slice(0, 10);

    // Update report with final data
    const totalTimeMs = Date.now() - startTime;
    const totalCost = 0; // TODO: Calculate from token usage

    await prisma.dealResearchReport.update({
      where: { id: report.id },
      data: {
        status: "completed",
        overallRiskScore: avgRiskScore,
        antitrustRiskScore: sections.find((s) => s.sectionType === "antitrust")
          ?.riskScore,
        contractRiskScore: sections.find((s) => s.sectionType === "contract")
          ?.riskScore,
        toppingBidScore: sections.find((s) => s.sectionType === "topping_bid")
          ?.riskScore,
        executiveSummary,
        keyFindings: keyFindings as any,
      },
    });

    return {
      reportId: report.id,
      status: "completed",
      sections,
      totalCost,
      totalTimeMs,
    };
  } catch (error) {
    // Mark report as failed
    await prisma.dealResearchReport.update({
      where: { id: report.id },
      data: { status: "error" },
    });

    throw error;
  }
}

/**
 * Run analysis modules in parallel with single model
 */
async function runAnalysisModules(
  context: AnalysisContext,
  modules: AnalysisModuleType[],
  model: AIModel,
  useCache: boolean
): Promise<AnalysisResult[]> {
  const analyzers = modules.map((module) => {
    switch (module) {
      case "topping_bid":
        return analyzeToppingBid(context, model);
      case "antitrust":
        return analyzeAntitrust(context, model);
      case "contract":
        return analyzeContract(context, model);
      default:
        throw new Error(`Unknown module: ${module}`);
    }
  });

  return Promise.all(analyzers);
}

/**
 * Run A/B comparison mode - tests all models on all modules
 */
async function runComparisonMode(
  context: AnalysisContext,
  modules: AnalysisModuleType[]
): Promise<AnalysisResult[]> {
  const allModels: AIModel[] = [
    "claude-3-5-haiku-20241022",
    "claude-3-5-sonnet-20241022",
    "claude-opus-4-20250514",
  ];

  // Run comparisons for each module
  const comparisons = await Promise.all(
    modules.map((module) => runModelComparison(context, module, allModels))
  );

  // For now, return the Sonnet results (best balance)
  // In future, we could save all comparison data
  return comparisons.map(
    (comp) =>
      comp.models.find((m) => m.model.includes("sonnet"))!.result
  );
}

/**
 * Generate executive summary combining all sections
 */
async function generateExecutiveSummary(
  context: AnalysisContext,
  sections: AnalysisResult[]
): Promise<string> {
  const riskLevels = sections.map((s) => s.riskLevel);
  const highestRisk = riskLevels.includes("critical")
    ? "critical"
    : riskLevels.includes("high")
      ? "high"
      : riskLevels.includes("medium")
        ? "medium"
        : "low";

  const summary = `
## Executive Summary

**Deal:** ${context.acquirerCompany} acquiring ${context.targetCompany} (${context.ticker}) for $${context.dealPrice.toFixed(2)}/share

**Overall Risk Level:** ${highestRisk.toUpperCase()}

**Key Findings:**

${sections
  .map(
    (s) => `
### ${s.sectionTitle}
- Risk Score: ${s.riskScore}/100 (${s.riskLevel})
- Confidence: ${s.confidence}
${s.keyPoints.slice(0, 3).map((p) => `- ${p}`).join("\n")}
`
  )
  .join("\n")}

**Analysis Date:** ${new Date().toISOString().split("T")[0]}
`.trim();

  return summary;
}

/**
 * Get existing report for a deal
 */
export async function getResearchReport(dealId: string) {
  const report = await prisma.dealResearchReport.findUnique({
    where: { dealId },
    include: {
      sections: {
        orderBy: { generatedAt: "desc" },
      },
    },
  });

  return report;
}

/**
 * Check if deal has filings ready for analysis
 */
export async function isDealReadyForAnalysis(dealId: string): Promise<{
  ready: boolean;
  reason?: string;
  filingsCount: number;
}> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      secFilings: {
        where: { fetchStatus: "fetched" },
      },
    },
  });

  if (!deal) {
    return { ready: false, reason: "Deal not found", filingsCount: 0 };
  }

  if (deal.secFilings.length === 0) {
    return {
      ready: false,
      reason: "No SEC filings fetched yet",
      filingsCount: 0,
    };
  }

  return { ready: true, filingsCount: deal.secFilings.length };
}
