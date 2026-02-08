import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getRelease, getCategoryStyle } from "@/lib/changelog";
import { auth } from "@/auth";
import { UserMenu } from "@/components/UserMenu";
import { ArrowLeft, Newspaper } from "lucide-react";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ date: string }>;
}

export default async function ReleaseDetailPage({ params }: Props) {
  const { date } = await params;
  const session = await auth();
  const release = getRelease(date);

  if (!release) notFound();

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/changelog"
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              All Changes
            </Link>
            <span className="text-gray-700">|</span>
            <div className="flex items-center gap-2">
              <Newspaper className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-300">
                {release.title}
              </span>
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
      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Release title */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            {release.title}
          </h1>
          <p className="text-sm text-gray-500 font-mono">{release.date}</p>
          {release.summary && (
            <p className="text-base text-gray-400 mt-3 max-w-3xl">
              {release.summary}
            </p>
          )}
        </div>

        {/* Features */}
        <div className="space-y-16">
          {release.features.map((feature) => {
            const cat = getCategoryStyle(feature.category);
            const hasImage = feature.image && imageExists(feature.image);

            return (
              <article
                key={feature.id}
                id={feature.id}
                className="scroll-mt-20"
              >
                {/* Feature header */}
                <div className="flex items-start gap-3 mb-4">
                  <span
                    className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded border ${cat.bg} ${cat.text} ${cat.border} mt-1.5`}
                  >
                    {cat.label}
                  </span>
                  <h2 className="text-2xl font-bold text-gray-100">
                    {feature.title}
                  </h2>
                </div>

                {/* Summary */}
                <p className="text-lg text-gray-300 mb-6 max-w-3xl">
                  {feature.summary}
                </p>

                {/* Screenshot */}
                {hasImage && (
                  <div className="mb-6 rounded-xl overflow-hidden border border-gray-800 shadow-2xl shadow-black/40">
                    <Image
                      src={feature.image!}
                      alt={`Screenshot: ${feature.title}`}
                      width={1400}
                      height={900}
                      className="w-full h-auto"
                      priority
                    />
                  </div>
                )}

                {/* Placeholder if no image yet */}
                {!hasImage && feature.image && (
                  <div className="mb-6 rounded-xl border border-dashed border-gray-700 bg-gray-900/40 flex items-center justify-center py-20">
                    <p className="text-sm text-gray-600">
                      Screenshot pending — run the capture tool to generate
                    </p>
                  </div>
                )}

                {/* Description */}
                <div className="max-w-3xl space-y-4">
                  {feature.description.split("\n\n").map((paragraph, i) => (
                    <p
                      key={i}
                      className="text-lg leading-relaxed text-gray-300"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>

                {/* Divider */}
                <div className="border-b border-gray-800/50 mt-12" />
              </article>
            );
          })}
        </div>

        {/* Back link */}
        <div className="mt-12 pt-6">
          <Link
            href="/changelog"
            className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to all changes
          </Link>
        </div>
      </main>
    </div>
  );
}

/** Check if an image file exists in public/ */
function imageExists(imagePath: string): boolean {
  const fullPath = path.join(process.cwd(), "public", imagePath);
  return fs.existsSync(fullPath);
}
