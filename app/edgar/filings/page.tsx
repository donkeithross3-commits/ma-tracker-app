'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Filing {
  filing_id: string
  accession_number: string
  company_name: string
  ticker: string | null
  filing_type: string
  filing_date: string
  filing_url: string
  is_ma_relevant: boolean
  confidence_score: number | null
  detected_keywords: string[]
  keyword_count: number
  reasoning: string | null
  status: string
  processed_at: string | null
}

export default function FilingsReviewPage() {
  const [filings, setFilings] = useState<Filing[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedFilingId, setExpandedFilingId] = useState<string | null>(null)
  const [filters, setFilters] = useState({
    status: 'all',
    days: '7',
    minKeywords: '0',
    minConfidence: '0'
  })

  const fetchFilings = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        status: filters.status,
        days: filters.days,
        minKeywords: filters.minKeywords,
        minConfidence: filters.minConfidence
      })

      const response = await fetch(`/api/edgar/filings?${params}`)
      const data = await response.json()
      setFilings(data.filings || [])
    } catch (error) {
      console.error('Failed to fetch filings:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFilings()
  }, [filters])

  const getConfidenceBadge = (score: number | null) => {
    if (score === null) return <span className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700">N/A</span>

    if (score >= 0.90) {
      return <span className="px-2 py-1 text-xs rounded bg-green-100 text-green-800 font-semibold">HIGH {score.toFixed(2)}</span>
    } else if (score >= 0.75) {
      return <span className="px-2 py-1 text-xs rounded bg-blue-100 text-blue-800 font-semibold">MED-HIGH {score.toFixed(2)}</span>
    } else if (score >= 0.60) {
      return <span className="px-2 py-1 text-xs rounded bg-yellow-100 text-yellow-800">MEDIUM {score.toFixed(2)}</span>
    } else {
      return <span className="px-2 py-1 text-xs rounded bg-red-100 text-red-800">LOW {score.toFixed(2)}</span>
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">EDGAR Filing Analysis</h1>
          <p className="mt-2 text-sm text-gray-600">
            Review detector decisions to tune filtering logic
          </p>
        </div>

        {/* Filters */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Status
              </label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="all">All Filings</option>
                <option value="relevant">M&A Relevant</option>
                <option value="not_relevant">Not Relevant</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Time Period
              </label>
              <select
                value={filters.days}
                onChange={(e) => setFilters({ ...filters, days: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="1">Last 24 hours</option>
                <option value="3">Last 3 days</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Min Keywords
              </label>
              <input
                type="number"
                min="0"
                value={filters.minKeywords}
                onChange={(e) => setFilters({ ...filters, minKeywords: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Min Confidence
              </label>
              <input
                type="number"
                min="0"
                max="1"
                step="0.1"
                value={filters.minConfidence}
                onChange={(e) => setFilters({ ...filters, minConfidence: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              />
            </div>
          </div>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white shadow rounded-lg p-4">
            <div className="text-sm font-medium text-gray-500">Total Filings</div>
            <div className="mt-1 text-3xl font-semibold text-gray-900">{filings.length}</div>
          </div>
          <div className="bg-white shadow rounded-lg p-4">
            <div className="text-sm font-medium text-gray-500">M&A Relevant</div>
            <div className="mt-1 text-3xl font-semibold text-green-600">
              {filings.filter(f => f.is_ma_relevant).length}
            </div>
          </div>
          <div className="bg-white shadow rounded-lg p-4">
            <div className="text-sm font-medium text-gray-500">Not Relevant</div>
            <div className="mt-1 text-3xl font-semibold text-red-600">
              {filings.filter(f => !f.is_ma_relevant).length}
            </div>
          </div>
          <div className="bg-white shadow rounded-lg p-4">
            <div className="text-sm font-medium text-gray-500">Avg Confidence</div>
            <div className="mt-1 text-3xl font-semibold text-blue-600">
              {filings.length > 0
                ? (filings.reduce((sum, f) => sum + (f.confidence_score || 0), 0) / filings.length).toFixed(2)
                : '0.00'}
            </div>
          </div>
        </div>

        {/* Filings Table */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading filings...</div>
          ) : filings.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No filings found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Company
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Filing
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Keywords
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Confidence
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filings.map((filing) => (
                    <>
                      <tr
                        key={filing.filing_id}
                        className={filing.is_ma_relevant ? 'bg-green-50' : ''}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{filing.company_name}</div>
                          <div className="text-sm text-gray-500">{filing.ticker || 'N/A'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <a
                            href={filing.filing_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800 hover:bg-gray-200 cursor-pointer"
                          >
                            {filing.filing_type}
                          </a>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(filing.filing_date).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-indigo-100 text-indigo-800">
                            {filing.keyword_count} keywords
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getConfidenceBadge(filing.confidence_score)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {filing.reasoning && (
                            <button
                              onClick={() => setExpandedFilingId(expandedFilingId === filing.filing_id ? null : filing.filing_id)}
                              className="text-purple-600 hover:text-purple-800 font-medium"
                              title="View reasoning"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedFilingId === filing.filing_id && filing.reasoning && (
                        <tr className="bg-purple-50">
                          <td colSpan={6} className="px-6 py-4">
                            <div className="text-sm">
                              <div className="font-semibold text-purple-900 mb-2 flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                Detector Reasoning:
                              </div>
                              <div className="text-gray-700 bg-white p-4 rounded border border-purple-200 leading-relaxed">
                                {filing.reasoning}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
