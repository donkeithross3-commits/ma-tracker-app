"""Deal Research Generator - Extracts deal terms and generates research reports from EDGAR filings"""
import os
import json
import logging
from typing import Dict, Any, Optional
from anthropic import Anthropic
import httpx
from app.services.ticker_lookup import get_ticker_lookup_service

logger = logging.getLogger(__name__)


class DealResearchGenerator:
    """Generates comprehensive deal research from EDGAR filings using Claude"""

    def __init__(self, anthropic_api_key: str):
        self.anthropic = Anthropic(api_key=anthropic_api_key)

    async def fetch_filing_content(self, filing_url: str) -> str:
        """Fetch the filing content from EDGAR, parsing index pages if necessary"""
        try:
            # SEC requires proper User-Agent header
            headers = {
                "User-Agent": "M&A Intelligence Platform research@example.com",
                "Accept-Encoding": "gzip, deflate",
                "Host": "www.sec.gov"
            }
            async with httpx.AsyncClient(timeout=60.0, headers=headers, follow_redirects=True) as client:
                # If URL is an index page, parse it to find the primary document
                if filing_url.endswith('-index.htm') or '/Archives/edgar/data/' in filing_url and filing_url.endswith('.htm'):
                    logger.info(f"Detected index page, parsing to find primary document: {filing_url}")
                    index_response = await client.get(filing_url)
                    index_response.raise_for_status()
                    index_html = index_response.text

                    # Parse index to find primary document link
                    # Look for patterns like: <td>MERGER AGREEMENT</td> or <td>8-K</td>
                    # followed by a link to .htm or .txt file
                    import re

                    # Try to find primary document - look for common patterns
                    # Pattern 1: Look for iXBRL viewer links and extract the doc parameter
                    ixbrl_match = re.search(r'href="/ix\?doc=(/Archives/[^"]+\.htm)"', index_html)

                    if ixbrl_match:
                        # Extract the actual document path from the iXBRL viewer URL
                        # This is an absolute path, so we build URL from SEC root
                        doc_path = ixbrl_match.group(1)
                        doc_url = f"https://www.sec.gov{doc_path}"
                        logger.info(f"Found primary document (iXBRL): {doc_url}")

                        # Fetch the actual document
                        response = await client.get(doc_url)
                        response.raise_for_status()
                        return response.text[:200000]  # Increased limit for actual content

                    # Pattern 2: Look for links with Type column containing form type
                    primary_doc_match = re.search(r'<a href="([^"]+\.htm)"[^>]*>\s*(?:Primary Document|MERGER AGREEMENT|8-K|DEFM14A|SC 13D|SC TO)', index_html, re.IGNORECASE)

                    if not primary_doc_match:
                        # Pattern 3: Look for first .htm file that's not index or XML
                        primary_doc_match = re.search(r'<a href="((?!.*index)[^"]+\.htm)"', index_html)

                    if primary_doc_match:
                        doc_filename = primary_doc_match.group(1)
                        # Remove leading slash if present to avoid double slashes
                        doc_filename = doc_filename.lstrip('/')
                        # Build full URL relative to index page
                        base_url = filing_url.rsplit('/', 1)[0]
                        doc_url = f"{base_url}/{doc_filename}"
                        logger.info(f"Found primary document: {doc_url}")

                        # Fetch the actual document
                        response = await client.get(doc_url)
                        response.raise_for_status()
                        return response.text[:200000]  # Increased limit for actual content
                    else:
                        logger.warning(f"Could not find primary document in index, using index content")
                        return index_html[:100000]
                else:
                    # Direct filing URL
                    response = await client.get(filing_url)
                    response.raise_for_status()
                    return response.text[:200000]
        except Exception as e:
            logger.error(f"Failed to fetch filing from {filing_url}: {e}")
            raise

    def generate_research_prompt(self, deal_info: Dict[str, Any], filing_text: str) -> str:
        """Generate the comprehensive research prompt for Claude"""
        return f"""You are an expert M&A analyst reviewing an SEC filing for a merger or acquisition deal. Analyze the following filing and extract key deal terms and risk factors.

**Deal Information:**
- Target: {deal_info['target_name']}
- Acquirer: {deal_info.get('acquirer_name', 'Unknown')}
- Deal Value: {deal_info.get('deal_value', 'Not disclosed')}
- Filing Type: {deal_info['filing_type']}

**SEC Filing Content:**
{filing_text[:50000]}

Please provide a comprehensive analysis in the following JSON structure. Be thorough but concise. For any field you cannot determine from the filing, use null.

```json
{{
  "deal_terms": {{
    "target_ticker": "TICKER (string, the stock ticker symbol of the target company)",
    "acquirer_ticker": "TICKER (string, the stock ticker symbol of the acquirer company, if publicly traded)",
    "announced_date": "YYYY-MM-DD (string, when the deal was announced)",
    "expected_close_date": "YYYY-MM-DD (string, expected completion date)",
    "outside_date": "YYYY-MM-DD (string, drop-dead date after which parties can walk away)",
    "deal_type": "merger|acquisition|tender_offer|scheme_of_arrangement (string)",
    "deal_category": "all_cash|cash_stock|cash_cvr|stock|non_binding_offer (string)",
    "cash_per_share": 0.00 (number, cash consideration per share),
    "stock_ratio": 0.00 (number, exchange ratio if stock deal),
    "total_deal_value": 0.00 (number, in billions),
    "dividends_other": "Description of any dividends, CVRs, or other considerations (string)"
  }},
  "go_shop_provision": {{
    "has_go_shop": true|false (boolean),
    "go_shop_end_date": "YYYY-MM-DD (string, when go-shop period ends)",
    "termination_fee_during_go_shop": 0.00 (number, as percentage),
    "termination_fee_after_go_shop": 0.00 (number, as percentage),
    "go_shop_notes": "Additional details about go-shop provisions (string)"
  }},
  "risk_assessment": {{
    "vote_risk": "low|medium|high (string, risk that shareholders won't approve)",
    "vote_risk_reasoning": "Explanation of vote risk assessment (string)",
    "finance_risk": "low|medium|high (string, risk that financing falls through)",
    "finance_risk_reasoning": "Explanation of financing risk (string)",
    "legal_risk": "low|medium|high (string, antitrust/regulatory risk)",
    "legal_risk_reasoning": "Explanation of legal/regulatory risk (string)",
    "key_closing_conditions": ["List of material conditions to closing (array of strings)"],
    "mac_provision_strength": "weak|moderate|strong (string, material adverse change clause)",
    "reverse_termination_fee": 0.00 (number, fee buyer pays if they walk, as percentage)
  }},
  "deal_protections": {{
    "no_shop_clause": true|false (boolean),
    "matching_rights": true|false (boolean),
    "force_the_vote": true|false (boolean, must hold vote even if board changes recommendation),
    "termination_fee_pct": 0.00 (number, break-up fee as percentage of deal value),
    "expense_reimbursement": 0.00 (number, expense reimbursement cap in millions)
  }},
  "shareholder_approval": {{
    "approval_threshold": "Simple majority|Two-thirds|Other (string)",
    "expected_vote_date": "YYYY-MM-DD (string)",
    "major_shareholders_disclosed": true|false (boolean),
    "major_shareholder_support": "Description of any shareholder support agreements (string)"
  }},
  "financing": {{
    "buyer_financing_condition": true|false (boolean, is deal conditional on financing?)",
    "financing_source": "cash_on_hand|debt_financing|equity_financing|combination (string)",
    "financing_commitment": "committed|uncommitted|not_applicable (string)",
    "financing_notes": "Details about financing arrangements (string)"
  }},
  "executive_summary": "2-3 paragraph executive summary of the deal, key terms, and main risks (string)"
}}
```

Return ONLY the JSON object, no additional text before or after."""

    async def generate_research(
        self,
        deal_info: Dict[str, Any],
        filing_url: str
    ) -> Dict[str, Any]:
        """Generate comprehensive deal research"""
        try:
            # Fetch filing content
            logger.info(f"Fetching filing from {filing_url}")
            filing_text = await self.fetch_filing_content(filing_url)

            # Generate research using Claude
            logger.info("Generating deal research with Claude")
            prompt = self.generate_research_prompt(deal_info, filing_text)

            response = self.anthropic.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4000,
                temperature=0,  # More deterministic for data extraction
                messages=[{"role": "user", "content": prompt}]
            )

            response_text = response.content[0].text

            # Extract JSON from response (handle potential markdown code blocks)
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
                response_text = response_text[json_start:json_end].strip()
            elif "```" in response_text:
                json_start = response_text.find("```") + 3
                json_end = response_text.find("```", json_start)
                response_text = response_text[json_start:json_end].strip()

            # Parse JSON response
            research_data = json.loads(response_text)

            # Use ticker lookup as fallback for missing tickers
            ticker_service = get_ticker_lookup_service()
            deal_terms = research_data.get('deal_terms', {})

            # Lookup target ticker if missing
            if not deal_terms.get('target_ticker') and deal_info.get('target_name'):
                logger.info(f"Target ticker missing, looking up for {deal_info['target_name']}")
                target_ticker = await ticker_service.lookup_ticker(deal_info['target_name'])
                if target_ticker:
                    deal_terms['target_ticker'] = target_ticker
                    logger.info(f"Found target ticker: {target_ticker}")

            # Lookup acquirer ticker if missing
            if not deal_terms.get('acquirer_ticker') and deal_info.get('acquirer_name'):
                logger.info(f"Acquirer ticker missing, looking up for {deal_info['acquirer_name']}")
                acquirer_ticker = await ticker_service.lookup_ticker(deal_info['acquirer_name'])
                if acquirer_ticker:
                    deal_terms['acquirer_ticker'] = acquirer_ticker
                    logger.info(f"Found acquirer ticker: {acquirer_ticker}")

            # Generate markdown report
            markdown_report = self._generate_markdown_report(deal_info, research_data)

            return {
                "extracted_data": research_data,
                "markdown_report": markdown_report,
                "success": True
            }

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Claude response as JSON: {e}")
            logger.error(f"Response text: {response_text[:500]}")
            return {
                "success": False,
                "error": f"Failed to parse research data: {str(e)}",
                "extracted_data": {},
                "markdown_report": "# Research Generation Failed\n\nFailed to parse AI response."
            }
        except Exception as e:
            logger.error(f"Failed to generate research: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "extracted_data": {},
                "markdown_report": f"# Research Generation Failed\n\nError: {str(e)}"
            }

    def _generate_markdown_report(self, deal_info: Dict[str, Any], research_data: Dict[str, Any]) -> str:
        """Generate a formatted markdown report from research data"""
        report = f"""# M&A Deal Research Report

## Deal Overview
- **Target:** {deal_info['target_name']}
- **Acquirer:** {deal_info.get('acquirer_name', 'Unknown')}
- **Filing Type:** {deal_info['filing_type']}

## Executive Summary
{research_data.get('executive_summary', 'No executive summary available.')}

---

## Deal Terms

"""

        # Deal terms
        terms = research_data.get('deal_terms', {})
        if terms:
            report += f"""
- **Target Ticker:** {terms.get('target_ticker', 'N/A')}
- **Announced Date:** {terms.get('announced_date', 'N/A')}
- **Expected Close Date:** {terms.get('expected_close_date', 'N/A')}
- **Outside Date:** {terms.get('outside_date', 'N/A')}
- **Deal Type:** {terms.get('deal_type', 'N/A')}
- **Deal Category:** {terms.get('deal_category', 'N/A')}
- **Cash Per Share:** ${terms.get('cash_per_share', 'N/A')}
- **Stock Ratio:** {terms.get('stock_ratio', 'N/A')}
- **Total Deal Value:** ${terms.get('total_deal_value', 'N/A')}B
- **Other Consideration:** {terms.get('dividends_other', 'None')}

"""

        # Go-shop provision
        go_shop = research_data.get('go_shop_provision', {})
        report += f"""## Go-Shop Provision

- **Has Go-Shop:** {'Yes' if go_shop.get('has_go_shop') else 'No'}
- **Go-Shop End Date:** {go_shop.get('go_shop_end_date', 'N/A')}
- **Termination Fee (During Go-Shop):** {go_shop.get('termination_fee_during_go_shop', 'N/A')}%
- **Termination Fee (After Go-Shop):** {go_shop.get('termination_fee_after_go_shop', 'N/A')}%
- **Notes:** {go_shop.get('go_shop_notes', 'None')}

"""

        # Risk assessment
        risks = research_data.get('risk_assessment', {})
        report += f"""## Risk Assessment

### Vote Risk: {(risks.get('vote_risk') or 'Unknown').upper()}
{risks.get('vote_risk_reasoning', 'No reasoning provided.')}

### Finance Risk: {(risks.get('finance_risk') or 'Unknown').upper()}
{risks.get('finance_risk_reasoning', 'No reasoning provided.')}

### Legal/Regulatory Risk: {(risks.get('legal_risk') or 'Unknown').upper()}
{risks.get('legal_risk_reasoning', 'No reasoning provided.')}

### Key Closing Conditions
"""
        conditions = risks.get('key_closing_conditions') or []
        for condition in conditions:
            report += f"- {condition}\n"

        report += f"""
### MAC Provision Strength
{risks.get('mac_provision_strength', 'Unknown')}

### Reverse Termination Fee
{risks.get('reverse_termination_fee', 'N/A')}%

"""

        # Deal protections
        protections = research_data.get('deal_protections', {})
        report += f"""## Deal Protections

- **No-Shop Clause:** {'Yes' if protections.get('no_shop_clause') else 'No'}
- **Matching Rights:** {'Yes' if protections.get('matching_rights') else 'No'}
- **Force-the-Vote:** {'Yes' if protections.get('force_the_vote') else 'No'}
- **Termination Fee:** {protections.get('termination_fee_pct', 'N/A')}% of deal value
- **Expense Reimbursement Cap:** ${protections.get('expense_reimbursement', 'N/A')}M

"""

        # Shareholder approval
        approval = research_data.get('shareholder_approval', {})
        report += f"""## Shareholder Approval

- **Threshold:** {approval.get('approval_threshold', 'N/A')}
- **Expected Vote Date:** {approval.get('expected_vote_date', 'N/A')}
- **Major Shareholders Disclosed:** {'Yes' if approval.get('major_shareholders_disclosed') else 'No'}
- **Support Agreements:** {approval.get('major_shareholder_support', 'None disclosed')}

"""

        # Financing
        financing = research_data.get('financing', {})
        report += f"""## Financing

- **Financing Condition:** {'Yes' if financing.get('buyer_financing_condition') else 'No'}
- **Source:** {financing.get('financing_source', 'N/A')}
- **Commitment Level:** {financing.get('financing_commitment', 'N/A')}
- **Notes:** {financing.get('financing_notes', 'None')}

---

*Report generated by AI analysis of SEC filings*
"""

        return report


# Factory function for easy initialization
def create_research_generator() -> DealResearchGenerator:
    """Create a research generator instance"""
    anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
    if not anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY environment variable not set")
    return DealResearchGenerator(anthropic_api_key)
