"use client";

import Link from "next/link";
import { IBConnectionProvider } from "./IBConnectionContext";
import IBConnectionStatus from "./IBConnectionStatus";
import OptionsScannerTabs from "./OptionsScannerTabs";
import { UserMenu } from "@/components/UserMenu";

interface MAOptionsContentProps {
  initialUser?: {
    name?: string | null;
    email?: string | null;
    alias?: string | null;
  };
}

export default function MAOptionsContent({ initialUser }: MAOptionsContentProps) {
  return (
    <IBConnectionProvider>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-gray-100 whitespace-nowrap"
          >
            ← DR3 Dashboard
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-100">
              IB Trading Tools
            </h1>
            <p className="text-sm text-gray-400">
              Manual &amp; algorithmic trading with Interactive Brokers
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <IBConnectionStatus />
          <UserMenu variant="dark" initialUser={initialUser} />
        </div>
      </div>

      <OptionsScannerTabs
        userAlias={initialUser?.alias ?? undefined}
      />
    </IBConnectionProvider>
  );
}
