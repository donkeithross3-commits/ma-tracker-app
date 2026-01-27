import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/ma-options/validate-agent-key
 * Internal API to validate agent API keys from the Python service.
 * 
 * This endpoint is called by the WebSocket relay to validate API keys
 * and associate connections with users.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { key } = body;

    if (!key) {
      return NextResponse.json(
        { valid: false, error: "No key provided" },
        { status: 400 }
      );
    }

    // Look up the key in the database
    const agentKey = await prisma.agentApiKey.findUnique({
      where: { key },
      select: {
        userId: true,
        id: true,
      },
    });

    if (!agentKey) {
      return NextResponse.json({ valid: false });
    }

    // Update last used timestamp
    await prisma.agentApiKey.update({
      where: { id: agentKey.id },
      data: { lastUsed: new Date() },
    });

    return NextResponse.json({
      valid: true,
      userId: agentKey.userId,
    });
  } catch (error) {
    console.error("Error validating agent key:", error);
    return NextResponse.json(
      { valid: false, error: "Validation failed" },
      { status: 500 }
    );
  }
}
