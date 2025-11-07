import { NextRequest, NextResponse } from "next/server";

// GET /api/deals/prepare?dealId={intelligence_deal_id}
// Fetch deal from intelligence system and prepare data for editing
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const dealId = searchParams.get("dealId");

    if (!dealId) {
      return NextResponse.json(
        { error: "dealId parameter is required" },
        { status: 400 }
      );
    }

    // Fetch deal from Python intelligence service
    const response = await fetch(
      `http://localhost:8000/intelligence/deals/${dealId}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch deal from intelligence service: ${response.statusText}`);
    }

    const responseData = await response.json();
    const intelligenceDeal = responseData.deal; // Handle nested structure

    // Fetch research data if available
    let researchData = null;
    try {
      const researchResponse = await fetch(
        `http://localhost:8000/intelligence/deals/${dealId}/research`
      );
      if (researchResponse.ok) {
        researchData = await researchResponse.json();
      }
    } catch (error) {
      console.log("No research data available yet:", error);
    }

    // Extract research data if available
    const extractedData = researchData?.extracted_deal_terms;
    const dealTerms = extractedData?.deal_terms || {};
    const goShop = extractedData?.go_shop_provision || {};
    const risks = extractedData?.risk_assessment || {};

    // Map intelligence data to deal form structure
    const preparedDeal = {
      // Basic Info (pre-populated from intelligence or research)
      ticker: researchData?.target_ticker || intelligenceDeal.target_ticker || dealTerms.target_ticker || "",
      targetName: intelligenceDeal.target_name || "",
      acquirorTicker: dealTerms.acquirer_ticker || intelligenceDeal.acquirer_ticker || "",
      acquirorName: intelligenceDeal.acquirer_name || "",
      status: "active",

      // Deal Terms (pre-populate from research if available)
      dealValue: dealTerms.total_deal_value || intelligenceDeal.deal_value || null,
      dealType: dealTerms.deal_type || intelligenceDeal.deal_type || null,

      // Dates (pre-populate from research)
      firstDetectedAt: intelligenceDeal.first_detected_at,
      announcedDate: dealTerms.announced_date || null,
      expectedCloseDate: dealTerms.expected_close_date || null,
      outsideDate: dealTerms.outside_date || null,
      goShopEndDate: researchData?.go_shop_end_date || goShop.go_shop_end_date || null,

      // Confidence & Sources
      confidenceScore: intelligenceDeal.confidence_score,
      sourceCount: intelligenceDeal.source_count,

      // Sources for reference (from root level of response)
      sources: responseData.sources || [],

      // EDGAR data if available
      edgar_status: intelligenceDeal.edgar_status || null,

      // Deal category and terms (pre-populate from research)
      category: dealTerms.deal_category || null,
      cashPerShare: dealTerms.cash_per_share || null,
      stockRatio: dealTerms.stock_ratio || null,
      dividendsOther: dealTerms.dividends_other || null,

      // Risk factors (pre-populate from research)
      voteRisk: researchData?.vote_risk || risks.vote_risk || null,
      financeRisk: researchData?.finance_risk || risks.finance_risk || null,
      legalRisk: researchData?.legal_risk || risks.legal_risk || null,

      // Fields that Luis still needs to fill in:
      stressTestDiscount: null,
      currentYield: null,
      isInvestable: false,
      investableNotes: "",
      dealNotes: "",

      // Research report for reference
      researchReport: researchData?.report_markdown || null,
      hasResearch: !!researchData,

      // Metadata
      intelligenceDealId: dealId,
    };

    return NextResponse.json({ deal: preparedDeal });
  } catch (error) {
    console.error("Error preparing deal:", error);
    return NextResponse.json(
      {
        error: "Failed to prepare deal",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
