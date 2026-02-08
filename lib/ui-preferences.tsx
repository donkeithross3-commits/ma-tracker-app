"use client"

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from "react"
import { useSession } from "next-auth/react"

// ── Types ──────────────────────────────────────────────────────

export interface UIPrefs {
  densityMode?: "compact" | "comfort" | null
  columnVisibility?: {
    krj?: string[]
    [key: string]: string[] | undefined
  }
}

/** Full preferences shape returned by /api/user/preferences */
export interface AllPreferences {
  maOptionsPrefs: Record<string, unknown>
  dealListPrefs: Record<string, unknown>
  uiPrefs: UIPrefs
  customTickers: string[]
}

interface UIPreferencesContextValue {
  /** All user preferences (full object, avoids per-component fetches) */
  prefs: AllPreferences
  /** Whether preferences have been loaded from the server */
  loaded: boolean

  // ── UI prefs helpers ──
  isComfort: boolean
  toggleDensity: () => void

  /** Get visible column keys for a page. Returns null if no override (use defaults). */
  getVisibleColumns: (pageKey: string) => string[] | null
  /** Set visible column keys for a page. Pass null to reset to defaults. */
  setVisibleColumns: (pageKey: string, columns: string[] | null) => void

  // ── Generic pref update (for maOptionsPrefs, etc.) ──
  /** Deep-merge a partial update into the full preferences and persist. */
  updatePrefs: (partial: Partial<AllPreferences>) => void
}

const defaultPrefs: AllPreferences = {
  maOptionsPrefs: {},
  dealListPrefs: {},
  uiPrefs: {},
  customTickers: [],
}

const UIPreferencesContext = createContext<UIPreferencesContextValue>({
  prefs: defaultPrefs,
  loaded: false,
  isComfort: false,
  toggleDensity: () => {},
  getVisibleColumns: () => null,
  setVisibleColumns: () => {},
  updatePrefs: () => {},
})

// ── Provider ───────────────────────────────────────────────────

const DEBOUNCE_MS = 600

export function UIPreferencesProvider({ children }: { children: ReactNode }) {
  const { status } = useSession()
  const [prefs, setPrefs] = useState<AllPreferences>(defaultPrefs)
  const [loaded, setLoaded] = useState(false)

  // Refs for debounced save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestPrefsRef = useRef<AllPreferences>(defaultPrefs)
  const isSavingRef = useRef(false)

  // Keep ref in sync
  latestPrefsRef.current = prefs

  // ── Apply density attribute immediately (no FOUC) ──
  useEffect(() => {
    const mode = prefs.uiPrefs?.densityMode
    if (mode) {
      document.documentElement.setAttribute("data-density", mode)
    } else {
      document.documentElement.removeAttribute("data-density")
    }
  }, [prefs.uiPrefs?.densityMode])

  // ── Fetch preferences on auth ──
  useEffect(() => {
    if (status !== "authenticated") return
    let cancelled = false

    fetch("/api/user/preferences", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setPrefs({
          maOptionsPrefs: data.maOptionsPrefs || {},
          dealListPrefs: data.dealListPrefs || {},
          uiPrefs: data.uiPrefs || {},
          customTickers: data.customTickers || [],
        })
        setLoaded(true)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [status])

  // ── Debounced save ──
  const persistPrefs = useCallback((nextPrefs: AllPreferences) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)

    saveTimerRef.current = setTimeout(() => {
      if (isSavingRef.current) return
      isSavingRef.current = true

      fetch("/api/user/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(nextPrefs),
      })
        .catch(() => {})
        .finally(() => {
          isSavingRef.current = false
        })
    }, DEBOUNCE_MS)
  }, [])

  // ── Flush on unmount / page navigation ──
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        // Fire final save synchronously via sendBeacon if available
        if (typeof navigator?.sendBeacon === "function") {
          const blob = new Blob(
            [JSON.stringify(latestPrefsRef.current)],
            { type: "application/json" }
          )
          navigator.sendBeacon("/api/user/preferences", blob)
        }
      }
    }
  }, [])

  // ── updatePrefs: merge partial into full prefs, persist ──
  const updatePrefs = useCallback(
    (partial: Partial<AllPreferences>) => {
      setPrefs((prev) => {
        const next: AllPreferences = {
          maOptionsPrefs:
            partial.maOptionsPrefs !== undefined
              ? { ...prev.maOptionsPrefs, ...partial.maOptionsPrefs }
              : prev.maOptionsPrefs,
          dealListPrefs:
            partial.dealListPrefs !== undefined
              ? { ...prev.dealListPrefs, ...partial.dealListPrefs }
              : prev.dealListPrefs,
          uiPrefs:
            partial.uiPrefs !== undefined
              ? { ...prev.uiPrefs, ...partial.uiPrefs }
              : prev.uiPrefs,
          customTickers:
            partial.customTickers !== undefined
              ? partial.customTickers
              : prev.customTickers,
        }
        persistPrefs(next)
        return next
      })
    },
    [persistPrefs]
  )

  // ── Density helpers ──
  const isComfort = prefs.uiPrefs?.densityMode === "comfort"

  const toggleDensity = useCallback(() => {
    updatePrefs({
      uiPrefs: {
        densityMode: isComfort ? null : "comfort",
      },
    })
  }, [updatePrefs, isComfort])

  // ── Column visibility helpers ──
  const getVisibleColumns = useCallback(
    (pageKey: string): string[] | null => {
      return prefs.uiPrefs?.columnVisibility?.[pageKey] ?? null
    },
    [prefs.uiPrefs?.columnVisibility]
  )

  const setVisibleColumns = useCallback(
    (pageKey: string, columns: string[] | null) => {
      const currentVis = prefs.uiPrefs?.columnVisibility || {}
      const nextVis = { ...currentVis }
      if (columns === null) {
        delete nextVis[pageKey]
      } else {
        nextVis[pageKey] = columns
      }
      updatePrefs({
        uiPrefs: { columnVisibility: nextVis },
      })
    },
    [prefs.uiPrefs?.columnVisibility, updatePrefs]
  )

  // ── Memoized context value (prevent consumer re-renders) ──
  const value = useMemo<UIPreferencesContextValue>(
    () => ({
      prefs,
      loaded,
      isComfort,
      toggleDensity,
      getVisibleColumns,
      setVisibleColumns,
      updatePrefs,
    }),
    [prefs, loaded, isComfort, toggleDensity, getVisibleColumns, setVisibleColumns, updatePrefs]
  )

  return (
    <UIPreferencesContext.Provider value={value}>
      {children}
    </UIPreferencesContext.Provider>
  )
}

// ── Hook ───────────────────────────────────────────────────────

export function useUIPreferences() {
  return useContext(UIPreferencesContext)
}
