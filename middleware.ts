import { auth } from "@/auth"

/**
 * Authentication Middleware for dr3-dashboard.com
 * 
 * Uses NextAuth v5 auth wrapper. The actual authorization logic is in
 * the `authorized` callback in auth.ts.
 * 
 * Protected routes: everything except /login and /api/auth/*
 * 
 * When not authenticated, NextAuth automatically redirects to the
 * signIn page configured in auth.ts (/login).
 */
export default auth

// Apply middleware to all routes except static assets
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder assets (images, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
