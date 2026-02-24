// ---------------------------------------------------------------------------
// Project permissioning utilities
// ---------------------------------------------------------------------------

export type ProjectKey = "krj" | "ma-options" | "sheet-portfolio"

export interface ProjectMeta {
  label: string
  path: string
  description: string
}

export const ALL_PROJECTS: Record<ProjectKey, ProjectMeta> = {
  krj: {
    label: "KRJ Dashboard",
    path: "/krj",
    description: "Weekly market signals",
  },
  "ma-options": {
    label: "M&A Options Scanner",
    path: "/ma-options",
    description: "Merger arbitrage options analysis tool",
  },
  "sheet-portfolio": {
    label: "Event Driven Portfolio",
    path: "/sheet-portfolio",
    description: "Event-driven M&A portfolio from production Google Sheet",
  },
}

export const DEFAULT_PROJECT_ACCESS: ProjectKey[] = [
  "krj",
  "ma-options",
  "sheet-portfolio",
]

/**
 * Check whether a user's projectAccess list includes the given project key.
 */
export function hasProjectAccess(
  projectAccess: string[],
  projectKey: string
): boolean {
  return projectAccess.includes(projectKey)
}

/**
 * Map a URL pathname to its project key, or null if the path doesn't belong
 * to a gated project.
 */
export function getProjectKeyFromPath(pathname: string): string | null {
  // /krj or /krj/... -> "krj"
  if (pathname === "/krj" || pathname.startsWith("/krj/")) return "krj"

  // /ma-options or /ma-options/... -> "ma-options"
  // Also gate related sub-projects that are part of the M&A Options product:
  // /deals, /portfolio, /edgar, /intelligence, /staging, /rumored-deals
  if (pathname === "/ma-options" || pathname.startsWith("/ma-options/"))
    return "ma-options"
  if (pathname === "/deals" || pathname.startsWith("/deals/"))
    return "ma-options"
  if (pathname === "/portfolio" || pathname.startsWith("/portfolio/"))
    return "ma-options"
  if (pathname === "/edgar" || pathname.startsWith("/edgar/"))
    return "ma-options"
  if (pathname === "/intelligence" || pathname.startsWith("/intelligence/"))
    return "ma-options"
  if (pathname === "/staging" || pathname.startsWith("/staging/"))
    return "ma-options"
  if (pathname === "/rumored-deals" || pathname.startsWith("/rumored-deals/"))
    return "ma-options"

  // /sheet-portfolio or /sheet-portfolio/... -> "sheet-portfolio"
  if (
    pathname === "/sheet-portfolio" ||
    pathname.startsWith("/sheet-portfolio/")
  )
    return "sheet-portfolio"

  return null
}
