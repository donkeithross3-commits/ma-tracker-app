import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { WHITELIST_ENTRIES } from "@/lib/whitelist-entries";

function checkSecret(request: Request): boolean {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  const expected = process.env.SEED_WHITELIST_SECRET;
  return !!expected && secret === expected;
}

/**
 * GET or POST /api/admin/seed-whitelist?secret=YOUR_SEED_WHITELIST_SECRET
 * Syncs the email whitelist from code to the database (same as prisma/seed-whitelist.ts).
 * Call once after deploy to add new whitelisted users (e.g. DRC) to production.
 */
async function runSeed() {
  try {
    const results: string[] = [];

    for (const entry of WHITELIST_ENTRIES) {
      const existing = await prisma.emailWhitelist.findUnique({
        where: { email: entry.email },
      });

      const expectedNotes = `Alias: ${entry.alias}`;

      if (existing) {
        if (existing.notes !== expectedNotes) {
          await prisma.emailWhitelist.update({
            where: { email: entry.email },
            data: { notes: expectedNotes },
          });
          results.push(`Updated ${entry.email} → ${entry.alias}`);
        } else {
          results.push(`Already exists: ${entry.email} (${entry.alias})`);
        }
      } else {
        await prisma.emailWhitelist.create({
          data: {
            email: entry.email,
            notes: expectedNotes,
            addedBy: "system",
          },
        });
        results.push(`Added ${entry.email} → ${entry.alias}`);
      }
    }

    return NextResponse.json({
      ok: true,
      message: "Whitelist seed completed",
      results,
    });
  } catch (e) {
    console.error("Seed whitelist error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Seed failed" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSeed();
}

export async function POST(request: Request) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSeed();
}
