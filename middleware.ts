import { auth } from "@/auth"
import { NextResponse } from "next/server"

/**
 * Authentication Middleware for dr3-dashboard.com
 * 
 * Protects all routes except:
 * - /login (auth page)
 * - /api/auth/* (NextAuth endpoints)
 * - Static assets (_next/static, _next/image, favicon.ico)
 * 
 * Uses NextAuth v5 JWT sessions for fast, reliable authentication.
 */

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth

  // Public paths that don't require authentication
  const isLoginPage = pathname === "/login"
  const isAuthAPI = pathname.startsWith("/api/auth")
  
  // Allow public paths
  if (isLoginPage || isAuthAPI) {
    // If logged in and trying to access login page, redirect to home
    if (isLoggedIn && isLoginPage) {
      return NextResponse.redirect(new URL("/", req.url))
    }
    return NextResponse.next()
  }

  // Redirect unauthenticated users to login
  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.url)
    // Preserve the original URL to redirect back after login
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Optional: Log user access for debugging
  if (process.env.NODE_ENV === "development") {
    console.log(`[Auth] User ${req.auth?.user?.email} accessing ${pathname}`)
  }

  return NextResponse.next()
})

// Apply middleware to all routes except static assets
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder assets
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
