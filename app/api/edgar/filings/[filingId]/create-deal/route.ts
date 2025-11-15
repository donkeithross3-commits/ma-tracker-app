import { NextResponse } from 'next/server'

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000'

export async function POST(
  request: Request,
  { params }: { params: { filingId: string } }
) {
  try {
    const body = await request.json()

    const response = await fetch(
      `${PYTHON_API_URL}/edgar/filings/${params.filingId}/create-deal`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )

    if (!response.ok) {
      const error = await response.json()
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error creating deal from filing:', error)
    return NextResponse.json(
      { error: 'Failed to create deal from filing' },
      { status: 500 }
    )
  }
}
