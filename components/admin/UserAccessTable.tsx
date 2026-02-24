"use client"

import { useState, useCallback } from "react"
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

  return (
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
  )
}
