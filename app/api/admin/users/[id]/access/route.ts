import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth, isAuthError } from "@/lib/auth-api"
import { isAdmin } from "@/lib/admin"
import { ALL_PROJECTS, type ProjectKey } from "@/lib/permissions"

const VALID_KEYS = new Set(Object.keys(ALL_PROJECTS))

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth()
  if (isAuthError(user)) return user

  if (!isAdmin(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params

  try {
    const body = await request.json()
    const { projectAccess } = body

    if (!Array.isArray(projectAccess)) {
      return NextResponse.json(
        { error: "projectAccess must be an array" },
        { status: 400 }
      )
    }

    // Validate every key is a known project
    for (const key of projectAccess) {
      if (!VALID_KEYS.has(key)) {
        return NextResponse.json(
          { error: `Invalid project key: ${key}` },
          { status: 400 }
        )
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { projectAccess: projectAccess as ProjectKey[] },
      select: {
        id: true,
        email: true,
        alias: true,
        fullName: true,
        role: true,
        isActive: true,
        projectAccess: true,
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error("Error updating user access:", error)
    return NextResponse.json(
      { error: "Failed to update user access" },
      { status: 500 }
    )
  }
}
