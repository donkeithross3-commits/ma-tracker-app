import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { ScannerDealDTO } from "../route";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// PUT - Update a scanner deal
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { ticker, targetName, expectedClosePrice, expectedCloseDate, notes, isActive, noOptionsAvailable, lastOptionsCheck } =
      body;

    // Check if deal exists
    const existing = await prisma.scannerDeal.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // If changing ticker, check it's not a duplicate
    if (ticker && ticker.toUpperCase() !== existing.ticker) {
      const duplicate = await prisma.scannerDeal.findUnique({
        where: { ticker: ticker.toUpperCase() },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: `Deal for ticker ${ticker.toUpperCase()} already exists` },
          { status: 409 }
        );
      }
    }

    const deal = await prisma.scannerDeal.update({
      where: { id },
      data: {
        ...(ticker && { ticker: ticker.toUpperCase() }),
        ...(targetName !== undefined && { targetName: targetName || null }),
        ...(expectedClosePrice !== undefined && { expectedClosePrice }),
        ...(expectedCloseDate !== undefined && {
          expectedCloseDate: new Date(expectedCloseDate),
        }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(isActive !== undefined && { isActive }),
        ...(noOptionsAvailable !== undefined && { noOptionsAvailable }),
        ...(lastOptionsCheck !== undefined && { 
          lastOptionsCheck: lastOptionsCheck ? new Date(lastOptionsCheck) : null 
        }),
      },
    });

    const expectedDate = new Date(deal.expectedCloseDate);
    const today = new Date();
    const daysToClose = Math.ceil(
      (expectedDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    const dealDTO: ScannerDealDTO = {
      id: deal.id,
      ticker: deal.ticker,
      targetName: deal.targetName,
      expectedClosePrice: deal.expectedClosePrice.toNumber(),
      expectedCloseDate: deal.expectedCloseDate.toISOString().split("T")[0],
      daysToClose,
      notes: deal.notes,
      isActive: deal.isActive,
      noOptionsAvailable: deal.noOptionsAvailable,
      lastOptionsCheck: deal.lastOptionsCheck?.toISOString() || null,
      createdAt: deal.createdAt.toISOString(),
      updatedAt: deal.updatedAt.toISOString(),
    };

    return NextResponse.json({ deal: dealDTO });
  } catch (error) {
    console.error("Error updating scanner deal:", error);
    return NextResponse.json(
      { error: "Failed to update scanner deal" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a scanner deal (soft delete by setting isActive = false)
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Check if deal exists
    const existing = await prisma.scannerDeal.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // Soft delete
    await prisma.scannerDeal.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting scanner deal:", error);
    return NextResponse.json(
      { error: "Failed to delete scanner deal" },
      { status: 500 }
    );
  }
}
