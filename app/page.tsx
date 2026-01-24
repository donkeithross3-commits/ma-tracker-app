import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white">
      <div className="container mx-auto px-4 py-16">
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
                    Weekly market signals and backtesting results
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
                  Development
                </span>
              </div>
            </Link>
          </div>
        </main>

        <footer className="text-center mt-16 text-slate-500 text-sm">
          <p>DR3 Trading Tools</p>
        </footer>
      </div>
    </div>
  );
}
