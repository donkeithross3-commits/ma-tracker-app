import type { NextAuthConfig } from "next-auth"
import Credentials from "next-auth/providers/credentials"

/**
 * Base auth config for middleware (Edge runtime compatible)
 * 
 * This config does NOT include Prisma or any Node.js-only dependencies.
 * The actual credential verification is done in auth.ts which extends this.
 */
export const authConfig: NextAuthConfig = {
  providers: [
    // Credentials provider placeholder - actual authorize logic is in auth.ts
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      // This authorize function won't be called from middleware
      // The actual implementation is in auth.ts
      authorize: async () => null,
    })
  ],
  callbacks: {
    async authorized({ auth, request }) {
      const { pathname } = request.nextUrl
      const isLoggedIn = !!auth?.user
      
      // Public paths that don't require authentication
      const isLoginPage = pathname === "/login"
      const isSignupPage = pathname === "/signup"
      const isAuthAPI = pathname.startsWith("/api/auth")
      
      // Allow public paths
      if (isLoginPage || isSignupPage || isAuthAPI) {
        return true
      }
      
      // Require authentication for all other paths
      return isLoggedIn
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
}
