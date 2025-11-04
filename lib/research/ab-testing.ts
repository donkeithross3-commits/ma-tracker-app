// A/B Testing Framework for AI Models

import type {
  AnalysisContext,
  AnalysisModuleType,
  AIModel,
  ModelComparison,
  AnalysisResult,
} from "./types";
import { getAnthropicClient } from "./anthropic-client";
import { analyzeToppingBid } from "./analyzers/toppingBidAnalyzer";
import { analyzeAntitrust } from "./analyzers/antitrustAnalyzer";
import { analyzeContract } from "./analyzers/contractAnalyzer";

/**
 * Run A/B test comparing different AI models on the same analysis
 */
export async function runModelComparison(
  context: AnalysisContext,
  moduleType: AnalysisModuleType,
  models: AIModel[]
): Promise<ModelComparison> {
  const client = getAnthropicClient();

  // Run analysis with each model in parallel
  const results = await Promise.all(
    models.map(async (model) => {
      const analyzer = getAnalyzer(moduleType);
      const result = await analyzer(context, model);
      const cost = result.tokensUsed
        ? client.calculateCost(
            {
              input_tokens: result.tokensUsed.input,
              output_tokens: result.tokensUsed.output,
              cache_creation_input_tokens: result.tokensUsed.cacheCreation,
              cache_read_input_tokens: result.tokensUsed.cacheRead,
            },
            model
          )
        : 0;

      return { model, result, cost };
    })
  );

  // Analyze differences and recommend winner
  const recommendation = generateRecommendation(results);

  return {
    moduleType,
    models: results,
    winner: recommendation.winner,
    recommendation: recommendation.reasoning,
  };
}

/**
 * Compare two specific models head-to-head
 */
export async function compareModels(
  context: AnalysisContext,
  moduleType: AnalysisModuleType,
  modelA: AIModel,
  modelB: AIModel
): Promise<{
  modelA: { result: AnalysisResult; cost: number };
  modelB: { result: AnalysisResult; cost: number };
  comparison: {
    qualityDifference: string;
    costDifference: string;
    speedDifference: string;
    recommendation: AIModel;
  };
}> {
  const comparison = await runModelComparison(context, moduleType, [
    modelA,
    modelB,
  ]);

  const resultA = comparison.models.find((m) => m.model === modelA)!;
  const resultB = comparison.models.find((m) => m.model === modelB)!;

  return {
    modelA: resultA,
    modelB: resultB,
    comparison: {
      qualityDifference: compareQuality(resultA.result, resultB.result),
      costDifference: compareCost(resultA.cost, resultB.cost),
      speedDifference: compareSpeed(
        resultA.result.processingTimeMs,
        resultB.result.processingTimeMs
      ),
      recommendation: comparison.winner || modelA,
    },
  };
}

/**
 * Run comprehensive test across all models and all modules
 * Use this to establish baseline performance
 */
export async function runComprehensiveTest(
  context: AnalysisContext,
  models: AIModel[] = [
    "claude-3-5-haiku-20241022",
    "claude-3-5-sonnet-20241022",
    "claude-opus-4-20250514",
  ]
): Promise<{
  comparisons: ModelComparison[];
  summary: {
    totalCost: Record<AIModel, number>;
    averageSpeed: Record<AIModel, number>;
    recommendedModel: AIModel;
    costEfficiencyWinner: AIModel;
    qualityWinner: AIModel;
  };
}> {
  const modules: AnalysisModuleType[] = [
    "topping_bid",
    "antitrust",
    "contract",
  ];

  // Run all combinations
  const comparisons = await Promise.all(
    modules.map((module) => runModelComparison(context, module, models))
  );

  // Calculate summary statistics
  const totalCost: Record<string, number> = {};
  const totalTime: Record<string, number> = {};
  const counts: Record<string, number> = {};

  for (const comparison of comparisons) {
    for (const { model, cost, result } of comparison.models) {
      totalCost[model] = (totalCost[model] || 0) + cost;
      totalTime[model] =
        (totalTime[model] || 0) + result.processingTimeMs;
      counts[model] = (counts[model] || 0) + 1;
    }
  }

  const averageSpeed = Object.fromEntries(
    Object.entries(totalTime).map(([model, time]) => [
      model,
      time / counts[model],
    ])
  ) as Record<AIModel, number>;

  // Determine winners
  const costEfficiencyWinner = Object.entries(totalCost).reduce((a, b) =>
    a[1] < b[1] ? a : b
  )[0] as AIModel;

  // Quality winner based on highest average risk scores (most detailed analysis)
  const qualityWinner = comparisons[0].winner || "claude-3-5-sonnet-20241022";

  // Recommended model balances quality and cost
  const recommendedModel: AIModel = "claude-3-5-sonnet-20241022";

  return {
    comparisons,
    summary: {
      totalCost: totalCost as Record<AIModel, number>,
      averageSpeed,
      recommendedModel,
      costEfficiencyWinner,
      qualityWinner,
    },
  };
}

