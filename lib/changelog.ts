import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreenshotAnnotation {
  type: "circle" | "arrow" | "badge";
  /** CSS selector — Playwright resolves its bounding box */
  selector?: string;
  /** Manual bounding box [x, y, w, h] */
  bbox?: [number, number, number, number];
  /** Label text drawn near the annotation */
  label?: string;
  /** For badge annotations */
  number?: number;
  /** Arrow start point [x, y] */
  from?: [number, number];
  /** Badge position [x, y] */
  position?: [number, number];
}

export interface ScreenshotConfig {
  /** URL path on the target site (e.g. "/ma-options") */
  path: string;
  /** Ordered actions to perform before capturing */
  actions?: Array<{
    type: "click" | "wait" | "scroll_to" | "wait_for";
    selector?: string;
    ms?: number;
  }>;
  viewport?: { width: number; height: number };
  full_page?: boolean;
  annotations?: ScreenshotAnnotation[];
}

export interface ChangelogFeature {
  id: string;
  title: string;
  /** One-liner shown on the summary page */
  summary: string;
  /** Rich description shown on the detail page (supports markdown-ish) */
  description: string;
  /** Category tag: signals | positions | intel | portfolio | general */
  category: string;
  /** Path to the generated annotated screenshot (e.g. /changelog/2026-02-08/feat.png) */
  image?: string;
  /** Config consumed by the screenshot tool — not needed at render time */
  screenshot?: ScreenshotConfig;
  /** Project this feature belongs to: "krj" | "ma-options" | "sheet-portfolio" | "general" */
  project?: string;
}

export interface Release {
  date: string; // YYYY-MM-DD
  title: string;
  summary?: string;
  features: ChangelogFeature[];
}

// ---------------------------------------------------------------------------
// Category styling
// ---------------------------------------------------------------------------

const CATEGORY_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  signals:   { bg: "bg-blue-500/20",    text: "text-blue-400",    border: "border-blue-500/30",    label: "Signals" },
  positions: { bg: "bg-emerald-500/20",  text: "text-emerald-400", border: "border-emerald-500/30", label: "Positions" },
  intel:     { bg: "bg-purple-500/20",   text: "text-purple-400",  border: "border-purple-500/30",  label: "Intel" },
  portfolio: { bg: "bg-amber-500/20",    text: "text-amber-400",   border: "border-amber-500/30",   label: "Portfolio" },
  options:   { bg: "bg-cyan-500/20",     text: "text-cyan-400",    border: "border-cyan-500/30",    label: "Options" },
  general:   { bg: "bg-gray-500/20",     text: "text-gray-400",    border: "border-gray-500/30",    label: "General" },
};

export function getCategoryStyle(category: string) {
  return CATEGORY_STYLES[category] || CATEGORY_STYLES.general;
}

// ---------------------------------------------------------------------------
// Data access (server-side only — reads from filesystem)
// ---------------------------------------------------------------------------

function getReleaseNotesDir(): string {
  return path.join(process.cwd(), "release-notes");
}

export function getAllReleases(): Release[] {
  const dir = getReleaseNotesDir();
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .map((file) => {
      const content = fs.readFileSync(path.join(dir, file), "utf-8");
      return JSON.parse(content) as Release;
    });
}

export function getRelease(date: string): Release | null {
  const filePath = path.join(getReleaseNotesDir(), `${date}.json`);
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(content) as Release;
}

/** Return just the dates (for generateStaticParams if needed) */
export function getReleaseDates(): string[] {
  const dir = getReleaseNotesDir();
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort()
    .reverse();
}

/**
 * Filter releases so users only see features for projects they have access to.
 * Features with project "general" or no project field are always included.
 * Releases where ALL features are filtered out are excluded entirely.
 */
export function filterReleasesByAccess(releases: Release[], projectAccess: string[]): Release[] {
  return releases
    .map((release) => ({
      ...release,
      features: release.features.filter(
        (f) => !f.project || f.project === "general" || projectAccess.includes(f.project)
      ),
    }))
    .filter((release) => release.features.length > 0);
}
