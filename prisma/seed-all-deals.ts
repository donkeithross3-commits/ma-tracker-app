import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Map spreadsheet categories to database enum values
function mapCategory(category: string | null): string {
  if (!category) return 'all_cash'
  const lower = category.toLowerCase()
  if (lower.includes('all-cash') || lower.includes('allcash')) return 'all_cash'
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
  console.log('🌱 Seeding database with all deals from spreadsheet...')

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

  const deals = [
    {"ticker": "MTSR", "acquiror": "PFE", "announced": "2025-09-22T00:00:00", "close_date": "2025-12-31T00:00:00", "deal_px": 47.5, "current_px": 64.49, "category": "Cash + CVR", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "medium", "has_cvr": true},
    {"ticker": "MKTW", "acquiror": null, "announced": "2025-10-29T00:00:00", "close_date": "2026-07-26T00:00:00", "deal_px": 17.25, "current_px": 17.08, "category": "Non-binding offer", "investable": null, "has_cvr": false},
    {"ticker": "COMM", "acquiror": "APH", "announced": "2025-08-04T00:00:00", "close_date": "2026-06-30T00:00:00", "deal_px": 17.64232292, "current_px": 16.71, "category": "Cash + Stub value", "investable": "Yes, with a high spread", "has_cvr": false},
    {"ticker": "QRVO", "acquiror": "SWKS", "announced": "2025-10-28T00:00:00", "close_date": "2027-03-31T00:00:00", "outside_date": "2027-04-27T00:00:00", "deal_px": 109.4248, "current_px": 98.62, "category": "Cash & Stock", "investable": "No, too much stock, anti-trust risk", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "high", "has_cvr": false},
    {"ticker": "IROQ", "acquiror": "ServBanc Holdco", "announced": "2025-10-30T00:00:00", "close_date": "2026-02-27T00:00:00", "deal_px": 27.2, "current_px": 25.95, "category": "All-cash", "investable": "No, too illiquid, anti trust risk", "has_cvr": false},
    {"ticker": "CYBR", "acquiror": "PANW", "announced": "2025-07-30T00:00:00", "close_date": "2026-06-30T00:00:00", "deal_px": 529.440075, "current_px": 520.21, "category": "Cash & Stock", "investable": "No, too much stock, too much regulatory risk", "has_cvr": false},
    {"ticker": "TRUE", "acquiror": "Founder", "announced": "2025-10-15T00:00:00", "close_date": "2026-02-12T00:00:00", "outside_date": "2026-02-28T00:00:00", "deal_px": 2.54, "current_px": 2.31, "category": "All-cash", "deal_notes": "30 Day Go Shop ending 11/13/2025", "has_cvr": false},
    {"ticker": "NSC", "acquiror": "UNP", "announced": "2025-07-29T00:00:00", "close_date": "2027-03-31T00:00:00", "deal_px": 318.01, "current_px": 282.77, "category": "Cash & Stock", "investable": "No, Anti-trust risk", "legal_risk": "high", "has_cvr": false},
    {"ticker": "TGNA", "acquiror": "NXST", "announced": "2025-08-19T00:00:00", "close_date": "2026-08-18T00:00:00", "outside_date": "2026-08-18T00:00:00", "deal_px": 22.5, "current_px": 19.82, "category": "All-cash", "investable": "No, regulatory risk", "legal_risk": "high", "has_cvr": false},
    {"ticker": "PLYM", "acquiror": "Ares", "announced": "2025-10-24T00:00:00", "close_date": "2026-02-21T00:00:00", "outside_date": "2026-07-24T00:00:00", "deal_px": 22.24, "current_px": 21.99, "category": "All-cash", "investable": "Yes", "deal_notes": "30 day go shop ending 11/23/25", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "MURA", "acquiror": "XOMA", "close_date": "2025-12-31T00:00:00", "deal_px": 2.025, "current_px": 2.1, "category": "Cash + CVR", "has_cvr": false},
    {"ticker": "ATXS", "acquiror": "BCRX", "announced": "2025-10-14T00:00:00", "close_date": "2026-02-11T00:00:00", "outside_date": "2026-04-14T00:00:00", "deal_px": 12.46347, "current_px": 12.65, "category": "Cash & Stock", "investable": "Yes if large discount", "vote_risk": "medium", "finance_risk": "medium", "legal_risk": "medium", "has_cvr": false},
    {"ticker": "VMEO", "acquiror": "Bending Spoons", "announced": "2025-09-10T00:00:00", "close_date": "2025-12-31T00:00:00", "outside_date": "2026-09-10T00:00:00", "deal_px": 7.85, "current_px": 7.8, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "DAY", "acquiror": "Thoma Bravo", "announced": "2025-08-21T00:00:00", "close_date": "2025-12-31T00:00:00", "outside_date": "2026-05-21T00:00:00", "deal_px": 70.0, "current_px": 68.55, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "SCS", "acquiror": "HNI", "announced": "2025-08-04T00:00:00", "close_date": "2025-12-31T00:00:00", "outside_date": "2026-05-04T00:00:00", "deal_px": 16.46392, "current_px": 16.0, "category": "Cash & Stock", "investable": "Yes, in small size and high spread", "vote_risk": "high (hni vote)", "finance_risk": "medium", "legal_risk": "medium", "has_cvr": false},
    {"ticker": "ADVM", "acquiror": "LLY", "announced": "2025-10-24T00:00:00", "close_date": "2025-12-08T00:00:00", "outside_date": "2026-01-22T00:00:00", "deal_px": 4.236364983, "current_px": 4.24, "category": "Cash & CVR", "investable": "Yes, if below cash price", "deal_notes": "Parent is providing interim financing with a promisory note at SOFR + 10%", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "medium", "has_cvr": true},
    {"ticker": "AHL", "acquiror": "TYO: 8630", "announced": "2025-08-27T00:00:00", "close_date": "2026-03-31T00:00:00", "outside_date": "2026-05-27T00:00:00", "deal_px": 37.5, "current_px": 36.76, "category": "All-cash", "has_cvr": false},
    {"ticker": "PRO", "acquiror": "Thoma Bravo", "announced": "2025-09-22T00:00:00", "close_date": "2025-12-31T00:00:00", "outside_date": "2026-09-22T00:00:00", "deal_px": 23.25, "current_px": 23.05, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "VSTA", "acquiror": null, "announced": "2025-09-17T00:00:00", "close_date": "2025-11-01T00:00:00", "deal_px": 4.99, "current_px": 4.92, "category": "All-cash", "has_cvr": false},
    {"ticker": "RNA", "acquiror": "NVS", "announced": "2025-10-27T00:00:00", "close_date": "2026-06-30T00:00:00", "outside_date": "2026-01-25T00:00:00", "deal_px": 74.09866301, "current_px": 69.79, "category": "Cash + Spin-off", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "medium", "has_cvr": true},
    {"ticker": "IAS", "acquiror": "Novacap (PE)", "announced": "2025-09-24T00:00:00", "close_date": "2025-12-31T00:00:00", "outside_date": "2026-04-24T00:00:00", "deal_px": 10.3, "current_px": 10.23, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "WOW", "acquiror": null, "announced": "2025-08-11T00:00:00", "close_date": "2025-12-31T00:00:00", "outside_date": "2026-08-01T00:00:00", "deal_px": 5.2, "current_px": 5.14, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "medium", "has_cvr": false},
    {"ticker": "MRUS", "acquiror": "GMAB", "announced": "2025-09-29T00:00:00", "close_date": "2025-12-31T00:00:00", "outside_date": "2026-04-29T00:00:00", "deal_px": 97.0, "current_px": 95.02, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "medium, represents a large acquisition for the parent", "legal_risk": "medium", "has_cvr": false},
    {"ticker": "AL", "acquiror": "Sumitomo Corporation, SMBC Aviation Capital, Apollo and Brookfield", "announced": "2025-09-02T00:00:00", "close_date": "2026-03-31T00:00:00", "outside_date": "2026-06-01T00:00:00", "deal_px": 65.44, "current_px": 63.88, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "medium, anti-trust risk with sumitomo", "has_cvr": false},
    {"ticker": "AKRO", "acquiror": "NVO", "announced": "2025-10-09T00:00:00", "close_date": "2026-02-06T00:00:00", "outside_date": "2026-04-09T00:00:00", "deal_px": 54.67736872, "current_px": 54.07, "category": "Cash & CVR", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "medium", "has_cvr": true},
    {"ticker": "VRNT", "acquiror": "Thoma Bravo", "announced": "2025-08-25T00:00:00", "close_date": "2025-12-23T00:00:00", "outside_date": "2026-08-24T00:00:00", "deal_px": 20.5, "current_px": 20.29, "category": "All-cash", "investable": "Yes", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "SHCO", "acquiror": null, "announced": "2025-08-18T00:00:00", "close_date": "2025-12-16T00:00:00", "outside_date": "2026-02-15T00:00:00", "deal_px": 9.0, "current_px": 8.9, "category": "All-cash", "investable": "Yes", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "ODP", "acquiror": "Atlas Holdings", "announced": "2025-09-22T00:00:00", "close_date": "2025-12-31T00:00:00", "outside_date": "2026-06-22T00:00:00", "deal_px": 28.0, "current_px": 27.81, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "HI", "acquiror": "Lonestar private equity", "announced": "2025-10-15T00:00:00", "close_date": "2026-03-31T00:00:00", "outside_date": "2026-07-14T00:00:00", "deal_px": 32.225, "current_px": 31.57, "category": "All-cash", "investable": "Yes", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "PRA", "acquiror": "The Doctors Company", "announced": "2025-03-20T00:00:00", "close_date": "2026-06-30T00:00:00", "outside_date": "2026-09-19T00:00:00", "deal_px": 25.0, "current_px": 23.99, "category": "All-cash", "investable": "Yes", "vote_risk": "medium", "finance_risk": "medium", "legal_risk": "medium", "has_cvr": false},
    {"ticker": "HSII", "acquiror": "Advent (PE)", "announced": "2025-10-06T00:00:00", "close_date": "2026-02-03T00:00:00", "outside_date": "2026-07-05T00:00:00", "deal_px": 59.15, "current_px": 58.35, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "HOLX", "acquiror": "Blackstone, TPG", "announced": "2025-10-21T00:00:00", "close_date": "2026-04-19T00:00:00", "outside_date": "2026-07-21T00:00:00", "deal_px": 76.99173554, "current_px": 74.0, "category": "Cash + CVR", "investable": "Yes", "deal_notes": "45 Day Go Shop ending 12/5/2025", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "low", "has_cvr": true},
    {"ticker": "SPNS", "acquiror": "Advent", "announced": "2025-08-13T00:00:00", "close_date": "2025-12-31T00:00:00", "outside_date": "2026-02-08T00:00:00", "deal_px": 43.5, "current_px": 43.09, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "EA", "acquiror": "Silver Lake", "announced": "2025-09-29T00:00:00", "close_date": "2026-06-30T00:00:00", "outside_date": "2026-09-28T00:00:00", "deal_px": 210.57, "current_px": 200.23, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "medium", "legal_risk": "low", "has_cvr": false},
    {"ticker": "CLCO", "acquiror": "EPS Ventures", "announced": "2025-09-29T00:00:00", "close_date": "2025-12-31T00:00:00", "outside_date": "2026-03-01T00:00:00", "deal_px": 9.65, "current_px": 9.64, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "medium", "legal_risk": "low", "has_cvr": false},
    {"ticker": "PINC", "acquiror": "Patient Square", "announced": "2025-09-22T00:00:00", "close_date": "2026-01-20T00:00:00", "outside_date": "2026-03-21T00:00:00", "deal_px": 28.25, "current_px": 28.11, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "PGRE", "acquiror": "RITM", "announced": "2025-09-17T00:00:00", "close_date": "2025-12-31T00:00:00", "outside_date": "2026-03-17T00:00:00", "deal_px": 6.6, "current_px": 6.54, "category": "All-cash", "investable": "Yes", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "WNS", "acquiror": "CAP", "announced": "2025-07-07T00:00:00", "close_date": "2025-10-15T00:00:00", "outside_date": "2026-04-07T00:00:00", "deal_px": 76.5, "current_px": 76.48, "category": "All-cash", "investable": "Yes", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "medium", "has_cvr": false},
    {"ticker": "GHLD", "acquiror": "Bayview Asset Management", "announced": "2025-06-18T00:00:00", "close_date": "2026-03-31T00:00:00", "outside_date": "2026-04-17T00:00:00", "deal_px": 20.0, "current_px": 19.86, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "medium", "has_cvr": false},
    {"ticker": "GTLS", "acquiror": "BKR", "announced": "2025-07-29T00:00:00", "close_date": "2026-06-30T00:00:00", "outside_date": "2026-07-28T00:00:00", "deal_px": 210.0, "current_px": 199.56, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "medium", "has_cvr": false},
    {"ticker": "JAMF", "acquiror": "Francisco Partners", "announced": "2025-10-29T00:00:00", "close_date": "2026-02-26T00:00:00", "deal_px": 13.05, "current_px": 12.85, "category": "All-cash", "investable": "Yes", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
    {"ticker": "GES", "acquiror": "Authentic Brands", "announced": "2025-08-20T00:00:00", "close_date": "2025-12-31T00:00:00", "outside_date": "2026-08-20T00:00:00", "deal_px": 17.2, "current_px": 17.02, "category": "All-cash", "investable": "Yes, although some closing conditions to watch", "vote_risk": "medium", "finance_risk": "low", "legal_risk": "medium", "has_cvr": false},
    {"ticker": "AVDL", "acquiror": "ALKS", "announced": "2025-10-22T00:00:00", "close_date": "2026-02-19T00:00:00", "outside_date": "2026-07-19T00:00:00", "deal_px": 18.78174305, "current_px": 18.8, "category": "Cash + CVR", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "medium", "has_cvr": true},
    {"ticker": "CSGS", "acquiror": "NEC Corp", "announced": "2025-10-29T00:00:00", "close_date": "2026-06-30T00:00:00", "outside_date": "2026-10-29T00:00:00", "deal_px": 81.34, "current_px": 78.25, "category": "All-cash", "investable": "Yes", "vote_risk": "low", "finance_risk": "low", "legal_risk": "low", "has_cvr": false},
  ]

  let importedCount = 0
  let skippedCount = 0

  for (const dealData of deals) {
    try {
      // Create deal
      const deal = await prisma.deal.create({
        data: {
          ticker: dealData.ticker,
          targetName: dealData.ticker, // Use ticker as name for now
          acquirorName: dealData.acquiror || undefined,
          status: 'active',
          createdById: user.id,
          updatedById: user.id,
        },
      })

      // Create deal version
      await prisma.dealVersion.create({
        data: {
          dealId: deal.id,
          versionNumber: 1,
          announcedDate: dealData.announced ? new Date(dealData.announced) : undefined,
          expectedCloseDate: dealData.close_date ? new Date(dealData.close_date) : undefined,
          outsideDate: dealData.outside_date ? new Date(dealData.outside_date) : undefined,
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
            paymentDeadline: dealData.close_date ? new Date(dealData.close_date) : new Date(),
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
