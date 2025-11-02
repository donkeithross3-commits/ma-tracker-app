import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">M&A Deal Tracker</h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl">
          <h2 className="text-3xl font-bold mb-4">Welcome to M&A Deal Tracker</h2>
          <p className="text-muted-foreground mb-8">
            Version-controlled merger arbitrage deal tracking with persistent history.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <Link
              href="/deals"
              className="block p-6 bg-card border rounded-lg hover:shadow-lg transition-shadow"
            >
              <h3 className="text-xl font-semibold mb-2">M&A Dashboard</h3>
              <p className="text-sm text-muted-foreground">
                View all active deals with current spreads and risk assessments
              </p>
            </Link>

            <Link
              href="/portfolio"
              className="block p-6 bg-card border rounded-lg hover:shadow-lg transition-shadow"
            >
              <h3 className="text-xl font-semibold mb-2">Portfolio</h3>
              <p className="text-sm text-muted-foreground">
                Track your current positions and performance
              </p>
            </Link>

            <Link
              href="/deals/new"
              className="block p-6 bg-card border rounded-lg hover:shadow-lg transition-shadow"
            >
              <h3 className="text-xl font-semibold mb-2">Add New Deal</h3>
              <p className="text-sm text-muted-foreground">
                Create a new deal announcement
              </p>
            </Link>

            <Link
              href="/admin/prices"
              className="block p-6 bg-card border rounded-lg hover:shadow-lg transition-shadow"
            >
              <h3 className="text-xl font-semibold mb-2">Price Updates</h3>
              <p className="text-sm text-muted-foreground">
                Fetch latest prices from Interactive Brokers
              </p>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
