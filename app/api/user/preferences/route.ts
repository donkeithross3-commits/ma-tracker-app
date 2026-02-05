import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireAuth, isAuthError } from "@/lib/auth-api"

/**
 * User Preferences API
 * 
 * GET - Fetch current user's preferences
 * PUT - Update current user's preferences (partial updates supported)
 */

// Type definitions for preferences
interface MAOptionsPrefs {
  defaultDealFilter?: string
  showExpiredSpreads?: boolean
  defaultExpiration?: string
  /** Ticker keys selected in Account positions view (persisted per user) */
  positionsSelectedTickers?: string[]
  /** Manually added tickers for position boxes without an IB position (SEC-validated) */
  positionsManualTickers?: { ticker: string; name?: string }[]
  [key: string]: unknown
}

interface DealListPrefs {
  sortBy?: string
  sortOrder?: "asc" | "desc"
  showClosedDeals?: boolean
  [key: string]: unknown
}

interface PreferencesPayload {
  maOptionsPrefs?: MAOptionsPrefs
  dealListPrefs?: DealListPrefs
  customTickers?: string[]
}

/**
 * GET /api/user/preferences
 * Returns the current user's preferences, creating default if none exist
 */
export async function GET() {
  const user = await requireAuth()
  if (isAuthError(user)) return user

  try {
    // Find or create preferences for user
    let preferences = await prisma.userPreferences.findUnique({
      where: { userId: user.id },
    })

    if (!preferences) {
      // Create default preferences
      preferences = await prisma.userPreferences.create({
        data: {
          userId: user.id,
          maOptionsPrefs: {},
          dealListPrefs: {},
          customTickers: [],
        },
      })
    }

    return NextResponse.json({
      maOptionsPrefs: preferences.maOptionsPrefs || {},
      dealListPrefs: preferences.dealListPrefs || {},
      customTickers: preferences.customTickers || [],
    })
  } catch (error) {
    console.error("Error fetching preferences:", error)
    return NextResponse.json(
      { error: "Failed to fetch preferences" },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/user/preferences
 * Update user preferences (partial update - only updates provided fields)
 */
export async function PUT(request: Request) {
  const user = await requireAuth()
  if (isAuthError(user)) return user

  try {
    const body: PreferencesPayload = await request.json()
    
    // Validate payload
    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      )
    }

    // Build update data (only include provided fields)
    const updateData: {
      maOptionsPrefs?: object
      dealListPrefs?: object
      customTickers?: string[]
    } = {}

    if (body.maOptionsPrefs !== undefined) {
      updateData.maOptionsPrefs = body.maOptionsPrefs
    }
    if (body.dealListPrefs !== undefined) {
      updateData.dealListPrefs = body.dealListPrefs
    }
    if (body.customTickers !== undefined) {
      if (!Array.isArray(body.customTickers)) {
        return NextResponse.json(
          { error: "customTickers must be an array" },
          { status: 400 }
        )
      }
      updateData.customTickers = body.customTickers
    }

    // Upsert preferences
    const preferences = await prisma.userPreferences.upsert({
      where: { userId: user.id },
      update: updateData,
      create: {
        userId: user.id,
        maOptionsPrefs: body.maOptionsPrefs || {},
        dealListPrefs: body.dealListPrefs || {},
        customTickers: body.customTickers || [],
      },
    })

    return NextResponse.json({
      maOptionsPrefs: preferences.maOptionsPrefs || {},
      dealListPrefs: preferences.dealListPrefs || {},
      customTickers: preferences.customTickers || [],
    })
  } catch (error) {
    console.error("Error updating preferences:", error)
    return NextResponse.json(
      { error: "Failed to update preferences" },
      { status: 500 }
    )
  }
}
