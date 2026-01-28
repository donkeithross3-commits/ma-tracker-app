import { auth } from "@/auth"
import { NextResponse } from "next/server"

/**
 * User object returned from requireAuth
 */
export interface AuthenticatedUser {
  id: string
  email: string
  name?: string | null
  role?: string
}

/**
 * Require authentication for API routes.
 * 
 * Usage in API route:
 * ```typescript
 * export async function GET() {
 *   const user = await requireAuth()
 *   if (user instanceof NextResponse) return user // Unauthorized
 *   
 *   // user is now AuthenticatedUser
 *   console.log(user.id, user.email)
 * }
 * ```
 * 
 * @returns AuthenticatedUser if authenticated, NextResponse with 401 if not
 */
export async function requireAuth(): Promise<AuthenticatedUser | NextResponse> {
  const session = await auth()
  
  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    )
  }
  
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  }
}

/**
 * Get the current user from session, or null if not authenticated.
 * Useful for optional authentication scenarios.
 * 
 * @returns AuthenticatedUser or null
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const session = await auth()
  
  if (!session?.user?.id || !session?.user?.email) {
    return null
  }
  
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  }
}

/**
 * Type guard to check if requireAuth result is an error response
 */
export function isAuthError(result: AuthenticatedUser | NextResponse): result is NextResponse {
  return result instanceof NextResponse
}
