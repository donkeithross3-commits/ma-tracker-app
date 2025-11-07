// Anthropic Claude API Client with Prompt Caching

import Anthropic from "@anthropic-ai/sdk";
import type { AIModel, PromptConfig } from "./types";

// Model pricing (per 1M tokens)
const MODEL_PRICING = {
  "claude-3-5-sonnet-20241022": {
    input: 3.0,
    output: 15.0,
    cacheCreation: 3.75,
    cacheRead: 0.3,
  },
  "claude-3-5-haiku-20241022": {
    input: 1.0,
    output: 5.0,
    cacheCreation: 1.25,
    cacheRead: 0.1,
  },
  "claude-opus-4-20250514": {
    input: 15.0,
    output: 75.0,
    cacheCreation: 18.75,
    cacheRead: 1.5,
  },
} as const;

export interface ClaudeResponse {
  content: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  model: AIModel;
}

export class AnthropicClient {
  private client: Anthropic | null;
  private hasApiKey: boolean;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    this.hasApiKey = !!key && key !== "sk-ant-api03-placeholder-replace-with-real-key";

    if (this.hasApiKey) {
      this.client = new Anthropic({ apiKey: key });
    } else {
      this.client = null;
      console.warn("⚠️  No Anthropic API key configured - using mock analysis data");
    }
  }

  /**
   * Call Claude API with prompt caching for repeated analysis
   */
  async generateAnalysis(
    config: PromptConfig,
    context: string,
    model: AIModel = "claude-3-5-sonnet-20241022",
    useCache: boolean = true
  ): Promise<ClaudeResponse> {
    const startTime = Date.now();

    // If no API key, return mock data for testing
    if (!this.hasApiKey || !this.client) {
      console.log("📝 Returning mock analysis data (no API key configured)");
      return this.generateMockAnalysis(config, context, model);
    }

    try {
      // Use prompt caching for the system prompt (contains filing content)
      // This allows reuse across multiple analysis modules for the same deal
      const systemBlocks = useCache
        ? [
            {
              type: "text" as const,
              text: config.systemPrompt,
              cache_control: { type: "ephemeral" as const },
            },
          ]
        : [{ type: "text" as const, text: config.systemPrompt }];

      const response = await this.client.messages.create({
        model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system: systemBlocks,
        messages: [
          {
            role: "user",
            content: config.userPrompt + "\n\n" + context,
          },
        ],
      });

      const content =
        response.content[0].type === "text"
          ? response.content[0].text
          : "";

      return {
        content,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          cache_creation_input_tokens:
            response.usage.cache_creation_input_tokens,
          cache_read_input_tokens: response.usage.cache_read_input_tokens,
        },
        model,
      };
    } catch (error) {
      console.error("Anthropic API error:", error);
      throw new Error(
        `Failed to generate analysis: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Generate mock analysis data for testing when no API key is available
   */
  private generateMockAnalysis(
    config: PromptConfig,
    context: string,
    model: AIModel
  ): ClaudeResponse {
    // Determine which analyzer is calling based on the system prompt
    let mockContent = "";

    if (config.systemPrompt.includes("topping bid") || config.systemPrompt.includes("rival bidder")) {
      mockContent = JSON.stringify({
        score: 35,
        likelihood: "Moderate",
        analysis: "The go-shop provision creates opportunity for topping bids, but the termination fees are substantial. The deal premium is attractive but not insurmountable for well-capitalized competitors.",
        keyFactors: [
          "45-day go-shop period allows solicitation of alternative proposals",
          "Termination fee of $850M during go-shop (2% of deal value) is reasonable",
          "Strategic interest from other industry players is likely given target's market position",
          "Financing commitments from acquirer are solid, reducing deal risk"
        ],
        potentialBidders: [
          "Private equity firms with gaming portfolios",
          "Strategic competitors seeking market consolidation",
          "International gaming companies expanding into North America"
        ],
        recommendation: "Monitor for topping bid announcements during go-shop period. Current spread suggests market assigns moderate probability to competing offers."
      });
    } else if (config.systemPrompt.includes("antitrust") || config.systemPrompt.includes("regulatory") || config.systemPrompt.includes("FTC") || config.systemPrompt.includes("DOJ")) {
      mockContent = JSON.stringify({
        score: 55,
        riskLevel: "Moderate-High",
        analysis: "The merger presents meaningful antitrust concerns due to market concentration in certain gaming segments. HSR review likely to be extended with second request. International approvals add timeline risk.",
        keyIssues: [
          "Horizontal overlap in sports gaming franchises creates concentration concerns",
          "Combined company would control 45%+ of sports simulation gaming market",
          "Mobile gaming assets overlap requires remedies discussion",
          "FTC has been aggressive on gaming industry consolidation recently"
        ],
        timelineRisk: {
          expectedReview: "6-9 months for US regulatory clearance",
          secondRequestProbability: "75% - significant market overlap",
          internationalReviews: "EU and China reviews add 3-6 months",
          failureRisk: "20% - material but not prohibitive"
        },
        remedies: [
          "Potential divestiture of overlapping mobile gaming titles",
          "Licensing agreements for certain sports franchises",
          "Behavioral remedies around exclusive content deals"
        ],
        recommendation: "Antitrust risk is material but manageable. Parties have shown willingness to negotiate remedies. Reverse termination fee of $2B provides downside protection."
      });
    } else if (config.systemPrompt.includes("contract") || config.systemPrompt.includes("MAC") || config.systemPrompt.includes("covenant")) {
      mockContent = JSON.stringify({
        score: 25,
        riskLevel: "Low",
        analysis: "Merger agreement contains standard terms and conditions typical for transactions of this size. MAC definition is narrowly tailored. Buyer financing is solid with no financing condition.",
        keyTerms: [
          "Material Adverse Change clause is buyer-friendly with standard carveouts",
          "Interim operating covenants are reasonable for ordinary course business",
          "No financing condition - committed debt facilities in place",
          "Specific performance provisions strengthen deal certainty"
        ],
        strengths: [
          "Reverse termination fee of $2B (4.8% of deal value) is substantial",
          "Financing commitments from top-tier banks with no Material Adverse Change out",
          "Limited conditions to closing reduce execution risk",
          "Clear regulatory effort obligations from both parties"
        ],
        risks: [
          "Target must operate in ordinary course - limits strategic flexibility during pendency",
          "Employee retention provisions may impact operations if deal extends",
          "Third-party consents could delay closing in specific business lines"
        ],
        recommendation: "Contract terms are well-structured and favor deal completion. Low probability of contract-based deal failure. Standard M&A agreement for strategic acquisition."
      });
    } else {
      // Generic mock response
      mockContent = JSON.stringify({
        score: 40,
        analysis: "This is mock analysis data generated for testing purposes. Configure ANTHROPIC_API_KEY to get real AI-powered analysis.",
        keyFindings: ["Mock finding 1", "Mock finding 2", "Mock finding 3"],
        recommendation: "This is mock data for UI testing."
      });
    }

    return {
      content: mockContent,
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      model,
    };
  }

  /**
   * Calculate cost for a Claude API call
   */
  calculateCost(usage: ClaudeResponse["usage"], model: AIModel): number {
    const pricing = MODEL_PRICING[model];
    if (!pricing) {
      throw new Error(`Unknown model pricing: ${model}`);
    }

    let cost = 0;

    // Input tokens
    cost += (usage.input_tokens / 1_000_000) * pricing.input;

    // Output tokens
    cost += (usage.output_tokens / 1_000_000) * pricing.output;

    // Cache creation (first time)
    if (usage.cache_creation_input_tokens) {
      cost +=
        (usage.cache_creation_input_tokens / 1_000_000) *
        pricing.cacheCreation;
    }

    // Cache read (subsequent times - 90% discount)
    if (usage.cache_read_input_tokens) {
      cost +=
        (usage.cache_read_input_tokens / 1_000_000) * pricing.cacheRead;
    }

    return cost;
  }

  /**
   * Get model information for display
   */
  getModelInfo(model: AIModel) {
    const pricing = MODEL_PRICING[model];
    return {
      model,
      pricing,
      description: this.getModelDescription(model),
      recommended: model === "claude-3-5-sonnet-20241022",
    };
  }

  private getModelDescription(model: AIModel): string {
    switch (model) {
      case "claude-3-5-sonnet-20241022":
        return "Best balance of quality and cost. Recommended for most analysis.";
      case "claude-3-5-haiku-20241022":
        return "Fast and economical. Good for simpler deals or initial screening.";
      case "claude-opus-4-20250514":
        return "Most powerful. Use for complex deals or critical decisions.";
      default:
        return "Unknown model";
    }
  }

  /**
   * Batch API call for overnight processing (50% discount)
   * Note: Batch API requires different implementation
   * This is a placeholder for future implementation
   */
  async submitBatchJob(
    requests: Array<{
      customId: string;
      config: PromptConfig;
      context: string;
    }>,
    model: AIModel
  ): Promise<{ batchId: string }> {
    // TODO: Implement batch API
    // https://docs.anthropic.com/en/api/batch-processing
    throw new Error("Batch API not yet implemented");
  }

  /**
   * Estimate cost before running analysis
   */
  estimateCost(
    textLength: number,
    model: AIModel,
    useCache: boolean = true
  ): {
    firstRun: number;
    subsequentRuns: number;
    savings: number;
  } {
    const pricing = MODEL_PRICING[model];

    // Rough token estimate (1 token ≈ 4 characters)
    const inputTokens = Math.ceil(textLength / 4);
    const outputTokens = 4000; // Typical analysis output

    const firstRunCost =
      (inputTokens / 1_000_000) * pricing.cacheCreation +
      (outputTokens / 1_000_000) * pricing.output;

    const subsequentCost = useCache
      ? (inputTokens / 1_000_000) * pricing.cacheRead +
        (outputTokens / 1_000_000) * pricing.output
      : firstRunCost;

    return {
      firstRun: firstRunCost,
      subsequentRuns: subsequentCost,
      savings: ((firstRunCost - subsequentCost) / firstRunCost) * 100,
    };
  }
}

// Singleton instance
let anthropicClient: AnthropicClient | null = null;

export function getAnthropicClient(): AnthropicClient {
  if (!anthropicClient) {
    anthropicClient = new AnthropicClient();
  }
  return anthropicClient;
}

// Model configuration helpers
export const DEFAULT_MODEL: AIModel = "claude-3-5-sonnet-20241022";

export const ALL_MODELS: AIModel[] = [
  "claude-3-5-haiku-20241022",
  "claude-3-5-sonnet-20241022",
  "claude-opus-4-20250514",
];

export function selectModelForDeal(complexity: "simple" | "complex"): AIModel {
  // Smart routing based on deal complexity
  return complexity === "simple"
    ? "claude-3-5-haiku-20241022"
    : "claude-3-5-sonnet-20241022";
}
