import { NextRequest, NextResponse } from "next/server";

// GET /api/deals/prepare?dealId={intelligence_deal_id_or_staged_deal_id}
// Fetch deal from intelligence system and prepare data for editing
// Supports both intelligence deal IDs and staged deal IDs
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

    // Try to fetch from intelligence deals first
    let response = await fetch(
      `http://localhost:8000/intelligence/deals/${dealId}`
    );

    // If not found in intelligence deals, try staged deals
    if (!response.ok && response.status === 404) {
      console.log(`Deal ${dealId} not found in intelligence table, checking staged_deals...`);
      response = await fetch(
        `http://localhost:8000/edgar/staged-deals/${dealId}`
      );

      if (!response.ok) {
        throw new Error(
          `Deal not found in either intelligence or staged deals tables. ` +
          `Please ensure the deal has been approved. Deal ID: ${dealId}`
        );
      }

      // If we found it in staged deals, we need to handle the response differently
      const stagedDeal = await response.json();

      // Convert staged deal to the expected format for the form
      // Note: Staged deal response uses camelCase (targetTicker, targetName, etc.)
      const preparedDeal = {
        // Basic Info
        ticker: stagedDeal.targetTicker || "",
        targetName: stagedDeal.targetName || "",
        acquirorTicker: stagedDeal.acquirerTicker || "",
        acquirorName: stagedDeal.acquirerName || "",
        status: "active",

        // Deal Terms
        dealValue: stagedDeal.dealValue || null,
        dealType: stagedDeal.dealType || null,

        // Dates
        firstDetectedAt: stagedDeal.detectedAt,
        announcedDate: null,
        expectedCloseDate: null,
        outsideDate: null,
        goShopEndDate: null,

        // Confidence & Sources
        confidenceScore: stagedDeal.confidenceScore || 0.0,
        sourceCount: 1,

        // Sources for reference
        sources: [],

        // Fields that still need to be filled in
        category: null,
        cashPerShare: null,
        stockRatio: null,
        dividendsOther: null,
        voteRisk: null,
        financeRisk: null,
        legalRisk: null,
        stressTestDiscount: null,
        currentYield: null,
        isInvestable: false,
        investableNotes: "",
        dealNotes: "",

        // Research report for reference
        researchReport: null,
        hasResearch: false,

        // Metadata - use staged_deal_id as the identifier
        intelligenceDealId: stagedDeal.id,
        isStagedDeal: true,
      };

      return NextResponse.json({ deal: preparedDeal });
    }

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
      isStagedDeal: false,
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
