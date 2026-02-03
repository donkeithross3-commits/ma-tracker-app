import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

/**
 * GET /api/krj/preferences
 * Get user's KRJ preferences (hidden lists, tab order)
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const prefs = await prisma.userKrjPreferences.findUnique({
      where: { userId: session.user.id },
    });

    return NextResponse.json({
      hiddenListIds: prefs?.hiddenListIds || [],
      tabOrder: prefs?.tabOrder || [],
    });
  } catch (error) {
    console.error("Error fetching KRJ preferences:", error);
    return NextResponse.json(
      { error: "Failed to fetch preferences" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/krj/preferences
 * Update user's KRJ preferences
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { hiddenListIds, tabOrder } = body;

    const prefs = await prisma.userKrjPreferences.upsert({
      where: { userId: session.user.id },
      update: {
        ...(hiddenListIds !== undefined && { hiddenListIds }),
        ...(tabOrder !== undefined && { tabOrder }),
      },
      create: {
        userId: session.user.id,
        hiddenListIds: hiddenListIds || [],
        tabOrder: tabOrder || [],
      },
    });

    return NextResponse.json({
      hiddenListIds: prefs.hiddenListIds,
      tabOrder: prefs.tabOrder,
    });
  } catch (error) {
    console.error("Error updating KRJ preferences:", error);
    return NextResponse.json(
      { error: "Failed to update preferences" },
      { status: 500 }
    );
  }
}
