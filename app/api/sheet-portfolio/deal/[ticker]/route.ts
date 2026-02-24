import { NextRequest, NextResponse } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const resp = await fetch(
      `${PYTHON_SERVICE_URL}/portfolio/deal/${encodeURIComponent(ticker)}`,
      { cache: "no-store" }
    );
    if (!resp.ok) {
      const body = await resp.text();
      return NextResponse.json({ error: body }, { status: resp.status });
    }
    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to reach Python service: ${message}` },
      { status: 502 }
    );
  }
}
