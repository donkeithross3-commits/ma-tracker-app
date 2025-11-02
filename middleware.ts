import { auth } from "@/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth

  // Public paths that don't require authentication
  const publicPaths = ["/login"]
  const isPublicPath = publicPaths.some((path) => pathname.startsWith(path))

  // Allow access to NextAuth API routes
  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next()
  }

  // Redirect to login if not authenticated and trying to access protected route
  if (!isLoggedIn && !isPublicPath) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Redirect to dashboard if logged in and trying to access login page
  if (isLoggedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/deals", req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
