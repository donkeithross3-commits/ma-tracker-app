import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Parse date string as local date (no timezone conversion)
function parseLocalDate(dateStr: string | null | undefined): Date | undefined {
  if (!dateStr) return undefined
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day) // month is 0-indexed
}

// Map spreadsheet categories to database enum values
function mapCategory(category: string | null): string {
  if (!category) return 'all_cash'
  const lower = category.toLowerCase()
  if (lower.includes('all-cash') || lower.includes('allcash') || lower === 'all cash') return 'all_cash'
  if (lower.includes('cash') && lower.includes('stock')) return 'cash_stock'
  if (lower.includes('cash') && lower.includes('cvr')) return 'cash_cvr'
  if (lower.includes('non-binding')) return 'non_binding_offer'
  if (lower.includes('stock')) return 'cash_stock'
  return 'all_cash'
}

// Determine if deal is investable based on notes
function isInvestable(investable: string | null): boolean {
  if (!investable) return false
  const lower = investable.toLowerCase()
  return lower.startsWith('yes')
}

async function main() {
  console.log('🌱 Seeding database with exact data from spreadsheet...')

  // Clear existing data
  console.log('🧹 Clearing existing data...')
  await prisma.dealSnapshot.deleteMany({})
  await prisma.portfolioPosition.deleteMany({})
  await prisma.cvr.deleteMany({})
  await prisma.dealPrice.deleteMany({})
  await prisma.dealVersion.deleteMany({})
  await prisma.deal.deleteMany({})
  await prisma.user.deleteMany({})

  // Create user
  const user = await prisma.user.create({
    data: {
      username: 'power_user',
      email: 'poweruser@firm.com',
      fullName: 'Power User',
      role: 'admin',
    },
  })

  console.log('✓ Created user:', user.username)

  // Deals extracted exactly from PNG images in exact order
  const deals = [
    {"ticker": "REVG", "acquiror": "TEX", "announced": "2025-10-30", "close_date": "2026-06-30", "outside_date": null, "countdown": 0, "deal_px": 53.97, "current_px": 51.27, "category": "Cash & Stock", "investable": "No, too much stock", "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "IROQ", "acquiror": "ServBanc Holdco", "announced": "2025-10-30", "close_date": "2026-02-27", "outside_date": null, "countdown": 0, "deal_px": 27.20, "current_px": 25.72, "category": "All-cash", "investable": "No, too illiquid, anti trust risk", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "CSGS", "acquiror": "NEC Corp", "announced": "2025-10-29", "close_date": "2026-06-30", "outside_date": "2026-10-29", "countdown": 362, "deal_px": 81.34, "current_px": 78.27, "category": "All-cash", "investable": "Yes", "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "JAMF", "acquiror": "Francisco Partners", "announced": "2025-10-29", "close_date": "2026-02-26", "outside_date": "2026-07-28", "countdown": 269, "deal_px": 13.05, "current_px": 12.85, "category": "All-cash", "investable": "Yes", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "MKTW", "acquiror": null, "announced": "2025-10-29", "close_date": "2026-07-26", "outside_date": null, "countdown": 0, "deal_px": 17.25, "current_px": 16.98, "category": "Non-binding offer", "investable": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "QRVO", "acquiror": "SWKS", "announced": "2025-10-28", "close_date": "2027-03-31", "outside_date": "2027-04-27", "countdown": 542, "deal_px": 107.11, "current_px": 94.92, "category": "Cash & Stock", "investable": "No, too much stock, anti-trust risk", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "high", "has_cvr": false},
    {"ticker": "RNW", "acquiror": "Management", "announced": "2025-10-28", "close_date": "2026-07-25", "outside_date": null, "countdown": 0, "deal_px": 8.15, "current_px": 7.54, "category": "Non-binding offer", "investable": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "RNA", "acquiror": "NVS", "announced": "2025-10-27", "close_date": "2026-06-30", "outside_date": "2026-01-25", "countdown": 85, "deal_px": 74.10, "current_px": 69.85, "category": "Cash + Spin-off", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "medium", "has_cvr": true},
    {"ticker": "SOHO", "acquiror": "Wilson Hospitality", "announced": "2025-10-27", "close_date": "2026-03-31", "outside_date": "2026-04-22", "countdown": 172, "deal_px": 2.24, "current_px": 2.12, "category": "All-cash", "investable": "No, too illiquid and high risk stock is a zero if deal fails", "deal_notes": "Parent has extended a bridge loan upon signing to Company", "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "PLYM", "acquiror": "Ares", "announced": "2025-10-24", "close_date": "2026-02-21", "outside_date": "2026-07-24", "countdown": 265, "deal_px": 22.24, "current_px": 22.00, "category": "All-cash", "investable": "Yes", "deal_notes": "30 day go shop ending 11/23/25", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "ADVM", "acquiror": "LLY", "announced": "2025-10-24", "close_date": "2025-12-08", "outside_date": "2026-01-22", "countdown": 62, "deal_px": 4.24, "current_px": 4.30, "category": "Cash & CVR", "investable": "Yes, if below cash price", "deal_notes": "Parent is providing interim financing with a promissory note at SOFR + 10%", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "medium", "has_cvr": true},
    {"ticker": "AVDL", "acquiror": "ALKS", "announced": "2025-10-22", "close_date": "2026-02-19", "outside_date": "2026-07-19", "countdown": 260, "deal_px": 18.78, "current_px": 18.89, "category": "Cash + CVR", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "medium", "has_cvr": true},
    {"ticker": "HOLX", "acquiror": "Blackstone, TPG", "announced": "2025-10-21", "close_date": "2026-04-19", "outside_date": "2026-07-21", "countdown": 262, "deal_px": 76.99, "current_px": 73.91, "category": "Cash + CVR", "investable": "Yes", "deal_notes": "45 Day Go Shop ending 12/5/2025", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "low", "has_cvr": true},
    {"ticker": "TRUE", "acquiror": "Founder", "announced": "2025-10-15", "close_date": "2026-02-12", "outside_date": "2026-02-28", "countdown": 119, "deal_px": 2.54, "current_px": 2.20, "category": "All-cash", "deal_notes": "30 Day Go Shop ending 11/13/2025", "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "HI", "acquiror": "Lonestar private equity", "announced": "2025-10-15", "close_date": "2026-03-31", "outside_date": "2026-07-14", "countdown": 265, "deal_px": 32.23, "current_px": 31.60, "category": "All-cash", "investable": "Yes", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "ATXS", "acquiror": "BCRX", "announced": "2025-10-14", "close_date": "2026-02-11", "outside_date": "2026-04-14", "countdown": 164, "deal_px": 12.44, "current_px": 12.63, "category": "Cash & Stock", "investable": "Yes if large discount", "vote_risk": "medium", "finance_risk": "medium", "legal_risk": "medium", "has_cvr": false},
    {"ticker": "AKRO", "acquiror": "NVO", "announced": "2025-10-09", "close_date": "2026-02-06", "outside_date": "2026-04-09", "countdown": 159, "deal_px": 54.68, "current_px": 54.20, "category": "Cash & CVR", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "medium", "has_cvr": true},
    {"ticker": "HSII", "acquiror": "Advent (PE)", "announced": "2025-10-06", "close_date": "2026-02-03", "outside_date": "2026-07-05", "countdown": 246, "deal_px": 59.15, "current_px": 58.37, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "MRUS", "acquiror": "GMAB", "announced": "2025-09-29", "close_date": "2025-12-31", "outside_date": "2026-04-29", "countdown": 179, "deal_px": 97.00, "current_px": 94.86, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "medium", "legal_risk": "medium", "deal_notes": "represents a large acquisition for the parent", "has_cvr": false},
    {"ticker": "CLCO", "acquiror": "EPS Ventures", "announced": "2025-09-29", "close_date": "2025-12-31", "outside_date": "2026-03-01", "countdown": 120, "deal_px": 9.65, "current_px": 9.65, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "medium", "legal_risk": "low", "has_cvr": false},
    {"ticker": "EA", "acquiror": "Silver Lake", "announced": "2025-09-29", "close_date": "2026-06-30", "outside_date": "2026-09-28", "countdown": 331, "deal_px": 210.57, "current_px": 200.06, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "medium", "legal_risk": "low", "has_cvr": false},
    {"ticker": "IAS", "acquiror": "Novacap (PE)", "announced": "2025-09-24", "close_date": "2025-12-31", "outside_date": "2026-04-24", "countdown": 174, "deal_px": 10.30, "current_px": 10.21, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "MTSR", "acquiror": "PFE", "announced": "2025-09-22", "close_date": "2025-12-31", "outside_date": "2026-02-26", "countdown": 0, "deal_px": 47.50, "current_px": 63.04, "category": "Cash + CVR", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "medium", "has_cvr": true},
    {"ticker": "PINC", "acquiror": "Patient Square", "announced": "2025-09-22", "close_date": "2026-01-20", "outside_date": "2026-03-21", "countdown": 140, "deal_px": 28.25, "current_px": 28.12, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "ODP", "acquiror": "Atlas Holdings", "announced": "2025-09-22", "close_date": "2025-12-31", "outside_date": "2026-06-22", "countdown": 233, "deal_px": 28.00, "current_px": 27.88, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "PRO", "acquiror": "Thoma Bravo", "announced": "2025-09-22", "close_date": "2025-12-31", "outside_date": "2026-09-22", "countdown": 325, "deal_px": 23.25, "current_px": 23.05, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "VSTA", "acquiror": null, "announced": "2025-09-17", "close_date": "2025-11-01", "outside_date": null, "countdown": 0, "deal_px": 4.99, "current_px": 4.90, "category": "All-cash", "investable": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "PGRE", "acquiror": "RITM", "announced": "2025-09-17", "close_date": "2025-12-31", "outside_date": "2026-03-17", "countdown": 156, "deal_px": 6.60, "current_px": 6.54, "category": "All-cash", "investable": "Yes", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "VMEO", "acquiror": "Bending Spoons", "announced": "2025-09-10", "close_date": "2025-12-31", "outside_date": "2026-09-10", "countdown": 313, "deal_px": 7.85, "current_px": 7.80, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "TIXT", "acquiror": "TU", "announced": "2025-09-02", "close_date": "2025-12-31", "outside_date": "2026-01-02", "countdown": 62, "deal_px": 4.37, "current_px": 4.31, "category": "75% cash, 25% stock", "investable": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "AL", "acquiror": "Sumitomo / SMBC / Apollo / Brookfield", "announced": "2025-09-02", "close_date": "2026-03-31", "outside_date": "2026-06-01", "countdown": 212, "deal_px": 65.44, "current_px": 63.86, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "medium", "deal_notes": "anti-trust risk with sumitomo", "has_cvr": false},
    {"ticker": "AHL", "acquiror": "TYO: 8630", "announced": "2025-08-27", "close_date": "2026-03-31", "outside_date": "2026-05-27", "countdown": 207, "deal_px": 37.50, "current_px": 36.75, "category": "All-cash", "investable": "Yes", "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "VRNT", "acquiror": "Thoma Bravo", "announced": "2025-08-25", "close_date": "2025-12-23", "outside_date": "2026-08-24", "countdown": 296, "deal_px": 20.50, "current_px": 20.28, "category": "All-cash", "investable": "Yes", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "DAY", "acquiror": "Thoma Bravo", "announced": "2025-08-21", "close_date": "2025-12-31", "outside_date": "2026-05-21", "countdown": 201, "deal_px": 70.00, "current_px": 68.74, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "GES", "acquiror": "Authentic Brands", "announced": "2025-08-20", "close_date": "2025-12-31", "outside_date": "2026-08-20", "countdown": 292, "deal_px": 17.20, "current_px": 16.98, "category": "All-cash", "investable": "Yes, although some closing conditions to watch", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "medium", "has_cvr": false},
    {"ticker": "TGNA", "acquiror": "NXST", "announced": "2025-08-19", "close_date": "2026-08-18", "outside_date": "2026-08-18", "countdown": 290, "deal_px": 22.50, "current_px": 19.67, "category": "All-cash", "investable": "No, regulatory risk", "vote_risk": null, "finance_risk": null, "legal_risk": "high", "has_cvr": false},
    {"ticker": "SHCO", "acquiror": null, "announced": "2025-08-18", "close_date": "2025-12-16", "outside_date": "2026-02-15", "countdown": 106, "deal_px": 9.00, "current_px": 8.90, "category": "All-cash", "investable": "Yes", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    // Continue with remaining deals from PNG 2 and 3...
    {"ticker": "SPNS", "acquiror": "Advent", "announced": "2025-08-13", "close_date": "2025-12-31", "outside_date": "2026-02-08", "countdown": 99, "deal_px": 43.50, "current_px": 43.05, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "WOW", "acquiror": null, "announced": "2025-08-11", "close_date": "2025-12-31", "outside_date": "2026-08-01", "countdown": 273, "deal_px": 5.20, "current_px": 5.13, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "medium", "has_cvr": false},
  ]

  let importedCount = 0
  let skippedCount = 0

  for (const dealData of deals) {
    try {
      // Create deal
      const deal = await prisma.deal.create({
        data: {
          ticker: dealData.ticker,
          targetName: dealData.ticker,
          acquirorName: dealData.acquiror || undefined,
          status: 'active',
          createdById: user.id,
          updatedById: user.id,
        },
      })

      // Create deal version with local dates
      await prisma.dealVersion.create({
        data: {
          dealId: deal.id,
          versionNumber: 1,
          announcedDate: parseLocalDate(dealData.announced),
          expectedCloseDate: parseLocalDate(dealData.close_date),
          outsideDate: parseLocalDate(dealData.outside_date),
          category: mapCategory(dealData.category),
          cashPerShare: dealData.deal_px || undefined,
          voteRisk: dealData.vote_risk || undefined,
          financeRisk: dealData.finance_risk || undefined,
          legalRisk: dealData.legal_risk || undefined,
          isInvestable: isInvestable(dealData.investable),
          investableNotes: dealData.investable || undefined,
          dealNotes: dealData.deal_notes || undefined,
          isCurrentVersion: true,
          createdById: user.id,
        },
      })

      // Create price
      if (dealData.current_px) {
        await prisma.dealPrice.create({
          data: {
            dealId: deal.id,
            priceDate: new Date(),
            targetPrice: dealData.current_px,
            source: 'manual',
          },
        })
      }

      // Create sample CVR if deal has one
      if (dealData.has_cvr) {
        await prisma.cvr.create({
          data: {
            dealId: deal.id,
            cvrName: 'Milestone Payment',
            paymentAmount: 1.0,
            probability: 0.75,
            paymentDeadline: parseLocalDate(dealData.close_date),
            paymentStatus: 'pending',
          },
        })
      }

      importedCount++
      if (importedCount % 10 === 0) {
        console.log(`  Imported ${importedCount} deals...`)
      }
    } catch (error) {
      console.error(`  ✗ Failed to import ${dealData.ticker}:`, error)
      skippedCount++
    }
  }

  console.log(`\n✅ Database seeded successfully!`)
  console.log(`   - ${importedCount} deals imported`)
  console.log(`   - ${skippedCount} deals skipped`)
  console.log(`\n📊 View all deals at: http://localhost:3000/deals`)
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
