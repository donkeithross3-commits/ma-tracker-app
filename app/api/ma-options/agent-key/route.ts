import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import crypto from "crypto";
import { requireAuth, isAuthError } from "@/lib/auth-api";

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
 * Get the agent API key for the current user, creating one if it doesn't exist.
 */
export async function GET() {
  const user = await requireAuth();
  if (isAuthError(user)) return user;

  try {
    // Try to find existing key for this user
    let agentKey = await prisma.agentApiKey.findUnique({
      where: { userId: user.id },
    });

    // Create new key if none exists
    if (!agentKey) {
      agentKey = await prisma.agentApiKey.create({
        data: {
          userId: user.id,
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
 * Regenerate the agent API key for the current user.
 */
export async function POST() {
  const user = await requireAuth();
  if (isAuthError(user)) return user;

  try {
    const newKey = generateApiKey();

    // Upsert: update existing or create new
    const agentKey = await prisma.agentApiKey.upsert({
      where: { userId: user.id },
      update: {
        key: newKey,
        createdAt: new Date(), // Reset creation date on regenerate
        lastUsed: null,
      },
      create: {
        userId: user.id,
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
 * Delete the agent API key for the current user (disconnects any active agents).
 */
export async function DELETE() {
  const user = await requireAuth();
  if (isAuthError(user)) return user;

  try {
    await prisma.agentApiKey.deleteMany({
      where: { userId: user.id },
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
