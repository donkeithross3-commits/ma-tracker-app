import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-api";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const userId = user?.id ?? null;
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { orderId, contract, order, timeout_sec } = body;

    if (orderId === undefined || orderId === null) {
      return NextResponse.json(
        { error: "orderId required in body" },
        { status: 400 }
      );
    }
    if (!contract || !order) {
      return NextResponse.json(
        { error: "contract and order required in body" },
        { status: 400 }
      );
    }

    const url = new URL(`${PYTHON_SERVICE_URL}/options/relay/modify-order`);
    url.searchParams.set("user_id", String(userId));

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: Number(orderId),
        contract,
        order,
        timeout_sec: timeout_sec ?? 30,
      }),
    });

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    const isJson =
      contentType.includes("application/json") ||
      (text.trimStart().startsWith("{") || text.trimStart().startsWith("["));

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
        errorDetail = `Backend returned non-JSON (${response.status}).`;
      }
      return NextResponse.json(
        { error: errorDetail },
        { status: response.status }
      );
    }

    if (!isJson) {
      return NextResponse.json(
        { error: "Backend returned HTML instead of JSON." },
        { status: 502 }
      );
    }

    const data = JSON.parse(text);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error modifying order:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to modify order",
      },
      { status: 500 }
    );
  }
}
