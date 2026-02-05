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
      const isAuthAPI = pathname.startsWith("/api/auth")
      const isChangePasswordPage = pathname === "/account/change-password"
      const isChangePasswordAPI = pathname === "/api/user/change-password"
      
      // Internal API endpoints (called by Python service or agent, not browser)
      const isInternalAPI = pathname === "/api/ma-options/validate-agent-key" ||
                            pathname === "/api/ma-options/agent-version" ||
                            pathname === "/api/ma-options/download-agent-update"
      // Admin seed (protected by query secret, not session)
      const isAdminEndpoint = pathname === "/api/admin/seed-whitelist"
      
      // Allow public paths
      if (isLoginPage || isAuthAPI || isInternalAPI || isAdminEndpoint) {
        return true
      }
      
      // Require authentication for all other paths
      if (!isLoggedIn) {
        return false
      }
      
      // If user must change password, only allow password change page/API
      if (auth?.user?.mustChangePassword && !isChangePasswordPage && !isChangePasswordAPI) {
        return Response.redirect(new URL("/account/change-password?required=true", request.url))
      }
      
      return true
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
}
