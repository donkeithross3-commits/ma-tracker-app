import NextAuth, { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      alias?: string
      role: string
      mustChangePassword?: boolean
      projectAccess: string[]
    } & DefaultSession["user"]
  }

  interface User {
    alias?: string
    role?: string
    mustChangePassword?: boolean
    projectAccess?: string[]
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    alias?: string
    role: string
    mustChangePassword?: boolean
    projectAccess: string[]
  }
}
