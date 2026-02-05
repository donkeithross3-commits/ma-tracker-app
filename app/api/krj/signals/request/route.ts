import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import fs from "fs";
import path from "path";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";
const ON_DEMAND_SIGNALS_PATH = path.join(process.cwd(), "data", "krj", "on_demand_signals.json");

type RawRow = Record<string, string>;

/**
 * POST /api/krj/signals/request
 * Request on-demand KRJ signal for one ticker (calls Python service, merges into on_demand_signals.json).
 * Requires auth.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { ticker?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ticker = (body.ticker ?? "").toString().trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  try {
    const url = `${PYTHON_SERVICE_URL}/krj/signals/single?ticker=${encodeURIComponent(ticker)}`;
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    const row = (await res.json()) as RawRow | { detail?: string };

    if (!res.ok) {
      const detail = typeof (row as { detail?: string }).detail === "string"
        ? (row as { detail: string }).detail
        : "Backend could not compute signal";
      return NextResponse.json(
        { error: detail },
        { status: res.status >= 400 ? res.status : 502 }
      );
    }

    if (!row || typeof row !== "object" || !(row as RawRow).ticker) {
      return NextResponse.json(
        { error: "Invalid response from signal service" },
        { status: 502 }
      );
    }

    const typedRow = row as RawRow;
    const dataDir = path.join(process.cwd(), "data", "krj");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    let existing: Record<string, RawRow> = {};
    if (fs.existsSync(ON_DEMAND_SIGNALS_PATH)) {
      try {
        const raw = fs.readFileSync(ON_DEMAND_SIGNALS_PATH, "utf8");
        existing = JSON.parse(raw) as Record<string, RawRow>;
      } catch {
        // ignore corrupt file
      }
    }

    existing[typedRow.ticker.toUpperCase()] = typedRow;
    fs.writeFileSync(ON_DEMAND_SIGNALS_PATH, JSON.stringify(existing, null, 2), "utf8");

    return NextResponse.json({ row: typedRow });
  } catch (e) {
    console.error("KRJ signal request error:", e);
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
