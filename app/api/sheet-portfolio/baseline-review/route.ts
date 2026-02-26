import { NextRequest } from "next/server";

const PORTFOLIO_SERVICE_URL =
  process.env.PORTFOLIO_SERVICE_URL || process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function GET(req: NextRequest) {
  const view = req.nextUrl.searchParams.get("view") || "flagged";
  try {
    const resp = await fetch(
      `${PORTFOLIO_SERVICE_URL}/risk/baseline-review-html?view=${encodeURIComponent(view)}`,
      { cache: "no-store" }
    );
    if (!resp.ok) {
      const body = await resp.text();
      return new Response(body, { status: resp.status });
    }
    return new Response(resp.body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Failed to reach Python service: ${message}`, {
      status: 502,
    });
  }
}
