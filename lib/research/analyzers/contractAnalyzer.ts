// M&A Contract Analysis

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
 * Analyze merger agreement for unusual terms and risk factors
 */
export async function analyzeContract(
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
    sectionType: "contract",
    sectionTitle: "Merger Agreement Analysis",
    analysisMarkdown: parsed.markdown,
    riskScore: parsed.contractRiskScore,
    riskLevel: scoreToRiskLevel(parsed.contractRiskScore),
    confidence: parsed.confidence,
    keyPoints: parsed.keyPoints,
    extractedData: {
      terminationRights: parsed.terminationRights,
      closingConditions: parsed.closingConditions,
      materialAdverseEffect: parsed.materialAdverseEffect,
      financingConditions: parsed.financingConditions,
      unusualProvisions: parsed.unusualProvisions,
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
  const systemPrompt = `You are an expert M&A contract analyst specializing in merger agreement risk assessment.

Analyze the merger agreement for terms that could affect deal completion or shareholder value.

## Key Areas to Examine

1. **Termination Rights**
   - Conditions under which either party can walk away
   - Termination fees (reverse break fees)
   - Specific performance rights
   - Force majeure clauses

2. **Closing Conditions**
   - Regulatory approvals required
   - Shareholder approval thresholds
   - Third-party consents needed
   - Any unusual conditions

3. **Material Adverse Effect (MAE/MAC)**
   - Definition of material adverse effect
   - Carve-outs and exceptions
   - How broad or narrow the definition is

4. **Financing**
   - Financing commitment status
   - Financing conditions or contingencies
   - Reverse termination fees if financing fails

5. **Unusual Provisions**
   - Any non-standard terms
   - Seller protections or lack thereof
   - Deal protection measures
   - Interim operating covenants

## Output Format

Return JSON:
{
  "contractRiskScore": <0-100>,
  "confidence": "low" | "medium" | "high",
  "keyPoints": [<3-5 key findings>],
  "terminationRights": {
    "targetCanTerminate": [<conditions>],
    "acquirerCanTerminate": [<conditions>],
    "terminationFee": {
      "amount": <number>,
      "payer": "target" | "acquirer" | "both",
      "percentage": <percent of deal value>
    },
    "reverseBreakFee": {
      "exists": <boolean>,
      "amount": <number or null>,
      "triggers": [<what triggers it>]
    }
  },
  "closingConditions": {
    "standard": [<list of standard conditions>],
    "unusual": [<any non-standard conditions>],
    "riskAssessment": "low" | "medium" | "high"
  },
  "materialAdverseEffect": {
    "definitionBreadth": "narrow" | "standard" | "broad",
    "carveouts": [<list of exceptions>],
    "covidRelated": "<any pandemic-related provisions>",
    "assessment": "seller-friendly" | "balanced" | "buyer-friendly"
  },
  "financingConditions": {
    "committed": <boolean>,
    "contingent": <boolean>,
    "reverseTerminationFee": <number or null>,
    "riskLevel": "low" | "medium" | "high"
  },
  "unusualProvisions": [
    {
      "provision": "<name>",
      "description": "<what it does>",
      "impact": "positive" | "neutral" | "negative"
    }
  ],
  "markdown": "<Full analysis>"
}`;

  const userPrompt = `Analyze the merger agreement:

**Deal:** ${context.acquirerCompany} + ${context.targetCompany}
**Ticker:** ${context.ticker}
**Deal Price:** $${context.dealPrice}
**Announced:** ${context.dealAnnounced.toISOString().split("T")[0]}

Focus on terms that could affect deal completion or create risk.`;

  return {
    systemPrompt,
    userPrompt,
    temperature: 0.2,
    maxTokens: 8000,
    version: PROMPT_VERSION,
  };
}

interface ParsedResponse {
  contractRiskScore: number;
  confidence: ConfidenceLevel;
  keyPoints: string[];
  terminationRights: unknown;
  closingConditions: unknown;
  materialAdverseEffect: unknown;
  financingConditions: unknown;
  unusualProvisions: unknown;
  markdown: string;
}

function parseAnalysisResponse(content: string): ParsedResponse {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      contractRiskScore: parsed.contractRiskScore ?? 0,
      confidence: parsed.confidence ?? "medium",
      keyPoints: parsed.keyPoints ?? [],
      terminationRights: parsed.terminationRights ?? {},
      closingConditions: parsed.closingConditions ?? {},
      materialAdverseEffect: parsed.materialAdverseEffect ?? {},
      financingConditions: parsed.financingConditions ?? {},
      unusualProvisions: parsed.unusualProvisions ?? [],
      markdown: parsed.markdown ?? content,
    };
  } catch (error) {
    console.error("Failed to parse contract response:", error);
    return {
      contractRiskScore: 0,
      confidence: "low",
      keyPoints: [],
      terminationRights: {},
      closingConditions: {},
      materialAdverseEffect: {},
      financingConditions: {},
      unusualProvisions: [],
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
