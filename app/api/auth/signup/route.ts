import { NextResponse } from "next/server"
import * as bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, username, fullName, password } = body

    // Validate required fields
    if (!email || !username || !password) {
      return NextResponse.json(
        { error: "Email, username, and password are required" },
        { status: 400 }
      )
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim()

    // Validate password strength
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      )
    }

    // Check if email is whitelisted
    const whitelistEntry = await prisma.emailWhitelist.findUnique({
      where: { email: normalizedEmail }
    })

    if (!whitelistEntry) {
      return NextResponse.json(
        { error: "This email address is not authorized to create an account. Please contact an administrator." },
        { status: 403 }
      )
    }

    // Check if email already registered
    const existingUserByEmail = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    })

    if (existingUserByEmail) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 400 }
      )
    }

    // Check if username is taken
    const existingUserByUsername = await prisma.user.findUnique({
      where: { username: username.trim() }
    })

    if (existingUserByUsername) {
      return NextResponse.json(
        { error: "This username is already taken" },
        { status: 400 }
      )
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    // Create user
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        username: username.trim(),
        fullName: fullName?.trim() || null,
        password: hashedPassword,
        role: "analyst", // Default role
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        username: true,
      }
    })

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
      }
    })
  } catch (error) {
    console.error("Error creating user:", error)
    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 500 }
    )
  }
}
