import { NextResponse } from "next/server";

const PORTFOLIO_SERVICE_URL =
  process.env.PORTFOLIO_SERVICE_URL || "http://python-portfolio:8001";

export async function GET() {
  try {
    const resp = await fetch(
      `${PORTFOLIO_SERVICE_URL}/research/enrichment/progress`,
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
      { error: `Failed to reach portfolio service: ${message}` },
      { status: 502 }
    );
  }
}
