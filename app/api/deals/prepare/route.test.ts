/**
 * Integration tests for /api/deals/prepare route
 *
 * Tests the bug fix for "failed to fetch deal data" error where the route
 * now supports both intelligence_deal_id and staged_deal_id parameters.
 *
 * This prevents regression of the issue where users couldn't add deals to
 * production because the route only queried the deal_intelligence table.
 */

import { NextRequest } from 'next/server';
import { GET } from './route';

// Mock fetch globally
global.fetch = jest.fn();

describe('/api/deals/prepare', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe('Successful Cases', () => {
    it('should fetch and prepare deal data with intelligence_deal_id', async () => {
      const mockIntelligenceDeal = {
        deal: {
          deal_id: 'intel-123',
          target_name: 'TreeHouse Foods',
          target_ticker: 'THS',
          acquirer_name: 'Acquirer Co',
          acquirer_ticker: 'ACQ',
          deal_value: 3.5,
          deal_type: 'merger',
          confidence_score: 0.95,
          source_count: 5,
          first_detected_at: '2025-01-10T00:00:00Z',
          deal_status: 'active',
        },
        sources: [
          {
            source_id: 'src-1',
            source_name: 'EDGAR',
            headline: 'TreeHouse merger announced',
          },
        ],
      };

      // Mock successful intelligence endpoint response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockIntelligenceDeal,
      });

      // Mock research endpoint (optional)
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const request = new NextRequest('http://localhost:3000/api/deals/prepare?dealId=intel-123');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.deal).toBeDefined();
      expect(data.deal.ticker).toBe('THS');
      expect(data.deal.targetName).toBe('TreeHouse Foods');
      expect(data.deal.acquirorName).toBe('Acquirer Co');
      expect(data.deal.dealValue).toBe(3.5);
      expect(data.deal.isStagedDeal).toBe(false); // Intelligence deal
      expect(data.deal.intelligenceDealId).toBe('intel-123');
      expect(data.deal.sources).toHaveLength(1);

      // Verify fetch was called with intelligence endpoint first
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/intelligence/deals/intel-123'
      );
    });

    it('should fallback to staged_deals when intelligence deal not found (404)', async () => {
      const mockStagedDeal = {
        deal: {
          staged_deal_id: 'staged-456',
          target_name: 'Test Company',
          target_ticker: 'TEST',
          acquirer_name: 'Buyer Corp',
          acquirer_ticker: 'BUY',
          deal_value: 2.1,
          deal_type: 'acquisition',
          confidence_score: 0.85,
          detected_at: '2025-01-11T00:00:00Z',
        },
      };

      // Mock 404 response from intelligence endpoint
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      // Mock successful staged deals endpoint response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockStagedDeal,
      });

      const request = new NextRequest('http://localhost:3000/api/deals/prepare?dealId=staged-456');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.deal).toBeDefined();
      expect(data.deal.ticker).toBe('TEST');
      expect(data.deal.targetName).toBe('Test Company');
      expect(data.deal.acquirorName).toBe('Buyer Corp');
      expect(data.deal.dealValue).toBe(2.1);
      expect(data.deal.isStagedDeal).toBe(true); // Staged deal
      expect(data.deal.intelligenceDealId).toBe('staged-456'); // Uses staged_deal_id
      expect(data.deal.status).toBe('active'); // Default status for staged deals
      expect(data.deal.sourceCount).toBe(1); // Default for staged deals

      // Verify fetch was called with both endpoints
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:8000/intelligence/deals/staged-456'
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:8000/edgar/staged-deals/staged-456'
      );
    });

    it('should transform staged deal data to match expected form format', async () => {
      const mockStagedDeal = {
        deal: {
          staged_deal_id: 'transform-test',
          target_name: 'Transform Co',
          target_ticker: 'TRAN',
          acquirer_name: null, // Test with null acquirer
          acquirer_ticker: null,
          deal_value: null, // Test with null deal value
          deal_type: null,
          confidence_score: 0.70,
          detected_at: '2025-01-12T00:00:00Z',
        },
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: false, status: 404 }) // Intelligence 404
        .mockResolvedValueOnce({ // Staged deals success
          ok: true,
          status: 200,
          json: async () => mockStagedDeal,
        });

      const request = new NextRequest('http://localhost:3000/api/deals/prepare?dealId=transform-test');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);

      // Verify all expected fields are present and properly defaulted
      expect(data.deal.ticker).toBe('TRAN');
      expect(data.deal.targetName).toBe('Transform Co');
      expect(data.deal.acquirorTicker).toBe('');
      expect(data.deal.acquirorName).toBe('');
      expect(data.deal.status).toBe('active');
      expect(data.deal.dealValue).toBeNull();
      expect(data.deal.dealType).toBeNull();
      expect(data.deal.announcedDate).toBeNull();
      expect(data.deal.expectedCloseDate).toBeNull();
      expect(data.deal.outsideDate).toBeNull();
      expect(data.deal.goShopEndDate).toBeNull();
      expect(data.deal.category).toBeNull();
      expect(data.deal.cashPerShare).toBeNull();
      expect(data.deal.stockRatio).toBeNull();
      expect(data.deal.dividendsOther).toBeNull();
      expect(data.deal.voteRisk).toBeNull();
      expect(data.deal.financeRisk).toBeNull();
      expect(data.deal.legalRisk).toBeNull();
      expect(data.deal.stressTestDiscount).toBeNull();
      expect(data.deal.currentYield).toBeNull();
      expect(data.deal.isInvestable).toBe(false);
      expect(data.deal.investableNotes).toBe('');
      expect(data.deal.dealNotes).toBe('');
      expect(data.deal.researchReport).toBeNull();
      expect(data.deal.hasResearch).toBe(false);
      expect(data.deal.sources).toEqual([]);
      expect(data.deal.isStagedDeal).toBe(true);
    });

    it('should include research data when available for intelligence deals', async () => {
      const mockIntelligenceDeal = {
        deal: {
          deal_id: 'research-test',
          target_name: 'Research Co',
          target_ticker: 'RES',
          acquirer_name: 'Big Buyer',
          confidence_score: 0.95,
          source_count: 3,
          first_detected_at: '2025-01-10T00:00:00Z',
        },
        sources: [],
      };

      const mockResearchData = {
        report_markdown: '# Research Report\n\nDetailed analysis...',
        extracted_deal_terms: {
          deal_terms: {
            total_deal_value: 5.2,
            deal_type: 'tender_offer',
            cash_per_share: 42.50,
            announced_date: '2025-01-05',
            expected_close_date: '2025-03-31',
          },
          risk_assessment: {
            vote_risk: 'low',
            finance_risk: 'medium',
            legal_risk: 'low',
          },
        },
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ // Intelligence deals
          ok: true,
          status: 200,
          json: async () => mockIntelligenceDeal,
        })
        .mockResolvedValueOnce({ // Research data
          ok: true,
          status: 200,
          json: async () => mockResearchData,
        });

      const request = new NextRequest('http://localhost:3000/api/deals/prepare?dealId=research-test');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.deal.dealValue).toBe(5.2);
      expect(data.deal.dealType).toBe('tender_offer');
      expect(data.deal.cashPerShare).toBe(42.50);
      expect(data.deal.announcedDate).toBe('2025-01-05');
      expect(data.deal.expectedCloseDate).toBe('2025-03-31');
      expect(data.deal.voteRisk).toBe('low');
      expect(data.deal.financeRisk).toBe('medium');
      expect(data.deal.legalRisk).toBe('low');
      expect(data.deal.researchReport).toContain('# Research Report');
      expect(data.deal.hasResearch).toBe(true);
    });
  });

  describe('Error Cases', () => {
    it('should return 400 if dealId parameter is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/deals/prepare');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('dealId parameter is required');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should return 500 if deal not found in either table', async () => {
      // Mock 404 from intelligence endpoint
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      // Mock 404 from staged deals endpoint
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const request = new NextRequest('http://localhost:3000/api/deals/prepare?dealId=nonexistent-123');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to prepare deal');
      expect(data.details).toContain('Deal not found in either intelligence or staged deals tables');
      expect(data.details).toContain('nonexistent-123'); // Should include the ID for debugging

      // Verify both endpoints were tried
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should return 500 if intelligence endpoint returns non-404 error', async () => {
      // Mock 500 error from intelligence endpoint
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const request = new NextRequest('http://localhost:3000/api/deals/prepare?dealId=error-test');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to prepare deal');
      expect(data.details).toContain('Failed to fetch deal from intelligence service');
      expect(data.details).toContain('Internal Server Error');

      // Should not try staged deals endpoint on non-404 error
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should handle network errors gracefully', async () => {
      // Mock network error
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const request = new NextRequest('http://localhost:3000/api/deals/prepare?dealId=network-error-test');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to prepare deal');
      expect(data.details).toContain('Network error');
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain backward compatibility with existing intelligence deal IDs', async () => {
      // This test ensures that existing code passing intelligence_deal_id still works
      const mockIntelligenceDeal = {
        deal: {
          deal_id: 'legacy-intel-999',
          target_name: 'Legacy Deal',
          target_ticker: 'LEG',
          acquirer_name: 'Old Acquirer',
          confidence_score: 0.90,
          source_count: 2,
          first_detected_at: '2024-12-01T00:00:00Z',
        },
        sources: [],
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockIntelligenceDeal,
        })
        .mockResolvedValueOnce({ ok: false, status: 404 }); // Research not found

      const request = new NextRequest('http://localhost:3000/api/deals/prepare?dealId=legacy-intel-999');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.deal.ticker).toBe('LEG');
      expect(data.deal.isStagedDeal).toBe(false);
      expect(data.deal.intelligenceDealId).toBe('legacy-intel-999');

      // Should only call intelligence endpoint (not fallback to staged)
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8000/intelligence/deals/legacy-intel-999'
      );
    });
  });

  describe('Data Integrity', () => {
    it('should preserve all original data from intelligence deals', async () => {
      const comprehensiveDeal = {
        deal: {
          deal_id: 'comprehensive-test',
          target_name: 'Complete Deal Co',
          target_ticker: 'CDC',
          acquirer_name: 'Full Acquirer Inc',
          acquirer_ticker: 'FAI',
          deal_value: 10.5,
          deal_type: 'merger_of_equals',
          confidence_score: 0.98,
          source_count: 12,
          first_detected_at: '2025-01-01T00:00:00Z',
          deal_status: 'pending_approval',
          edgar_status: 'filed',
        },
        sources: [
          { source_id: '1', source_name: 'EDGAR', headline: 'Filing' },
          { source_id: '2', source_name: 'Reuters', headline: 'News' },
        ],
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => comprehensiveDeal,
        })
        .mockResolvedValueOnce({ ok: false, status: 404 });

      const request = new NextRequest('http://localhost:3000/api/deals/prepare?dealId=comprehensive-test');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.deal.ticker).toBe('CDC');
      expect(data.deal.acquirorTicker).toBe('FAI');
      expect(data.deal.dealValue).toBe(10.5);
      expect(data.deal.dealType).toBe('merger_of_equals');
      expect(data.deal.confidenceScore).toBe(0.98);
      expect(data.deal.sourceCount).toBe(12);
      expect(data.deal.edgar_status).toBe('filed');
      expect(data.deal.sources).toHaveLength(2);
    });
  });
});
