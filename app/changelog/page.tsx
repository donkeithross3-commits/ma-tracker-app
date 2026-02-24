import Link from "next/link";
import { getAllReleases, getCategoryStyle, filterReleasesByAccess } from "@/lib/changelog";
import { auth } from "@/auth";
import { DEFAULT_PROJECT_ACCESS } from "@/lib/permissions";
import { UserMenu } from "@/components/UserMenu";
import { Newspaper, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ChangelogPage() {
  const session = await auth();
  const allReleases = getAllReleases();
  const releases = filterReleasesByAccess(allReleases, session?.user?.projectAccess ?? DEFAULT_PROJECT_ACCESS);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Newspaper className="w-5 h-5 text-gray-400" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">What&apos;s Changed</h1>
              <p className="text-xs text-gray-500">Release notes &amp; feature updates</p>
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
              userName={session?.user?.name || "User"}
              variant="dark"
            />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {releases.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <Newspaper className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-lg">No release notes yet.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {releases.map((release) => (
              <section key={release.date}>
                {/* Release header */}
                <div className="flex items-baseline gap-3 mb-3">
                  <h2 className="text-lg font-semibold text-gray-200">
                    {release.title}
                  </h2>
                  <span className="text-xs text-gray-600 font-mono">
                    {release.date}
                  </span>
                </div>

                {release.summary && (
                  <p className="text-sm text-gray-400 mb-4 max-w-2xl">
                    {release.summary}
                  </p>
                )}

                {/* Feature list */}
                <div className="space-y-1">
                  {release.features.map((feature) => {
                    const cat = getCategoryStyle(feature.category);
                    return (
                      <Link
                        key={feature.id}
                        href={`/changelog/${release.date}#${feature.id}`}
                        className="group flex items-center gap-3 px-3 py-2.5 -mx-3 rounded-lg hover:bg-gray-900/60 transition-colors"
                      >
                        {/* Category badge */}
                        <span
                          className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded border ${cat.bg} ${cat.text} ${cat.border} min-w-[72px] text-center`}
                        >
                          {cat.label}
                        </span>

                        {/* Feature info */}
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors">
                            {feature.title}
                          </span>
                          <span className="text-sm text-gray-500 ml-2">
                            — {feature.summary}
                          </span>
                        </div>

                        {/* Chevron */}
                        <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors flex-shrink-0" />
                      </Link>
                    );
                  })}
                </div>

                {/* Divider (except last) */}
                <div className="border-b border-gray-800/50 mt-6" />
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
