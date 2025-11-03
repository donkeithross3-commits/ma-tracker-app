import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// Temporarily simplified middleware to reduce bundle size for Vercel free tier
// TODO: Re-enable full NextAuth middleware after upgrading Vercel plan
export function middleware(request: NextRequest) {
  // Allow all requests for now
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
