"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, TrendingUp, Scale, Calendar } from "lucide-react";

interface Suggestion {
  suggestionId: string;
  dealId: string;
  productionDealId: string;
  suggestionType: string;
  suggestedField: string | null;
  currentValue: string | null;
  suggestedValue: string | null;
  confidenceScore: number | null;
  reasoning: string;
  sourceCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface IntelligenceSuggestionsProps {
  dealId: string;
}

export function IntelligenceSuggestions({ dealId }: IntelligenceSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    fetchSuggestions();
  }, [dealId]);

  const fetchSuggestions = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/intelligence/suggestions/by-deal/${dealId}?status=pending`);
      if (!response.ok) throw new Error("Failed to fetch suggestions");
      const data = await response.json();
      setSuggestions(data.suggestions || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load suggestions");
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (suggestionId: string) => {
    try {
      setProcessingId(suggestionId);
      const response = await fetch(`/api/intelligence/suggestions/${suggestionId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewed_by: "user" }), // TODO: Get actual user ID
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to accept suggestion");
      }

      // Remove from list
      setSuggestions(suggestions.filter((s) => s.suggestionId !== suggestionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept suggestion");
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (suggestionId: string) => {
    try {
      setProcessingId(suggestionId);
      const response = await fetch(`/api/intelligence/suggestions/${suggestionId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewed_by: "user", // TODO: Get actual user ID
          rejection_reason: "Rejected by user",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to reject suggestion");
      }

      // Remove from list
      setSuggestions(suggestions.filter((s) => s.suggestionId !== suggestionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject suggestion");
    } finally {
      setProcessingId(null);
    }
  };

  const getSuggestionIcon = (type: string) => {
    switch (type) {
      case "attribute_update":
        return <TrendingUp className="h-5 w-5" />;
      case "risk_change":
        return <Scale className="h-5 w-5" />;
      case "material_event":
        return <Calendar className="h-5 w-5" />;
      default:
        return <AlertTriangle className="h-5 w-5" />;
    }
  };

  const getSuggestionTypeLabel = (type: string) => {
    switch (type) {
      case "attribute_update":
        return "Attribute Update";
      case "risk_change":
        return "Risk Change";
      case "material_event":
        return "Material Event";
      default:
        return type;
    }
  };

  const getConfidenceBadge = (score: number | null) => {
    if (score === null) return null;
    const percentage = Math.round(score * 100);
    let variant: "default" | "secondary" | "destructive" | "outline" = "default";

    if (percentage >= 80) variant = "default";
    else if (percentage >= 60) variant = "secondary";
    else variant = "outline";

    return <Badge variant={variant}>{percentage}% confidence</Badge>;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Intelligence Suggestions</CardTitle>
          <CardDescription>AI-generated insights from monitoring this deal</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Intelligence Suggestions</CardTitle>
          <CardDescription>AI-generated insights from monitoring this deal</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (suggestions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Intelligence Suggestions</CardTitle>
          <CardDescription>AI-generated insights from monitoring this deal</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No pending suggestions at this time.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Intelligence Suggestions</CardTitle>
        <CardDescription>
          {suggestions.length} pending suggestion{suggestions.length !== 1 ? "s" : ""} from AI monitoring
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {suggestions.map((suggestion) => (
          <Card key={suggestion.suggestionId} className="border-2">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {getSuggestionIcon(suggestion.suggestionType)}
                  <div>
                    <CardTitle className="text-base">
                      {getSuggestionTypeLabel(suggestion.suggestionType)}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2 mt-1">
                      {getConfidenceBadge(suggestion.confidenceScore)}
                      <span className="text-xs">{suggestion.sourceCount} source{suggestion.sourceCount !== 1 ? "s" : ""}</span>
                    </CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {suggestion.suggestedField && (
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="font-medium">Field:</span>
                    <p className="text-muted-foreground">{suggestion.suggestedField}</p>
                  </div>
                  <div>
                    <span className="font-medium">Current:</span>
                    <p className="text-muted-foreground">{suggestion.currentValue || "—"}</p>
                  </div>
                  <div>
                    <span className="font-medium">Suggested:</span>
                    <p className="text-muted-foreground">{suggestion.suggestedValue || "—"}</p>
                  </div>
                </div>
              )}

              <div>
                <span className="font-medium text-sm">Reasoning:</span>
                <p className="text-sm text-muted-foreground mt-1">{suggestion.reasoning}</p>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={() => handleAccept(suggestion.suggestionId)}
                  disabled={processingId === suggestion.suggestionId}
                  className="flex items-center gap-2"
                >
                  {processingId === suggestion.suggestionId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleReject(suggestion.suggestionId)}
                  disabled={processingId === suggestion.suggestionId}
                  className="flex items-center gap-2"
                >
                  <XCircle className="h-4 w-4" />
                  Reject
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
}