/**
 * Get historical comparison data for pattern analysis
 */
export async function getHistoricalComparisons(
  dealIds?: string[]
): Promise<{
  dealId: string;
  models: {
    model: AIModel;
    avgCost: number;
    avgQuality: number;
  }[];
}[]> {
  // TODO: Implement by querying ReportSection table
  // This allows Luis to analyze which models performed best historically
  throw new Error("Not yet implemented - requires database queries");
}

// Helper functions

function getAnalyzer(
  moduleType: AnalysisModuleType
): (context: AnalysisContext, model: AIModel) => Promise<AnalysisResult> {
  switch (moduleType) {
    case "topping_bid":
      return analyzeToppingBid;
    case "antitrust":
      return analyzeAntitrust;
    case "contract":
      return analyzeContract;
    default:
      throw new Error(`Unknown module type: ${moduleType}`);
  }
}

function generateRecommendation(
  results: Array<{ model: AIModel; result: AnalysisResult; cost: number }>
): { winner: AIModel; reasoning: string } {
  // Simple heuristic: prefer Sonnet unless Haiku is 80%+ as good for 1/3 the cost
  // or Opus provides significantly more detail

  const sonnet = results.find((r) =>
    r.model.includes("sonnet")
  );
  const haiku = results.find((r) => r.model.includes("haiku"));
  const opus = results.find((r) => r.model.includes("opus"));

  // Default to Sonnet
  if (!sonnet) {
    return {
      winner: results[0].model,
      reasoning: "Sonnet not available, using first model",
    };
  }

  // Check if Haiku is good enough
  if (haiku) {
    const qualityRatio =
      haiku.result.keyPoints.length / sonnet.result.keyPoints.length;
    const costRatio = haiku.cost / sonnet.cost;

    if (qualityRatio > 0.8 && costRatio < 0.4) {
      return {
        winner: haiku.model,
        reasoning: `Haiku provides ${(qualityRatio * 100).toFixed(0)}% of Sonnet quality at ${(costRatio * 100).toFixed(0)}% of cost`,
      };
    }
  }

  // Check if Opus is worth it
  if (opus) {
    const qualityGain =
      opus.result.keyPoints.length / sonnet.result.keyPoints.length;
    const costIncrease = opus.cost / sonnet.cost;

    if (qualityGain > 1.3 && opus.result.confidence === "high") {
      return {
        winner: opus.model,
        reasoning: `Opus provides ${((qualityGain - 1) * 100).toFixed(0)}% more detail with high confidence`,
      };
    }
  }

  return {
    winner: sonnet.model,
    reasoning: "Sonnet offers best balance of quality and cost",
  };
}

function compareQuality(a: AnalysisResult, b: AnalysisResult): string {
  const aPoints = a.keyPoints.length;
  const bPoints = b.keyPoints.length;

  if (aPoints === bPoints) return "Similar quality";
  if (aPoints > bPoints)
    return `Model A found ${aPoints - bPoints} more insights`;
  return `Model B found ${bPoints - aPoints} more insights`;
}

function compareCost(a: number, b: number): string {
  const diff = ((b - a) / a) * 100;
  if (Math.abs(diff) < 5) return "Similar cost";
  if (diff > 0) return `Model A is ${diff.toFixed(0)}% cheaper`;
  return `Model B is ${Math.abs(diff).toFixed(0)}% cheaper`;
}

function compareSpeed(a: number, b: number): string {
  const diff = ((b - a) / a) * 100;
  if (Math.abs(diff) < 10) return "Similar speed";
  if (diff > 0)
    return `Model A is ${diff.toFixed(0)}% faster (${(a / 1000).toFixed(1)}s vs ${(b / 1000).toFixed(1)}s)`;
  return `Model B is ${Math.abs(diff).toFixed(0)}% faster (${(b / 1000).toFixed(1)}s vs ${(a / 1000).toFixed(1)}s)`;
}
