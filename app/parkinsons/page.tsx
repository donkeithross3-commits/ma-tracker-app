import { readFileSync, existsSync } from "fs";
import { join } from "path";
import ParkinsonsResearch from "@/components/parkinsons/ParkinsonsResearch";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Parkinson's & PSP Research | DR3 Dashboard",
  description:
    "Dual proteinopathy treatment landscape — alpha-synuclein and tau immunotherapy tracking with daily autonomous updates",
};

export default async function ParkinsonsPage() {
  const dataPath = join(
    process.cwd(),
    "data",
    "parkinsons",
    "research-updates.json"
  );

  if (!existsSync(dataPath)) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-2">
            Research Data Not Found
          </h1>
          <p className="text-gray-400">
            The research-updates.json file has not been created yet.
          </p>
        </div>
      </div>
    );
  }

  const raw = readFileSync(dataPath, "utf-8");
  const data = JSON.parse(raw);

  return <ParkinsonsResearch data={data} />;
}
