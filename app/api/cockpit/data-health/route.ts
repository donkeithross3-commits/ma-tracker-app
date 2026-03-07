import { NextResponse } from "next/server";
import {
  fetchFredSeries,
  fetchPolygonBars,
  type DataHealthCheck,
  type DataHealthResponse,
} from "@/lib/cockpit";

export const dynamic = "force-dynamic";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function GET() {
  const checks: DataHealthCheck[] = [];

  // 1. FRED data freshness
  try {
    const dgs10 = await fetchFredSeries("DGS10", 10);
    if (dgs10.length === 0) {
      checks.push({ source: "FRED", status: "error", lastUpdate: null, message: "No FRED data returned" });
    } else {
      const latestDate = dgs10[dgs10.length - 1].date;
      const daysSince = Math.floor(
        (Date.now() - new Date(latestDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      // FRED doesn't publish on weekends/holidays, so allow up to 4 days
      checks.push({
        source: "FRED",
        status: daysSince > 4 ? "stale" : "ok",
        lastUpdate: latestDate,
        message: daysSince > 4
          ? `Last FRED data is ${daysSince} days old`
          : `FRED data current (${latestDate})`,
      });
    }
  } catch {
    checks.push({ source: "FRED", status: "error", lastUpdate: null, message: "Failed to reach FRED" });
  }

  // 2. Polygon data freshness
  try {
    const spy = await fetchPolygonBars("SPY", 5);
    if (spy.length === 0) {
      checks.push({ source: "Polygon", status: "error", lastUpdate: null, message: "No Polygon data returned" });
    } else {
      const latestDate = spy[spy.length - 1].date;
      const daysSince = Math.floor(
        (Date.now() - new Date(latestDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      checks.push({
        source: "Polygon",
        status: daysSince > 4 ? "stale" : "ok",
        lastUpdate: latestDate,
        message: daysSince > 4
          ? `Last Polygon bar is ${daysSince} days old`
          : `Polygon data current (${latestDate})`,
      });
    }
  } catch {
    checks.push({ source: "Polygon", status: "error", lastUpdate: null, message: "Failed to reach Polygon" });
  }

  // 3. Fleet/Python service health
  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/fleet/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      checks.push({
        source: "Fleet Service",
        status: "ok",
        lastUpdate: new Date().toISOString(),
        message: `Fleet service responding — ${data.machines?.length ?? 0} machines tracked`,
      });
    } else {
      checks.push({
        source: "Fleet Service",
        status: "error",
        lastUpdate: null,
        message: `Fleet service returned ${res.status}`,
      });
    }
  } catch {
    checks.push({
      source: "Fleet Service",
      status: "error",
      lastUpdate: null,
      message: "Fleet service unreachable",
    });
  }

  // 4. DR3 Dashboard health
  try {
    const res = await fetch("https://dr3-dashboard.com/api/health", {
      signal: AbortSignal.timeout(5000),
    });
    checks.push({
      source: "DR3 Dashboard",
      status: res.ok ? "ok" : "error",
      lastUpdate: new Date().toISOString(),
      message: res.ok ? "Dashboard responding" : `Dashboard returned ${res.status}`,
    });
  } catch {
    checks.push({
      source: "DR3 Dashboard",
      status: "error",
      lastUpdate: null,
      message: "Dashboard unreachable",
    });
  }

  // Overall status
  const hasError = checks.some((c) => c.status === "error");
  const hasStale = checks.some((c) => c.status === "stale");
  const overall = hasError ? "unhealthy" : hasStale ? "degraded" : "healthy";

  const response: DataHealthResponse = {
    asOf: new Date().toISOString(),
    checks,
    overall,
  };

  return NextResponse.json(response);
}
