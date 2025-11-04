"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, FileText, AlertTriangle, CheckCircle, XCircle } from "lucide-react";

interface ResearchReportProps {
  dealId: string;
  ticker: string;
}

interface ReportSection {
  id: string;
  sectionType: string;
  sectionTitle: string;
  analysisMarkdown: string;
  riskScore: number | null;
  confidence: string | null;
  status: string;
}

interface ResearchReportData {
  id: string;
  status: string;
  antitrustRiskScore: number | null;
  contractRiskScore: number | null;
  toppingBidScore: number | null;
  overallRiskScore: number | null;
  executiveSummary: string | null;
  keyFindings: any;
  redFlags: any;
  opportunities: any;
  sections: ReportSection[];
}

export function ResearchReport({ dealId, ticker }: ResearchReportProps) {
  const [report, setReport] = useState<ResearchReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch existing report
  useEffect(() => {
    fetchReport();
  }, [dealId]);

  async function fetchReport() {
    try {
      setLoading(true);
      const response = await fetch(`/api/research/generate-report?dealId=${dealId}`);

      if (response.status === 404) {
        setReport(null);
        setLoading(false);
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to fetch research report");
      }

      const data = await response.json();
      // Map the API response to our component's expected format
      if (data.success && data.report) {
        setReport({
          ...data.report,
          sections: data.report.sections || [],
        });
      }
    } catch (err) {
      console.error("Error fetching report:", err);
      setError(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  async function generateReport() {
    try {
      setGenerating(true);
      setError(null);

      // First, fetch SEC filings
      const filingsResponse = await fetch("/api/research/fetch-filings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, ticker }),
      });

      if (!filingsResponse.ok) {
        const errorData = await filingsResponse.json();
        throw new Error(errorData.error || "Failed to fetch SEC filings");
      }

      // Then generate the report
      const response = await fetch("/api/research/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate report");
      }

      // Fetch the completed report
      await fetchReport();
    } catch (err) {
      console.error("Error generating report:", err);
      setError(err instanceof Error ? err.message : "Failed to generate report");
    } finally {
      setGenerating(false);
    }
  }

  function getRiskColor(score: number | null) {
    if (score === null) return "text-gray-500";
    if (score <= 30) return "text-green-600";
    if (score <= 60) return "text-yellow-600";
    return "text-red-600";
  }

  function getRiskLabel(score: number | null) {
    if (score === null) return "Not assessed";
    if (score <= 30) return "Low Risk";
    if (score <= 60) return "Medium Risk";
    return "High Risk";
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Research Report</CardTitle>
          <CardDescription>
            Generate an AI-powered research report analyzing merger risks, contract terms, and
            potential issues
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <FileText className="h-16 w-16 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-center max-w-md">
              No research report has been generated for this deal yet. Click below to analyze SEC
              filings and generate a comprehensive report.
            </p>
            <Button
              onClick={generateReport}
              disabled={generating}
              size="lg"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating Report...
                </>
              ) : (
                "Generate Research Report"
              )}
            </Button>
            {error && (
              <div className="text-sm text-red-600 mt-4">
                <AlertTriangle className="h-4 w-4 inline mr-2" />
                {error}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Risk Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Overall Risk
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${getRiskColor(report.overallRiskScore)}`}>
              {report.overallRiskScore ?? "-"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {getRiskLabel(report.overallRiskScore)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Antitrust Risk
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${getRiskColor(report.antitrustRiskScore)}`}>
              {report.antitrustRiskScore ?? "-"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {getRiskLabel(report.antitrustRiskScore)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Contract Risk
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${getRiskColor(report.contractRiskScore)}`}>
              {report.contractRiskScore ?? "-"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {getRiskLabel(report.contractRiskScore)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Topping Bid
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${report.toppingBidScore !== null ? "text-green-600" : "text-gray-500"}`}>
              {report.toppingBidScore ?? "-"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {report.toppingBidScore !== null ? "Likelihood score" : "Not assessed"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Executive Summary */}
      {report.executiveSummary && (
        <Card>
          <CardHeader>
            <CardTitle>Executive Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {report.executiveSummary}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Key Findings, Red Flags, Opportunities */}
      <div className="grid gap-4 md:grid-cols-3">
        {report.keyFindings && Array.isArray(report.keyFindings) && report.keyFindings.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-blue-600" />
                <CardTitle className="text-lg">Key Findings</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {report.keyFindings.map((finding: string, idx: number) => (
                  <li key={idx} className="text-sm flex items-start gap-2">
                    <span className="text-muted-foreground mt-0.5">•</span>
                    <span>{finding}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {report.redFlags && Array.isArray(report.redFlags) && report.redFlags.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-600" />
                <CardTitle className="text-lg">Red Flags</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {report.redFlags.map((flag: string, idx: number) => (
                  <li key={idx} className="text-sm flex items-start gap-2">
                    <span className="text-red-600 mt-0.5">⚠</span>
                    <span>{flag}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {report.opportunities && Array.isArray(report.opportunities) && report.opportunities.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <CardTitle className="text-lg">Opportunities</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {report.opportunities.map((opp: string, idx: number) => (
                  <li key={idx} className="text-sm flex items-start gap-2">
                    <span className="text-green-600 mt-0.5">✓</span>
                    <span>{opp}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Report Sections */}
      {report.sections && report.sections.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Detailed Analysis</h3>
          {report.sections.map((section) => (
            <Card key={section.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{section.sectionTitle}</CardTitle>
                  {section.riskScore !== null && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Risk Score:</span>
                      <span className={`text-lg font-bold ${getRiskColor(section.riskScore)}`}>
                        {section.riskScore}
                      </span>
                    </div>
                  )}
                </div>
                {section.confidence && (
                  <CardDescription>
                    Confidence: {section.confidence}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm max-w-none">
                  <div className="whitespace-pre-wrap">{section.analysisMarkdown}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Regenerate Button */}
      <div className="flex justify-center pt-4">
        <Button
          variant="outline"
          onClick={generateReport}
          disabled={generating}
        >
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Regenerating...
            </>
          ) : (
            "Regenerate Report"
          )}
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
