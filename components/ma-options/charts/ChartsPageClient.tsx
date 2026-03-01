"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { UserMenu } from "@/components/UserMenu";

// lightweight-charts requires `window` — SSR-safe dynamic import
const ChartsTab = dynamic(() => import("./ChartsTab"), { ssr: false });

interface ChartsPageClientProps {
  initialUser?: {
    name?: string | null;
    email?: string | null;
  };
}

export default function ChartsPageClient({ initialUser }: ChartsPageClientProps) {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Compact header row */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-gray-100 whitespace-nowrap"
          >
            &larr; DR3
          </Link>
          <h1 className="text-lg font-semibold text-gray-100">Charts</h1>
        </div>
        <UserMenu variant="dark" initialUser={initialUser} />
      </div>

      {/* Chart grid fills remaining viewport */}
      <div className="flex-1 px-3 py-2">
        <ChartsTab />
      </div>
    </div>
  );
}
