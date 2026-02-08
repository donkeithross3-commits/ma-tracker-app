import Link from "next/link";
import { auth } from "@/auth";
import { UserMenu } from "@/components/UserMenu";

export default async function Home() {
  const session = await auth();
  
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
            <Link
              href="/krj"
              className="block p-8 bg-slate-800 border border-slate-700 rounded-xl hover:border-blue-500 hover:bg-slate-700 transition-all"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-semibold mb-2">KRJ Dashboard</h2>
                  <p className="text-slate-400">
                    Weekly market signals
                  </p>
                </div>
                <span className="text-xs bg-green-500/20 text-green-400 px-3 py-1 rounded-full">
                  Production
                </span>
              </div>
            </Link>

            <Link
              href="/ma-options"
              className="block p-8 bg-slate-800 border border-slate-700 rounded-xl hover:border-yellow-500 hover:bg-slate-700 transition-all"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-semibold mb-2">M&amp;A Options Scanner</h2>
                  <p className="text-slate-400">
                    Merger arbitrage options analysis tool
                  </p>
                </div>
                <span className="text-xs bg-yellow-500/20 text-yellow-400 px-3 py-1 rounded-full">
                  Beta Testing
                </span>
              </div>
            </Link>
          </div>
        </main>

        <div className="max-w-2xl mx-auto mt-6">
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
        </div>

        <footer className="text-center mt-12 text-slate-500 text-sm">
          <p>DR3 Trading Tools</p>
        </footer>
      </div>
    </div>
  );
}
