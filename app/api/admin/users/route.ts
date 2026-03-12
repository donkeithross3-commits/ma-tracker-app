import { NextResponse } from "next/server"
import * as bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"
import { requireAuth, isAuthError } from "@/lib/auth-api"
import { isAdmin } from "@/lib/admin"
import { DEFAULT_PROJECT_ACCESS, type ProjectKey } from "@/lib/permissions"

const DEFAULT_PASSWORD = "limitless2025"

export async function POST(request: Request) {
  const user = await requireAuth()
  if (isAuthError(user)) return user

  if (!isAdmin(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { email, alias } = body

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 })
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    })
    if (existingUser) {
      return NextResponse.json({ error: "User already exists" }, { status: 409 })
    }

    // Check if alias is taken (if provided)
    const trimmedAlias = alias?.trim() || null
    if (trimmedAlias) {
      const existingAlias = await prisma.user.findUnique({
        where: { alias: trimmedAlias },
      })
      if (existingAlias) {
        return NextResponse.json({ error: "Alias already taken" }, { status: 409 })
      }
    }

    // Create whitelist entry (upsert in case it already exists)
    await prisma.emailWhitelist.upsert({
      where: { email: normalizedEmail },
      update: {
        notes: trimmedAlias ? `Alias: ${trimmedAlias}` : null,
      },
      create: {
        email: normalizedEmail,
        notes: trimmedAlias ? `Alias: ${trimmedAlias}` : null,
        addedBy: user.email,
      },
    })

    // Create the user directly
    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10)
    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        alias: trimmedAlias,
        role: "analyst",
        isActive: true,
        mustChangePassword: true,
        projectAccess: DEFAULT_PROJECT_ACCESS,
      },
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

    // Create default "Favorites" deal list
    await prisma.userDealList.create({
      data: {
        userId: newUser.id,
        name: "Favorites",
        isDefault: true,
      },
    })

    return NextResponse.json(newUser, { status: 201 })
  } catch (error) {
    console.error("Error creating user:", error)
    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 }
    )
  }
}
