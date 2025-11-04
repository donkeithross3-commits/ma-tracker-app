// Topping Bid Detection Analyzer
// Based on "hidden topping bid" pattern from YAVB blog

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
 * Analyze merger proxy filings for potential topping bid signals
 *
 * Key patterns to detect:
 * 1. Rejected higher bids mentioned in DEFM14A
 * 2. Evidence of topping bid provisions in contract
 * 3. Unusual termination fee structures
 * 4. Go-shop provisions or lack thereof
 * 5. Evidence of strategic interest from other parties
 */
export async function analyzeToppingBid(
  context: AnalysisContext,
  model: AIModel
): Promise<AnalysisResult> {
  const startTime = Date.now();
  const client = getAnthropicClient();

  // Build prompt configuration
  const promptConfig = buildPromptConfig(context);

  // Prepare filing content
  const filingContent = context.filings
    .map(
      (f) => `
=== ${f.type} Filed ${f.date.toISOString().split("T")[0]} ===
URL: ${f.url}

${f.content}
`
    )
    .join("\n\n");

  // Call Claude API
  const response = await client.generateAnalysis(
    promptConfig,
    filingContent,
    model,
    true // Use prompt caching
  );

  // Parse structured response
  const parsed = parseAnalysisResponse(response.content);

  // Calculate cost
  const cost = client.calculateCost(response.usage, model);

  const processingTime = Date.now() - startTime;

  return {
    sectionType: "topping_bid",
    sectionTitle: "Topping Bid Analysis",
    analysisMarkdown: parsed.markdown,
    riskScore: parsed.toppingBidScore,
    riskLevel: scoreToRiskLevel(parsed.toppingBidScore),
    confidence: parsed.confidence,
    keyPoints: parsed.keyPoints,
    extractedData: {
      rejectedBids: parsed.rejectedBids,
      goShopProvision: parsed.goShopProvision,
      terminationFee: parsed.terminationFee,
      matchingRights: parsed.matchingRights,
      competitiveInterest: parsed.competitiveInterest,
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
  const systemPrompt = `You are an expert merger arbitrage analyst specializing in detecting topping bid potential in M&A transactions.

Your task is to analyze SEC filings (DEFM14A merger proxies, 8-Ks) to identify signals that a competing offer might emerge.

## Key Patterns to Detect

### 1. Rejected Higher Bids
- Previous offers from other parties at higher prices
- Companies that were in negotiations but dropped out
- Evidence that target shopped itself before accepting current bid

### 2. Contract Provisions
- Go-shop provisions (allows target to solicit other bids)
- Matching rights (acquirer can match competing offers)
- Fiduciary out clauses (board can accept superior proposal)
- Termination fee structure (lower fees = easier to switch)

### 3. Strategic Interest
- Multiple parties conducted due diligence
- Evidence of strategic buyers who might still be interested
- Signs of regret from target or acquirer about price

### 4. Market Context
- Deal announced at significant discount to 52-week high
- Industry consolidation creating multiple potential buyers
- Strategic value that might justify higher bid

## Output Format

Return a JSON object with this structure:

{
  "toppingBidScore": <number 0-100>,
  "confidence": "low" | "medium" | "high",
  "keyPoints": [<array of 3-5 key findings>],
  "rejectedBids": [
    {
      "bidder": "<company name>",
      "pricePerShare": <number or "undisclosed">,
      "dateDiscussed": "<date or range>",
      "reasonRejected": "<brief explanation>"
    }
  ],
  "goShopProvision": {
    "exists": <boolean>,
    "durationDays": <number or null>,
    "expired": <boolean or null>
  },
  "terminationFee": {
    "amount": <number or null>,
    "percentOfDealValue": <number or null>,
    "assessment": "low" | "standard" | "high"
  },
  "matchingRights": {
    "exists": <boolean>,
    "details": "<brief description>"
  },
  "competitiveInterest": {
    "otherPartiesIdentified": <number>,
    "strategicRationale": "<why others might bid>",
    "likelihood": "low" | "medium" | "high"
  },
  "markdown": "<Full markdown analysis>"
}

The markdown should include:
1. Executive summary (2-3 sentences)
2. Rejected bids section (if any)
3. Contract analysis
4. Strategic assessment
5. Likelihood of topping bid

Be specific. Quote relevant passages. Cite filing types and dates.`;

  const userPrompt = `Analyze the following SEC filings for topping bid potential:

**Deal:** ${context.acquirerCompany} acquiring ${context.targetCompany} (${context.ticker})
**Deal Price:** $${context.dealPrice.toFixed(2)} per share
**Announced:** ${context.dealAnnounced.toISOString().split("T")[0]}

Focus on:
1. Any rejected bids or previous offers
2. Go-shop provisions or matching rights
3. Evidence of other interested parties
4. Contract terms that affect topping bid likelihood`;

  return {
    systemPrompt,
    userPrompt,
    temperature: 0.2, // Lower temperature for analytical work
    maxTokens: 8000,
    version: PROMPT_VERSION,
  };
}

interface ParsedResponse {
  toppingBidScore: number;
  confidence: ConfidenceLevel;
  keyPoints: string[];
  rejectedBids: Array<{
    bidder: string;
    pricePerShare: number | string;
    dateDiscussed: string;
    reasonRejected: string;
  }>;
  goShopProvision: {
    exists: boolean;
    durationDays: number | null;
    expired: boolean | null;
  };
  terminationFee: {
    amount: number | null;
    percentOfDealValue: number | null;
    assessment: string;
  };
  matchingRights: {
    exists: boolean;
    details: string;
  };
  competitiveInterest: {
    otherPartiesIdentified: number;
    strategicRationale: string;
    likelihood: string;
  };
  markdown: string;
}

function parseAnalysisResponse(content: string): ParsedResponse {
  try {
    // Look for JSON in the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      toppingBidScore: parsed.toppingBidScore ?? 0,
      confidence: parsed.confidence ?? "medium",
      keyPoints: parsed.keyPoints ?? [],
      rejectedBids: parsed.rejectedBids ?? [],
      goShopProvision: parsed.goShopProvision ?? {
        exists: false,
        durationDays: null,
        expired: null,
      },
      terminationFee: parsed.terminationFee ?? {
        amount: null,
        percentOfDealValue: null,
        assessment: "unknown",
      },
      matchingRights: parsed.matchingRights ?? {
        exists: false,
        details: "",
      },
      competitiveInterest: parsed.competitiveInterest ?? {
        otherPartiesIdentified: 0,
        strategicRationale: "",
        likelihood: "low",
      },
      markdown: parsed.markdown ?? content,
    };
  } catch (error) {
    console.error("Failed to parse analysis response:", error);
    // Fallback: use raw content as markdown
    return {
      toppingBidScore: 0,
      confidence: "low",
      keyPoints: [],
      rejectedBids: [],
      goShopProvision: { exists: false, durationDays: null, expired: null },
      terminationFee: {
        amount: null,
        percentOfDealValue: null,
        assessment: "unknown",
      },
      matchingRights: { exists: false, details: "" },
      competitiveInterest: {
        otherPartiesIdentified: 0,
        strategicRationale: "",
        likelihood: "low",
      },
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
