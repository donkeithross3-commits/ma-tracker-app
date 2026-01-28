import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import * as bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"
import { authConfig } from "@/auth.config"

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

        // Check if user exists
        let user = await prisma.user.findUnique({
          where: { email }
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
            where: { email }
          })

          if (!whitelistEntry) {
            return null // Email not whitelisted
          }

          // Auto-provision the user
          const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10)
          user = await prisma.user.create({
            data: {
              email,
              password: hashedPassword,
              role: "analyst",
              isActive: true,
              mustChangePassword: true, // Force password change on first login
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
          name: user.fullName || user.email.split("@")[0],
          role: user.role,
          mustChangePassword: user.mustChangePassword,
        }
      }
    })
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id
        token.role = user.role
        token.mustChangePassword = user.mustChangePassword
      }
      // Allow updating the token when session is updated (after password change)
      if (trigger === "update") {
        // Re-fetch user to get updated mustChangePassword status
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { mustChangePassword: true }
        })
        if (dbUser) {
          token.mustChangePassword = dbUser.mustChangePassword
        }
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
        session.user.mustChangePassword = token.mustChangePassword as boolean
      }
      return session
    }
  },
})
