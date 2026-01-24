import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware for the KRJ application
 * 
 * PHASE 2 UPDATE (Dec 2025):
 * - Removed Basic Auth (now handled by Cloudflare Access as outer gate)
 * - Cloudflare Access provides authentication before requests reach the app
 * - Future: Will add NextAuth session checks here for app-level user management
 * 
 * For now, this middleware is a pass-through. Cloudflare Access handles:
 * - Email-based authentication (One-Time PIN)
 * - Access control to krj-dev.dr3-dashboard.com
 * - Identity headers (CF-Access-Authenticated-User-Email)
 */

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only apply middleware to /krj routes
  if (!pathname.startsWith("/krj")) {
    return NextResponse.next();
  }

  // Optional: Log Cloudflare Access identity (for debugging)
  if (process.env.NODE_ENV === "development") {
    const cfEmail = req.headers.get("CF-Access-Authenticated-User-Email");
    if (cfEmail) {
      console.log(`[KRJ Access] User: ${cfEmail}`);
    }
  }

  // Pass through - Cloudflare Access handles outer authentication
  // Future: Add NextAuth session check here for app-level user preferences
  return NextResponse.next();
}

// Tell Next which paths use this middleware
export const config = {
  matcher: ["/krj/:path*", "/krj"],
};
