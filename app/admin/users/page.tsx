import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { isAdmin } from "@/lib/admin"
import { ALL_PROJECTS } from "@/lib/permissions"
import { UserMenu } from "@/components/UserMenu"
import { UserAccessTable } from "@/components/admin/UserAccessTable"
import { Shield } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function AdminUsersPage() {
  const session = await auth()

  if (!session?.user?.email || !isAdmin(session.user.email)) {
    redirect("/")
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      alias: true,
      fullName: true,
      role: true,
      isActive: true,
      projectAccess: true,
    },
    orderBy: { createdAt: "asc" },
  })

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-gray-400" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">Manage Users</h1>
              <p className="text-xs text-gray-500">Toggle switches save immediately</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="text-sm text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded hover:bg-gray-800 transition-colors"
            >
              Dashboard
            </Link>
            <UserMenu
              variant="dark"
            />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <UserAccessTable users={users} projects={ALL_PROJECTS} />
      </main>
    </div>
  )
}
