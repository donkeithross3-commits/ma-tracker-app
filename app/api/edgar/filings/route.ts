import { NextResponse } from 'next/server'

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'all'
    const days = searchParams.get('days') || '7'
    const minKeywords = searchParams.get('minKeywords') || '0'
    const minConfidence = searchParams.get('minConfidence') || '0'
    const ticker = searchParams.get('ticker') || ''

    // Build query string
    const params = new URLSearchParams({
      status,
      days,
      min_keywords: minKeywords,
      min_confidence: minConfidence,
    })

    // Add ticker if provided
    if (ticker) {
      params.append('ticker', ticker)
    }

    const response = await fetch(
      `${PYTHON_API_URL}/edgar/filings?${params}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      }
    )

    if (!response.ok) {
      throw new Error(`Python API returned ${response.status}`)
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching filings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch filings' },
      { status: 500 }
    )
  }
}
