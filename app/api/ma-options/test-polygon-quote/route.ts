import { NextRequest, NextResponse } from "next/server";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(`${PYTHON_SERVICE_URL}/options/polygon-quote`);
    url.searchParams.set("ticker", "SPY");

    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(fetchTimeout);

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    const isJson =
      contentType.includes("application/json") ||
      text.trimStart().startsWith("{") ||
      text.trimStart().startsWith("[");

    if (!response.ok) {
      let errorDetail: string;
      if (isJson) {
        try {
          const errorData = JSON.parse(text);
          errorDetail =
            (typeof errorData.detail === "string" && errorData.detail) ||
            (typeof errorData.error === "string" && errorData.error) ||
            `Request failed: ${response.status}`;
        } catch {
          errorDetail = `Request failed: ${response.status}`;
        }
      } else {
        errorDetail = `Backend returned non-JSON (${response.status}). Check Python service is running on port 8000.`;
      }
      return NextResponse.json(
        { success: false, error: errorDetail },
        { status: response.status }
      );
    }

    if (!isJson) {
      return NextResponse.json(
        { success: false, error: "Backend returned HTML instead of JSON." },
        { status: 502 }
      );
    }

    const data = JSON.parse(text);
    return NextResponse.json(data);
  } catch (error) {
    const isAbort =
      error instanceof DOMException && error.name === "AbortError";
    return NextResponse.json(
      {
        success: false,
        error: isAbort
          ? "Polygon quote timed out (15s)."
          : error instanceof Error
            ? error.message
            : "Failed to fetch Polygon quote",
      },
      { status: isAbort ? 504 : 500 }
    );
  }
}
