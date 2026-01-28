import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import * as bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"

export const { handlers, auth, signIn, signOut } = NextAuth({
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

        const user = await prisma.user.findUnique({
          where: {
            email: credentials.email as string
          }
        })

        if (!user || !user.isActive) {
          return null
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        )

        if (!isPasswordValid) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.fullName || user.username,
          role: user.role,
        }
      }
    })
  ],
  callbacks: {
    async authorized({ auth, request }) {
      // This callback is called by the middleware wrapper
      const { pathname } = request.nextUrl
      const isLoggedIn = !!auth?.user
      
      // Public paths that don't require authentication
      const isLoginPage = pathname === "/login"
      const isAuthAPI = pathname.startsWith("/api/auth")
      
      // Allow public paths
      if (isLoginPage || isAuthAPI) {
        return true
      }
      
      // Require authentication for all other paths
      return isLoggedIn
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
      }
      return session
    }
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
})
