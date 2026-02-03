import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";

export interface UserDealListDTO {
  id: string;
  name: string;
  isDefault: boolean;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /api/user/deal-lists
 * Get all deal lists for the current user
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const lists = await prisma.userDealList.findMany({
      where: { userId: session.user.id },
      include: {
        _count: { select: { items: true } },
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });

    const listsDTO: UserDealListDTO[] = lists.map((list) => ({
      id: list.id,
      name: list.name,
      isDefault: list.isDefault,
      itemCount: list._count.items,
      createdAt: list.createdAt.toISOString(),
      updatedAt: list.updatedAt.toISOString(),
    }));

    return NextResponse.json({ lists: listsDTO });
  } catch (error) {
    console.error("Error fetching deal lists:", error);
    return NextResponse.json(
      { error: "Failed to fetch deal lists" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/user/deal-lists
 * Create a new deal list
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "List name is required" },
        { status: 400 }
      );
    }

    const list = await prisma.userDealList.create({
      data: {
        userId: session.user.id,
        name: name.trim(),
        isDefault: false,
      },
      include: {
        _count: { select: { items: true } },
      },
    });

    const listDTO: UserDealListDTO = {
      id: list.id,
      name: list.name,
      isDefault: list.isDefault,
      itemCount: list._count.items,
      createdAt: list.createdAt.toISOString(),
      updatedAt: list.updatedAt.toISOString(),
    };

    return NextResponse.json({ list: listDTO }, { status: 201 });
  } catch (error) {
    console.error("Error creating deal list:", error);
    return NextResponse.json(
      { error: "Failed to create deal list" },
      { status: 500 }
    );
  }
}
