"use client"

import { useState } from "react"
import { signOut, useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { LogOut, Key, User, ChevronDown, Accessibility } from "lucide-react"
import { useUIPreferences } from "@/lib/ui-preferences"

interface UserMenuProps {
  variant?: "light" | "dark"
  // Optional server-side session data for immediate render
  initialUser?: {
    name?: string | null
    email?: string | null
    alias?: string | null
  }
}

export function UserMenu({ variant = "light", initialUser }: UserMenuProps) {
  const { data: session, status } = useSession()
  const [isOpen, setIsOpen] = useState(false)
  const { isComfort, toggleDensity } = useUIPreferences()

  // Use session from client if available, otherwise use initial server data
  const user = session?.user || initialUser
  
  // Show nothing only if we're done loading and there's no user
  if (status === "loading" && !initialUser) {
    // Show a placeholder during loading to prevent layout shift
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded ${variant === "dark" ? "text-slate-400" : "text-gray-400"}`}>
        <User className="h-4 w-4" />
        <span className="hidden sm:inline">...</span>
      </div>
    )
  }
  
  if (!user) {
    return null
  }

  const handleSignOut = () => {
    // Use absolute URL to avoid Docker container hostname issues
    const callbackUrl = typeof window !== "undefined" 
      ? `${window.location.origin}/login`
      : "/login"
    signOut({ callbackUrl })
  }

  const bgColor = variant === "dark" 
    ? "bg-slate-800 border-slate-600" 
    : "bg-white border-gray-200"
  const textColor = variant === "dark" 
    ? "text-white" 
    : "text-gray-900"
  const hoverColor = variant === "dark" 
    ? "hover:bg-slate-700" 
    : "hover:bg-gray-100"
  const mutedColor = variant === "dark" 
    ? "text-slate-400" 
    : "text-gray-500"

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 ${variant === "dark" ? "text-white hover:bg-slate-700" : ""}`}
      >
        <User className="h-4 w-4" />
        <span className="hidden sm:inline">{(user as { alias?: string }).alias || user.name || user.email}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </Button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)} 
          />
          
          {/* Dropdown */}
          <div className={`absolute right-0 mt-2 w-56 rounded-md shadow-lg border z-50 ${bgColor}`}>
            <div className={`px-4 py-3 border-b ${variant === "dark" ? "border-slate-600" : "border-gray-200"}`}>
              <p className={`text-sm font-medium ${textColor}`}>
                {user.name || "User"}
              </p>
              <p className={`text-xs ${mutedColor} truncate`}>
                {user.email}
              </p>
            </div>
            
            <div className="py-1">
              <a
                href="/account/change-password"
                className={`flex items-center gap-2 px-4 py-2 text-sm ${textColor} ${hoverColor}`}
                onClick={() => setIsOpen(false)}
              >
                <Key className="h-4 w-4" />
                Change Password
              </a>

              {/* Comfort Mode toggle */}
              <button
                onClick={toggleDensity}
                className={`flex items-center justify-between px-4 py-2 text-sm w-full text-left ${textColor} ${hoverColor}`}
              >
                <span className="flex items-center gap-2">
                  <Accessibility className="h-4 w-4" />
                  Comfort Mode
                </span>
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                    isComfort ? "bg-emerald-500" : variant === "dark" ? "bg-slate-600" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                      isComfort ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </span>
              </button>

              <div className={`my-1 border-t ${variant === "dark" ? "border-slate-600" : "border-gray-200"}`} />
              
              <button
                onClick={handleSignOut}
                className={`flex items-center gap-2 px-4 py-2 text-sm w-full text-left text-red-500 ${hoverColor}`}
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
