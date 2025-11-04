// Antitrust Risk Analyzer

import type {
  AnalysisContext,
  AnalysisResult,
  AIModel,
  PromptConfig,
  RiskLevel,
  ConfidenceLevel,
} from "../types";
import { getAnthropicClient } from "../anthropic-client";

const PROMPT_VERSION = "1.0.0";

/**
 * Analyze antitrust and regulatory risk for M&A deal
 */
export async function analyzeAntitrust(
  context: AnalysisContext,
  model: AIModel
): Promise<AnalysisResult> {
  const startTime = Date.now();
  const client = getAnthropicClient();

  const promptConfig = buildPromptConfig(context);

  const filingContent = context.filings
    .map((f) => `=== ${f.type} Filed ${f.date.toISOString().split("T")[0]} ===\n${f.content}`)
    .join("\n\n");

  const response = await client.generateAnalysis(
    promptConfig,
    filingContent,
    model,
    true
  );

  const parsed = parseAnalysisResponse(response.content);
  const processingTime = Date.now() - startTime;

  return {
    sectionType: "antitrust",
    sectionTitle: "Antitrust & Regulatory Risk Analysis",
    analysisMarkdown: parsed.markdown,
    riskScore: parsed.antitrustRiskScore,
    riskLevel: scoreToRiskLevel(parsed.antitrustRiskScore),
    confidence: parsed.confidence,
    keyPoints: parsed.keyPoints,
    extractedData: {
      marketOverlap: parsed.marketOverlap,
      regulatoryApprovals: parsed.regulatoryApprovals,
      timingRisk: parsed.timingRisk,
      remedies: parsed.remedies,
    },
    sourceFilingIds: context.filings.map((f) => f.id),
    aiModel: model,
    promptVersion: PROMPT_VERSION,
    processingTimeMs: processingTime,
    tokensUsed: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheCreation: response.usage.cache_creation_input_tokens,
      cacheRead: response.usage.cache_read_input_tokens,
    },
  };
}

function buildPromptConfig(context: AnalysisContext): PromptConfig {
  const systemPrompt = `You are an expert antitrust and M&A regulatory analyst.

Analyze SEC filings to assess regulatory risk for this merger. Focus on:

## Key Risk Factors

1. **Market Concentration**
   - Combined market share in relevant markets
   - Horizontal overlap (direct competitors)
   - Vertical integration concerns
   - HHI (Herfindahl-Hirschman Index) if mentioned

2. **Regulatory Approvals Required**
   - FTC/DOJ Hart-Scott-Rodino (HSR) filing
   - EU Commission (if applicable)
   - Foreign investment reviews (CFIUS, etc.)
   - Industry-specific regulators

3. **Timing and Conditions**
   - Expected regulatory review timeline
   - History of similar deals in industry
   - Regulatory conditions or commitments
   - Termination date and extensions

4. **Remedies and Divestitures**
   - Proposed divestitures to address concerns
   - Behavioral remedies
   - Likelihood of acceptance

## Output Format

Return JSON:
{
  "antitrustRiskScore": <0-100>,
  "confidence": "low" | "medium" | "high",
  "keyPoints": [<3-5 key findings>],
  "marketOverlap": {
    "exists": <boolean>,
    "markets": [<list of overlapping markets>],
    "combinedMarketShare": "<percentage or range>",
    "assessment": "low" | "moderate" | "high"
  },
  "regulatoryApprovals": [
    {
      "agency": "<name>",
      "jurisdiction": "<country/region>",
      "status": "pending" | "filed" | "approved" | "unknown",
      "expectedCompletion": "<date or timeframe>",
      "concerns": "<any issues raised>"
    }
  ],
  "timingRisk": {
    "expectedClose": "<date>",
    "terminationDate": "<date>",
    "extensions": <boolean>,
    "likelihood": "on-time" | "delayed" | "at-risk"
  },
  "remedies": {
    "proposed": [<list of remedies/divestitures>],
    "likelihood": "likely sufficient" | "may require more" | "insufficient"
  },
  "markdown": "<Full analysis>"
}`;

  const userPrompt = `Analyze antitrust risk:

**Deal:** ${context.acquirerCompany} + ${context.targetCompany}
**Ticker:** ${context.ticker}
**Deal Price:** $${context.dealPrice}
**Announced:** ${context.dealAnnounced.toISOString().split("T")[0]}

Assess regulatory approval risk and timeline.`;

  return {
    systemPrompt,
    userPrompt,
    temperature: 0.2,
    maxTokens: 8000,
    version: PROMPT_VERSION,
  };
}

interface ParsedResponse {
  antitrustRiskScore: number;
  confidence: ConfidenceLevel;
  keyPoints: string[];
  marketOverlap: {
    exists: boolean;
    markets: string[];
    combinedMarketShare: string;
    assessment: string;
  };
  regulatoryApprovals: Array<{
    agency: string;
    jurisdiction: string;
    status: string;
    expectedCompletion: string;
    concerns: string;
  }>;
  timingRisk: {
    expectedClose: string;
    terminationDate: string;
    extensions: boolean;
    likelihood: string;
  };
  remedies: {
    proposed: string[];
    likelihood: string;
  };
  markdown: string;
}

function parseAnalysisResponse(content: string): ParsedResponse {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      antitrustRiskScore: parsed.antitrustRiskScore ?? 0,
      confidence: parsed.confidence ?? "medium",
      keyPoints: parsed.keyPoints ?? [],
      marketOverlap: parsed.marketOverlap ?? {
        exists: false,
        markets: [],
        combinedMarketShare: "unknown",
        assessment: "unknown",
      },
      regulatoryApprovals: parsed.regulatoryApprovals ?? [],
      timingRisk: parsed.timingRisk ?? {
        expectedClose: "unknown",
        terminationDate: "unknown",
        extensions: false,
        likelihood: "unknown",
      },
      remedies: parsed.remedies ?? { proposed: [], likelihood: "unknown" },
      markdown: parsed.markdown ?? content,
    };
  } catch (error) {
    console.error("Failed to parse antitrust response:", error);
    return {
      antitrustRiskScore: 0,
      confidence: "low",
      keyPoints: [],
      marketOverlap: {
        exists: false,
        markets: [],
        combinedMarketShare: "unknown",
        assessment: "unknown",
      },
      regulatoryApprovals: [],
      timingRisk: {
        expectedClose: "unknown",
        terminationDate: "unknown",
        extensions: false,
        likelihood: "unknown",
      },
      remedies: { proposed: [], likelihood: "unknown" },
      markdown: content,
    };
  }
}

function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}
