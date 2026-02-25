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
      
      // Health check endpoint (used by Docker health checks, must not require auth)
      const isHealthCheck = pathname === "/api/health"

      // Internal API endpoints (called by Python service or agent, not browser)
      const isInternalAPI = pathname === "/api/ma-options/validate-agent-key" ||
                            pathname === "/api/ma-options/agent-version" ||
                            pathname === "/api/ma-options/download-agent-update"
      // Admin seed (protected by query secret, not session)
      const isAdminEndpoint = pathname === "/api/admin/seed-whitelist"
      
      // Allow public paths
      if (isLoginPage || isAuthAPI || isHealthCheck || isInternalAPI || isAdminEndpoint) {
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

      // --- Admin route gate ---
      const isAdminPage = pathname.startsWith("/admin/")
      const isAdminAPI = pathname.startsWith("/api/admin/") && !isAdminEndpoint
      if (isAdminPage || isAdminAPI) {
        if (auth?.user?.email !== "don.keith.ross3@gmail.com") {
          return Response.redirect(new URL("/", request.url))
        }
      }

      // --- Project-level access check ---
      // Inline path-to-project mapping (cannot import lib/permissions.ts in Edge runtime)
      let projectKey: string | null = null
      if (pathname === "/krj" || pathname.startsWith("/krj/")) {
        projectKey = "krj"
      } else if (
        pathname === "/ma-options" || pathname.startsWith("/ma-options/") ||
        pathname === "/deals" || pathname.startsWith("/deals/") ||
        pathname === "/portfolio" || pathname.startsWith("/portfolio/") ||
        pathname === "/edgar" || pathname.startsWith("/edgar/") ||
        pathname === "/intelligence" || pathname.startsWith("/intelligence/") ||
        pathname === "/staging" || pathname.startsWith("/staging/") ||
        pathname === "/rumored-deals" || pathname.startsWith("/rumored-deals/")
      ) {
        projectKey = "ma-options"
      } else if (pathname === "/sheet-portfolio" || pathname.startsWith("/sheet-portfolio/")) {
        projectKey = "sheet-portfolio"
      }

      if (projectKey) {
        // Default to all projects for backward compatibility (existing users without projectAccess)
        const projectAccess: string[] =
          auth?.user?.projectAccess ?? ["krj", "ma-options", "sheet-portfolio"]
        if (!projectAccess.includes(projectKey)) {
          return Response.redirect(new URL("/", request.url))
        }
      }

      return true
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
}
