/**
 * Seed script to populate the email whitelist with authorized users.
 * Run with: npx ts-node prisma/seed-whitelist.ts
 * Or: npx tsx prisma/seed-whitelist.ts
 */

import { PrismaClient } from "@prisma/client";
import { WHITELIST_ENTRIES } from "../lib/whitelist-entries";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding email whitelist...\n");

  for (const entry of WHITELIST_ENTRIES) {
    const existing = await prisma.emailWhitelist.findUnique({
      where: { email: entry.email },
    });

    if (existing) {
      // Update notes if alias changed
      const expectedNotes = `Alias: ${entry.alias}`;
      if (existing.notes !== expectedNotes) {
        await prisma.emailWhitelist.update({
          where: { email: entry.email },
          data: { notes: expectedNotes },
        });
        console.log(`  ✓ Updated ${entry.email} → ${entry.alias}`);
      } else {
        console.log(`  ⚠ Already exists: ${entry.email} (${entry.alias})`);
      }
    } else {
      await prisma.emailWhitelist.create({
        data: {
          email: entry.email,
          notes: `Alias: ${entry.alias}`,
          addedBy: "system",
        },
      });
      console.log(`  ✓ Added ${entry.email} → ${entry.alias}`);
    }
  }

  console.log("\n✅ Whitelist seed completed!");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
