import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"

/**
 * Authentication Middleware for dr3-dashboard.com
 * 
 * Uses the edge-compatible auth config (no Prisma/Node.js dependencies).
 * The actual credential verification happens in auth.ts on the server.
 * 
 * Protected routes: everything except /login and /api/auth/*
 */
export default NextAuth(authConfig).auth

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
