import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

/**
 * Poll for account events (order fills, status changes) since a given timestamp.
 * Designed for lightweight 3-second polling to achieve near-real-time UI updates.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ events: [] });
    }

    const since = request.nextUrl.searchParams.get("since") || "0";
    const url = `${PYTHON_SERVICE_URL}/options/relay/account-events?user_id=${encodeURIComponent(user.id)}&since=${since}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ events: [] });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ events: [] });
  }
}
