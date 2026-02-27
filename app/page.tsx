import Link from "next/link";
import { auth } from "@/auth";
import { UserMenu } from "@/components/UserMenu";
import { hasProjectAccess, DEFAULT_PROJECT_ACCESS } from "@/lib/permissions";
import { BookOpen } from "lucide-react";

export default async function Home() {
  const session = await auth();
  const projectAccess: string[] =
    (session?.user as Record<string, unknown> | undefined)?.projectAccess as string[] ??
    DEFAULT_PROJECT_ACCESS;

  const projects = [
    {
      key: "krj",
      href: "/krj",
      title: "KRJ Dashboard",
      description: "Weekly market signals",
      badge: "Production",
      badgeClasses: "bg-green-500/20 text-green-400",
      hoverBorder: "hover:border-blue-500",
    },
    {
      key: "ma-options",
      href: "/ma-options",
      title: "IB Trading Tools",
      description: "Manual & algorithmic trading with Interactive Brokers",
      badge: "Beta Testing",
      badgeClasses: "bg-yellow-500/20 text-yellow-400",
      hoverBorder: "hover:border-yellow-500",
    },
    {
      key: "sheet-portfolio",
      href: "/sheet-portfolio",
      title: "Event Driven Portfolio",
      description: "Event-driven M&A portfolio from production Google Sheet",
      badge: "Beta Testing",
      badgeClasses: "bg-purple-500/20 text-purple-400",
      hoverBorder: "hover:border-purple-500",
    },
  ] as const;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white">
      <div className="container mx-auto px-4 py-16">
        {/* User Menu in top right */}
        <div className="absolute top-4 right-4">
          <UserMenu
            variant="dark"
            initialUser={session?.user ? { name: session.user.name, email: session.user.email } : undefined}
          />
        </div>

        <header className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4">DR3 Dashboard</h1>
          <p className="text-xl text-slate-300">Trading Analytics &amp; Tools</p>
        </header>

        <main className="max-w-2xl mx-auto">
          <div className="grid gap-6">
            {projects.map((project) => {
              const accessible = hasProjectAccess(projectAccess, project.key);

              const content = (
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold mb-2">{project.title}</h2>
                    <p className={accessible ? "text-slate-400" : "text-slate-500"}>
                      {project.description}
                    </p>
                    {!accessible && (
                      <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                        </svg>
                        Access Required
                      </p>
                    )}
                  </div>
                  <span className={`text-xs ${project.badgeClasses} px-3 py-1 rounded-full`}>
                    {project.badge}
                  </span>
                </div>
              );

              if (accessible) {
                return (
                  <Link
                    key={project.key}
                    href={project.href}
                    className={`block p-8 bg-slate-800 border border-slate-700 rounded-xl ${project.hoverBorder} hover:bg-slate-700 transition-all`}
                  >
                    {content}
                  </Link>
                );
              }

              return (
                <div
                  key={project.key}
                  className="block p-8 bg-slate-800 border border-slate-700 rounded-xl opacity-50 cursor-not-allowed"
                >
                  {content}
                </div>
              );
            })}
          </div>
        </main>

        <div className="max-w-2xl mx-auto mt-6 space-y-3">
          <Link
            href="/changelog"
            className="block px-6 py-4 bg-slate-800/60 border border-slate-700/50 rounded-xl hover:border-slate-500 hover:bg-slate-700/60 transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-slate-400 text-lg">📋</span>
                <div>
                  <h3 className="text-base font-medium text-slate-300">What&apos;s Changed</h3>
                  <p className="text-sm text-slate-500">Release notes &amp; feature updates</p>
                </div>
              </div>
              <span className="text-xs text-slate-500">→</span>
            </div>
          </Link>
          <Link
            href="/user-guide"
            className="block px-6 py-4 bg-slate-800/60 border border-slate-700/50 rounded-xl hover:border-slate-500 hover:bg-slate-700/60 transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <BookOpen className="w-5 h-5 text-slate-400" />
                <div>
                  <h3 className="text-base font-medium text-slate-300">Prediction System Guide</h3>
                  <p className="text-sm text-slate-500">How the AI assessment loop works</p>
                </div>
              </div>
              <span className="text-xs text-slate-500">→</span>
            </div>
          </Link>
        </div>

        <footer className="text-center mt-12 text-slate-500 text-sm">
          <p>DR3 Trading Tools</p>
        </footer>
      </div>
    </div>
  );
}
