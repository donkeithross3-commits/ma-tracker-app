import { NextRequest, NextResponse } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function GET() {
  try {
    const resp = await fetch(`${PYTHON_SERVICE_URL}/portfolio/allowlist`, {
      cache: "no-store",
    });
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

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get("ticker");
    const status = searchParams.get("status");
    const notes = searchParams.get("notes");

    if (!ticker || !status) {
      return NextResponse.json(
        { error: "ticker and status are required" },
        { status: 400 }
      );
    }

    const params = new URLSearchParams({ ticker, status });
    if (notes) params.set("notes", notes);

    const resp = await fetch(
      `${PYTHON_SERVICE_URL}/portfolio/allowlist?${params.toString()}`,
      { method: "POST" }
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
