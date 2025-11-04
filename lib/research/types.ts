// AI Research Analysis Types

export type AIModel =
  | "claude-3-5-sonnet-20241022"  // Sonnet 4.5 - Best balance
  | "claude-3-5-haiku-20241022"   // Haiku 4.5 - Fast & cheap
  | "claude-opus-4-20250514";     // Opus 4 - Most powerful

export type AnalysisModuleType =
  | "antitrust"
  | "contract"
  | "topping_bid"
  | "deal_structure";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ConfidenceLevel = "low" | "medium" | "high";

export interface AnalysisContext {
  dealId: string;
  ticker: string;
  targetCompany: string;
  acquirerCompany: string;
  dealPrice: number;
  dealAnnounced: Date;
  filings: FilingData[];
}

export interface FilingData {
  id: string;
  type: string;
  date: Date;
  content: string;
  url: string;
}

export interface AnalysisResult {
  sectionType: AnalysisModuleType;
  sectionTitle: string;
  analysisMarkdown: string;
  riskScore: number;  // 0-100
  riskLevel: RiskLevel;
  confidence: ConfidenceLevel;
  keyPoints: string[];
  extractedData: Record<string, unknown>;
  sourceFilingIds: string[];
  aiModel: AIModel;
  promptVersion: string;
  processingTimeMs: number;
  tokensUsed?: {
    input: number;
    output: number;
    cacheCreation?: number;
    cacheRead?: number;
  };
}

export interface ReportGenerationOptions {
  model?: AIModel;
  useCache?: boolean;
  modules?: AnalysisModuleType[];
  compareModels?: boolean;  // Run A/B test
}

export interface ModelComparison {
  moduleType: AnalysisModuleType;
  models: {
    model: AIModel;
    result: AnalysisResult;
    cost: number;
  }[];
  winner?: AIModel;  // Based on quality/cost ratio
  recommendation: string;
}

export interface PromptConfig {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  version: string;  // Track prompt versions for A/B testing
}
