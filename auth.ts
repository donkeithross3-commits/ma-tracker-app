import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import * as bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"
import { authConfig } from "@/auth.config"
import { DEFAULT_PROJECT_ACCESS } from "@/lib/permissions"

/**
 * Full auth configuration with Prisma for server-side operations.
 * Extends the base config from auth.config.ts
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const email = (credentials.email as string).toLowerCase().trim()
        const password = credentials.password as string

        // Hardcoded email aliases: alternate login emails that resolve to a canonical account
        const EMAIL_ALIASES: Record<string, string> = {
          "kross@ravenfoundation.org": "keith@unrival.network",
        }
        const resolvedEmail = EMAIL_ALIASES[email] ?? email

        // Check if user exists
        let user = await prisma.user.findUnique({
          where: { email: resolvedEmail }
        })

        // If user doesn't exist, check whitelist and auto-provision with default password
        if (!user) {
          const DEFAULT_PASSWORD = "limitless2025"
          
          // Only allow login with default password for new users
          if (password !== DEFAULT_PASSWORD) {
            return null
          }

          // Check if email is whitelisted
          const whitelistEntry = await prisma.emailWhitelist.findUnique({
            where: { email: resolvedEmail }
          })

          if (!whitelistEntry) {
            return null // Email not whitelisted
          }

          // Extract alias from whitelist notes if present (format: "Alias: XYZ")
          let alias: string | null = null
          if (whitelistEntry.notes?.startsWith("Alias: ")) {
            alias = whitelistEntry.notes.substring(7).trim()
          }

          // Auto-provision the user
          const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10)
          user = await prisma.user.create({
            data: {
              email: resolvedEmail,
              password: hashedPassword,
              alias,
              role: "analyst",
              isActive: true,
              mustChangePassword: true, // Force password change on first login
              projectAccess: DEFAULT_PROJECT_ACCESS,
            }
          })
          
          // Create default "Favorites" deal list for new user
          await prisma.userDealList.create({
            data: {
              userId: user.id,
              name: "Favorites",
              isDefault: true,
            }
          })
        }

        if (!user.isActive) {
          return null
        }

        const isPasswordValid = await bcrypt.compare(password, user.password)

        if (!isPasswordValid) {
          return null
        }

        // Update last login timestamp
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() }
        })

        return {
          id: user.id,
          email: user.email,
          name: user.fullName || user.alias || user.email.split("@")[0],
          alias: user.alias || undefined,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
          projectAccess: user.projectAccess,
        }
      }
    })
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id
        token.alias = user.alias
        token.role = user.role
        token.mustChangePassword = user.mustChangePassword
        token.projectAccess = user.projectAccess ?? DEFAULT_PROJECT_ACCESS
      }
      // Allow updating the token when session is updated (after password change)
      if (trigger === "update") {
        // Re-fetch user to get updated mustChangePassword and projectAccess
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { mustChangePassword: true, projectAccess: true }
        })
        if (dbUser) {
          token.mustChangePassword = dbUser.mustChangePassword
          token.projectAccess = dbUser.projectAccess
        }
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
        session.user.alias = token.alias as string | undefined
        session.user.role = token.role as string
        session.user.mustChangePassword = token.mustChangePassword as boolean
        session.user.projectAccess = (token.projectAccess as string[] | undefined) ?? DEFAULT_PROJECT_ACCESS
      }
      return session
    }
  },
})
