import { NextRequest, NextResponse } from "next/server";

/**
 * TEMPORARILY DISABLED FOR PRODUCTION
 * 
 * This route depends on Prisma models (dealResearchReport, secFiling) that are not yet in the schema.
 * Disabled to prevent runtime errors during KRJ production deployment.
 * 
 * TODO: Re-enable after adding required models to prisma/schema.prisma
 */

export async function POST(request: NextRequest) {
  return NextResponse.json(
    {
      error: "Not Implemented",
      message: "Research report generation is temporarily disabled. This feature depends on database models that are not yet configured in production.",
      status: 501,
    },
    { status: 501 }
  );
}

export async function GET(request: NextRequest) {
  return NextResponse.json(
    {
      error: "Not Implemented",
      message: "Research report retrieval is temporarily disabled. This feature depends on database models that are not yet configured in production.",
      status: 501,
    },
    { status: 501 }
  );
}
