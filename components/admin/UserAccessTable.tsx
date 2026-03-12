"use client"

import { useState, useCallback } from "react"
import { UserPlus } from "lucide-react"
import type { ProjectKey, ProjectMeta } from "@/lib/permissions"

interface UserRow {
  id: string
  email: string
  alias: string | null
  fullName: string | null
  role: string
  isActive: boolean
  projectAccess: string[]
}

interface UserAccessTableProps {
  users: UserRow[]
  projects: Record<ProjectKey, ProjectMeta>
}

export function UserAccessTable({ users: initialUsers, projects }: UserAccessTableProps) {
  const [users, setUsers] = useState(initialUsers)
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Add user form state
  const [showAddForm, setShowAddForm] = useState(false)
  const [newEmail, setNewEmail] = useState("")
  const [newAlias, setNewAlias] = useState("")
  const [addError, setAddError] = useState("")
  const [addSaving, setAddSaving] = useState(false)

  const projectKeys = Object.keys(projects) as ProjectKey[]

  const toggleAccess = useCallback(
    async (userId: string, projectKey: ProjectKey, currentlyEnabled: boolean) => {
      const savingKey = `${userId}-${projectKey}`
      if (saving[savingKey]) return

      // Optimistic update
      setUsers((prev) =>
        prev.map((u) => {
          if (u.id !== userId) return u
          const newAccess = currentlyEnabled
            ? u.projectAccess.filter((k) => k !== projectKey)
            : [...u.projectAccess, projectKey]
          return { ...u, projectAccess: newAccess }
        })
      )
      setErrors((prev) => ({ ...prev, [userId]: "" }))
      setSaving((prev) => ({ ...prev, [savingKey]: true }))

      const user = users.find((u) => u.id === userId)!
      const newAccess = currentlyEnabled
        ? user.projectAccess.filter((k) => k !== projectKey)
        : [...user.projectAccess, projectKey]

      try {
        const res = await fetch(`/api/admin/users/${userId}/access`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectAccess: newAccess }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Request failed" }))
          throw new Error(data.error || "Request failed")
        }

        const updated = await res.json()
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, projectAccess: updated.projectAccess } : u))
        )
      } catch (err) {
        // Revert optimistic update
        setUsers((prev) =>
          prev.map((u) => {
            if (u.id !== userId) return u
            const revertedAccess = currentlyEnabled
              ? [...u.projectAccess, projectKey]
              : u.projectAccess.filter((k) => k !== projectKey)
            return { ...u, projectAccess: revertedAccess }
          })
        )
        setErrors((prev) => ({
          ...prev,
          [userId]: err instanceof Error ? err.message : "Failed to save",
        }))
      } finally {
        setSaving((prev) => ({ ...prev, [savingKey]: false }))
      }
    },
    [users, saving]
  )

  const handleAddUser = useCallback(async () => {
    const email = newEmail.trim().toLowerCase()
    if (!email) {
      setAddError("Email is required")
      return
    }

    setAddSaving(true)
    setAddError("")

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          alias: newAlias.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }))
        throw new Error(data.error || "Request failed")
      }

      const newUser = await res.json()
      setUsers((prev) => [...prev, newUser])
      setNewEmail("")
      setNewAlias("")
      setShowAddForm(false)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to create user")
    } finally {
      setAddSaving(false)
    }
  }, [newEmail, newAlias])

  return (
    <div>
      {/* Add User Section */}
      <div className="mb-4">
        {!showAddForm ? (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-md transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Add User
          </button>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex items-end gap-3">
              <div className="flex-1 max-w-xs">
                <label className="block text-xs text-gray-400 mb-1">Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddUser()}
                  placeholder="user@example.com"
                  autoFocus
                  className="w-full px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="w-32">
                <label className="block text-xs text-gray-400 mb-1">Alias</label>
                <input
                  type="text"
                  value={newAlias}
                  onChange={(e) => setNewAlias(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddUser()}
                  placeholder="DR3"
                  className="w-full px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <button
                onClick={handleAddUser}
                disabled={addSaving}
                className="px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded transition-colors"
              >
                {addSaving ? "Creating…" : "Create"}
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false)
                  setNewEmail("")
                  setNewAlias("")
                  setAddError("")
                }}
                className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
            {addError && (
              <p className="text-xs text-red-400 mt-2">{addError}</p>
            )}
            <p className="text-xs text-gray-500 mt-2">
              User will log in with the default password and be prompted to change it.
              All project access is granted by default.
            </p>
          </div>
        )}
      </div>

      {/* Users Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left">
              <th className="px-4 py-3 text-gray-400 font-medium">User</th>
              <th className="px-4 py-3 text-gray-400 font-medium">Email</th>
              <th className="px-4 py-3 text-gray-400 font-medium">Role</th>
              {projectKeys.map((key) => (
                <th key={key} className="px-4 py-3 text-gray-400 font-medium text-center">
                  {projects[key].label}
                </th>
              ))}
              <th className="px-4 py-3 text-gray-400 font-medium text-center">Active</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              return (
                <tr key={user.id} className="border-b border-gray-800/50 hover:bg-gray-900/40">
                  <td className="px-4 py-3 text-gray-200 font-medium">
                    <div>{user.alias || user.fullName || "—"}</div>
                    {errors[user.id] && (
                      <p className="text-xs text-red-400 mt-1">{errors[user.id]}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">
                    {user.email}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{user.role}</td>
                  {projectKeys.map((key) => {
                    const enabled = user.projectAccess.includes(key)
                    const savingKey = `${user.id}-${key}`
                    const isSaving = saving[savingKey]
                    return (
                      <td key={key} className="px-4 py-3 text-center">
                        <button
                          onClick={() => toggleAccess(user.id, key, enabled)}
                          disabled={isSaving}
                          role="switch"
                          aria-checked={enabled}
                          aria-label={`${projects[key].label} access for ${user.alias || user.email}`}
                          className="inline-flex items-center disabled:opacity-50"
                        >
                          <span
                            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                              enabled ? "bg-emerald-500" : "bg-gray-600"
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                                enabled ? "translate-x-4" : "translate-x-0"
                              }`}
                            />
                          </span>
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        user.isActive ? "bg-emerald-500" : "bg-gray-600"
                      }`}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
