import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import crypto from "crypto";

// Default user ID for single-user mode (since this app doesn't have multi-user auth)
const DEFAULT_USER_ID = "default-user";

/**
 * Generate a secure random API key
 */
function generateApiKey(): string {
  // Generate 32 random bytes and encode as base64url
  const bytes = crypto.randomBytes(32);
  return bytes.toString("base64url");
}

/**
 * GET /api/ma-options/agent-key
 * Get the agent API key, creating one if it doesn't exist.
 */
export async function GET() {
  try {
    const userId = DEFAULT_USER_ID;

    // Try to find existing key
    let agentKey = await prisma.agentApiKey.findUnique({
      where: { userId },
    });

    // Create new key if none exists
    if (!agentKey) {
      agentKey = await prisma.agentApiKey.create({
        data: {
          userId,
          key: generateApiKey(),
        },
      });
    }

    return NextResponse.json({
      key: agentKey.key,
      createdAt: agentKey.createdAt,
      lastUsed: agentKey.lastUsed,
    });
  } catch (error) {
    console.error("Error getting agent key:", error);
    return NextResponse.json(
      { error: "Failed to get agent key" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ma-options/agent-key
 * Regenerate the agent API key.
 */
export async function POST() {
  try {
    const userId = DEFAULT_USER_ID;
    const newKey = generateApiKey();

    // Upsert: update existing or create new
    const agentKey = await prisma.agentApiKey.upsert({
      where: { userId },
      update: {
        key: newKey,
        createdAt: new Date(), // Reset creation date on regenerate
        lastUsed: null,
      },
      create: {
        userId,
        key: newKey,
      },
    });

    return NextResponse.json({
      key: agentKey.key,
      createdAt: agentKey.createdAt,
      lastUsed: agentKey.lastUsed,
      message: "API key regenerated successfully",
    });
  } catch (error) {
    console.error("Error regenerating agent key:", error);
    return NextResponse.json(
      { error: "Failed to regenerate agent key" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/ma-options/agent-key
 * Delete the agent API key (disconnects any active agents).
 */
export async function DELETE() {
  try {
    const userId = DEFAULT_USER_ID;

    await prisma.agentApiKey.deleteMany({
      where: { userId },
    });

    return NextResponse.json({
      message: "API key deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting agent key:", error);
    return NextResponse.json(
      { error: "Failed to delete agent key" },
      { status: 500 }
    );
  }
}
