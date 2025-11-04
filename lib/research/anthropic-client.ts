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
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
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
