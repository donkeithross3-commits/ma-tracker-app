import { NextResponse } from "next/server";

const PORTFOLIO_SERVICE_URL =
  process.env.PORTFOLIO_SERVICE_URL || process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("job_id") || "";
    const limit = url.searchParams.get("limit") || "20";
    const qs = new URLSearchParams();
    if (jobId) qs.set("job_id", jobId);
    qs.set("limit", limit);

    const resp = await fetch(
      `${PORTFOLIO_SERVICE_URL}/scheduler/runs?${qs.toString()}`,
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
