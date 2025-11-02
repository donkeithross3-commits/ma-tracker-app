import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

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

// Current Yield (Expected IRR) values extracted from individual deal sheets (Cell C19)
const currentYields: Record<string, number> = {
  "IROQ": 0.1755542083,
  "REVG": 0.07869544928,
  "MKTW": 0.02143963156,
  "CSGS": 0.05859067479,
  "JAMF": 0.04788985334,
  "RNW": 0.1094912347,
  "QRVO": 0.08978090901,
  "JHG": -0.0004387382894,
  "SOHO": 0.1358490566,
  "RNA": 0.09085970738,
  "PLYM": 0.03506493506,
  "ADVM": -0.1439887244,
  "AVDL": -0.01875571581,
  "HOLX": 0.08881942562,
  "TRUE": 0.5401588703,
  "HI": 0.04746835443,
  "ATXS": -0.05395556798,
  "AKRO": 0.03268778061,
  "HSII": 0.05117755769,
  "EA": 0.078474383,
  "MRUS": 0.1353573688,
  "CLCO": 0.0,
  "IAS": 0.05288932419,
  "PRO": 0.05206073753,
  "MTSR": -1.479060914,
  "PINC": 0.02080369844,
  "ODP": 0.02582496413,
  "PGRE": 0.05504587156,
  "VMEO": 0.03846153846,
  "TIXT": 0.07732482599,
  "AL": 0.05937989352,
  "AHL": 0.04897959184,
  "VRNT": 0.07510241238,
  "DAY": 0.1099796334,
  "GES": 0.0777385159,
  "MURA": -0.1866028708,
  "TGNA": 0.1786021072,
  "SHCO": 0.08988764045,
  "SPNS": 0.06271777003,
  "HBI": 0.1230680787,
  "WOW": 0.08187134503,
  "IMXI": 0.07175615835,
  "ARIS": -0.1212350706,
  "STAA": 0.1628599464,
  "COMM": 0.02955801973,
  "SCS": 0.1540090226,
  "EM": -0.7883211679,
  "CYBR": 0.02540813102,
  "NSC": 0.08697779304,
  "GTLS": 0.0776745526,
  "CIO": 0.08695652174,
  "WNS": -0.005537779966,
  "GMS": -31.16156361,
  "SOL": -0.7862903226,
  "GHLD": 0.01448692153,
  "CTLP": -1.212121212,
  "INFA": 0.01254523522,
  "MTAL": 0.01965601966,
  "CFSB": 0.0,
  "TXNM": 0.09678541839,
  "DADA": 10.8,
  "LNSR": -1.554878049,
  "PRA": 0.06548913279,
  "SSTK": 0.001665614166,
  "LWAY": -0.0003297575199,
  "FYBR": 0.05978885378,
  "K": -0.07410111618,
  "GLXZ": -0.5396330495,
  "SPR": -0.04431197742,
  "ALE": -0.1388443056,
  "SSYS": -0.02308732224
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

  // Create users with hashed passwords
  const defaultPassword = await bcrypt.hash('limitless2025', 10)

  const don = await prisma.user.create({
    data: {
      username: 'don',
      email: 'don@limitlessventures.us',
      password: defaultPassword,
      fullName: 'Don Ross',
      role: 'admin',
    },
  })

  const luis = await prisma.user.create({
    data: {
      username: 'luis',
      email: 'luis@limitlessventures.us',
      password: defaultPassword,
      fullName: 'Luis',
      role: 'analyst',
    },
  })

  console.log('✓ Created users: don, luis')
  console.log('  Default password: limitless2025')

  const user = don // Use don as default user for deal creation

  // All 69 deals from M&A Dashboard sheet (sorted by announced date descending)
  const deals = [
    {"ticker": "REVG", "acquiror": "TEX", "announced": "2025-10-30", "close_date": "2026-06-30", "outside_date": null, "deal_px": 53.971018, "current_px": 51.27, "category": "Cash & Stock", "investable": "No, too much stock", "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "IROQ", "acquiror": "ServBanc Holdco", "announced": "2025-10-30", "close_date": "2026-02-27", "outside_date": null, "deal_px": 27.2, "current_px": 25.72, "category": "All-cash", "investable": "No, too illiquid, anti trust risk", "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "CSGS", "acquiror": "NEC Corp", "announced": "2025-10-29", "close_date": "2026-06-30", "outside_date": "2026-10-29", "deal_px": 81.34, "current_px": 78.27, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "JAMF", "acquiror": "Francisco Partners", "announced": "2025-10-29", "close_date": "2026-02-26", "outside_date": "2026-07-28", "deal_px": 13.05, "current_px": 12.85, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Medium", "finance_risk": "Low", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "MKTW", "acquiror": null, "announced": "2025-10-29", "close_date": "2026-07-26", "outside_date": null, "deal_px": 17.25, "current_px": 16.98, "category": "Non-binding offer", "investable": null, "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "QRVO", "acquiror": "SWKS", "announced": "2025-10-28", "close_date": "2027-03-31", "outside_date": "2027-04-27", "deal_px": 107.1112, "current_px": 94.92, "category": "Cash & Stock", "investable": "No, too much stock, anti-trust risk", "deal_notes": null, "vote_risk": "Medium", "finance_risk": "Low", "legal_risk": "High", "has_cvr": false},
    {"ticker": "RNW", "acquiror": "Management", "announced": "2025-10-28", "close_date": "2026-07-25", "outside_date": null, "deal_px": 8.15, "current_px": 7.54, "category": "Non-binding offer", "investable": null, "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "RNA", "acquiror": "NVS", "announced": "2025-10-27", "close_date": "2026-06-30", "outside_date": "2026-01-25", "deal_px": 74.09866301, "current_px": 69.85, "category": "Cash + Spin-off", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Medium", "has_cvr": true},
    {"ticker": "SOHO", "acquiror": "Ascendant Capital & Kemmons Wilson Hospitality", "announced": "2025-10-27", "close_date": "2026-03-31", "outside_date": "2026-04-22", "deal_px": 2.24, "current_px": 2.12, "category": "All-cash", "investable": "No, too illiquid and high risk stock is a zero if deal fails", "deal_notes": "Parent has extended a bridge loan (promissory note) to Company", "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "PLYM", "acquiror": "Ares", "announced": "2025-10-24", "close_date": "2026-02-21", "outside_date": "2026-07-24", "deal_px": 22.24, "current_px": 22, "category": "All-cash", "investable": "Yes", "deal_notes": "30 day go shop ending 11/23/25", "vote_risk": "Medium", "finance_risk": "Low", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "ADVM", "acquiror": "LLY", "announced": "2025-10-24", "close_date": "2025-12-08", "outside_date": "2026-01-22", "deal_px": 4.236364983, "current_px": 4.3, "category": "Cash & CVR", "investable": "Yes, if below cash price", "deal_notes": "Parent is providing interim financing with a promisory note at SOFR + 10%", "vote_risk": "Medium", "finance_risk": "Low", "legal_risk": "Medium", "has_cvr": true},
    {"ticker": "AVDL", "acquiror": "ALKS", "announced": "2025-10-22", "close_date": "2026-02-19", "outside_date": "2026-07-19", "deal_px": 18.78174305, "current_px": 18.89, "category": "Cash + CVR", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Medium", "has_cvr": true},
    {"ticker": "HOLX", "acquiror": "Blackstone, TPG", "announced": "2025-10-21", "close_date": "2026-04-19", "outside_date": "2026-07-21", "deal_px": 76.99173554, "current_px": 73.91, "category": "Cash + CVR", "investable": "Yes", "deal_notes": "45 Day Go Shop ending 12/5/2025", "vote_risk": "Medium", "finance_risk": "Low", "legal_risk": "Low", "has_cvr": true},
    {"ticker": "TRUE", "acquiror": "Founder", "announced": "2025-10-15", "close_date": "2026-02-12", "outside_date": "2026-02-28", "deal_px": 2.54, "current_px": 2.2, "category": "All-cash", "investable": null, "deal_notes": "30 Day Go Shop ending 11/13/2025", "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "HI", "acquiror": "Lonestar private equity", "announced": "2025-10-15", "close_date": "2026-03-31", "outside_date": "2026-07-14", "deal_px": 32.225, "current_px": 31.6, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Medium", "finance_risk": "Low", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "ATXS", "acquiror": "BCRX", "announced": "2025-10-14", "close_date": "2026-02-11", "outside_date": "2026-04-14", "deal_px": 12.43692, "current_px": 12.63, "category": "Cash & Stock", "investable": "Yes if large discount", "deal_notes": null, "vote_risk": "Medium", "finance_risk": "Medium", "legal_risk": "Medium", "has_cvr": false},
    {"ticker": "AKRO", "acquiror": "NVO", "announced": "2025-10-09", "close_date": "2026-02-06", "outside_date": "2026-04-09", "deal_px": 54.67736872, "current_px": 54.2, "category": "Cash & CVR", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Medium", "has_cvr": true},
    {"ticker": "HSII", "acquiror": "Advent (PE)", "announced": "2025-10-06", "close_date": "2026-02-03", "outside_date": "2026-07-05", "deal_px": 59.15, "current_px": 58.37, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "MRUS", "acquiror": "GMAB", "announced": "2025-09-29", "close_date": "2025-12-31", "outside_date": "2026-04-29", "deal_px": 97, "current_px": 94.86, "category": "All-cash", "investable": "Yes", "deal_notes": "represents a large acquisition for the parent", "vote_risk": "Low", "finance_risk": "Medium", "legal_risk": "Medium", "has_cvr": false},
    {"ticker": "CLCO", "acquiror": "EPS Ventures", "announced": "2025-09-29", "close_date": "2025-12-31", "outside_date": "2026-03-01", "deal_px": 9.65, "current_px": 9.65, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Medium", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "EA", "acquiror": "Silver Lake", "announced": "2025-09-29", "close_date": "2026-06-30", "outside_date": "2026-09-28", "deal_px": 210.57, "current_px": 200.06, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Medium", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "IAS", "acquiror": "Novacap (PE)", "announced": "2025-09-24", "close_date": "2025-12-31", "outside_date": "2026-04-24", "deal_px": 10.3, "current_px": 10.21, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "MTSR", "acquiror": "PFE", "announced": "2025-09-22", "close_date": "2025-12-31", "outside_date": null, "deal_px": 47.5, "current_px": 63.04, "category": "Cash + CVR", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Medium", "has_cvr": true},
    {"ticker": "PINC", "acquiror": "Patient Square", "announced": "2025-09-22", "close_date": "2026-01-20", "outside_date": "2026-03-21", "deal_px": 28.25, "current_px": 28.12, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "ODP", "acquiror": "Atlas Holdings", "announced": "2025-09-22", "close_date": "2025-12-31", "outside_date": "2026-06-22", "deal_px": 28, "current_px": 27.88, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "PRO", "acquiror": "Thoma Bravo", "announced": "2025-09-22", "close_date": "2025-12-31", "outside_date": "2026-09-22", "deal_px": 23.25, "current_px": 23.05, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "VSTA", "acquiror": null, "announced": "2025-09-17", "close_date": "2025-11-01", "outside_date": null, "deal_px": 4.99, "current_px": 4.9, "category": "All-cash", "investable": null, "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "PGRE", "acquiror": "RITM", "announced": "2025-09-17", "close_date": "2025-12-31", "outside_date": "2026-03-17", "deal_px": 6.6, "current_px": 6.54, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Medium", "finance_risk": "Low", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "VMEO", "acquiror": "Bending Spoons", "announced": "2025-09-10", "close_date": "2025-12-31", "outside_date": "2026-09-10", "deal_px": 7.85, "current_px": 7.8, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "TIXT", "acquiror": "TU", "announced": "2025-09-02", "close_date": "2025-12-31", "outside_date": "2026-01-02", "deal_px": 4.365545, "current_px": 4.31, "category": "75% cash, 25% stock", "investable": null, "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "AL", "acquiror": "Sumitomo Corporation, SMBC Aviation Capital, Apollo and Brookfield", "announced": "2025-09-02", "close_date": "2026-03-31", "outside_date": "2026-06-01", "deal_px": 65.44, "current_px": 63.86, "category": "All-cash", "investable": "Yes", "deal_notes": "anti-trust risk with sumitomo", "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Medium", "has_cvr": false},
    {"ticker": "AHL", "acquiror": "TYO: 8630", "announced": "2025-08-27", "close_date": "2026-03-31", "outside_date": "2026-05-27", "deal_px": 37.5, "current_px": 36.75, "category": "All-cash", "investable": null, "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "VRNT", "acquiror": "Thoma Bravo", "announced": "2025-08-25", "close_date": "2025-12-23", "outside_date": "2026-08-24", "deal_px": 20.5, "current_px": 20.28, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Medium", "finance_risk": "Low", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "DAY", "acquiror": "Thoma Bravo", "announced": "2025-08-21", "close_date": "2025-12-31", "outside_date": "2026-05-21", "deal_px": 70, "current_px": 68.74, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "GES", "acquiror": "Authentic Brands", "announced": "2025-08-20", "close_date": "2025-12-31", "outside_date": "2026-08-20", "deal_px": 17.2, "current_px": 16.98, "category": "All-cash", "investable": "Yes, although some closing conditions to watch", "deal_notes": null, "vote_risk": "Medium", "finance_risk": "Low", "legal_risk": "Medium", "has_cvr": false},
    {"ticker": "TGNA", "acquiror": "NXST", "announced": "2025-08-19", "close_date": "2026-08-18", "outside_date": "2026-08-18", "deal_px": 22.5, "current_px": 19.67, "category": "All-cash", "investable": "No, regulatory risk", "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": "High", "has_cvr": false},
    {"ticker": "SHCO", "acquiror": null, "announced": "2025-08-18", "close_date": "2025-12-16", "outside_date": "2026-02-15", "deal_px": 9, "current_px": 8.9, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Medium", "finance_risk": "Low", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "HBI", "acquiror": "GIL", "announced": "2025-08-13", "close_date": "2025-12-31", "outside_date": null, "deal_px": 6.74558, "current_px": 6.61, "category": "Cash & Stock", "investable": "No, too much stock", "deal_notes": null, "vote_risk": "Medium", "finance_risk": "Low", "legal_risk": "Medium", "has_cvr": false},
    {"ticker": "SPNS", "acquiror": "Advent", "announced": "2025-08-13", "close_date": "2025-12-31", "outside_date": "2026-02-08", "deal_px": 43.5, "current_px": 43.05, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Low", "has_cvr": false},
    {"ticker": "WOW", "acquiror": null, "announced": "2025-08-11", "close_date": "2025-12-31", "outside_date": "2026-08-01", "deal_px": 5.2, "current_px": 5.13, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Medium", "has_cvr": false},
    {"ticker": "IMXI", "acquiror": "WU", "announced": "2025-08-11", "close_date": "2026-11-10", "outside_date": "2026-05-11", "deal_px": 16, "current_px": 14.89, "category": "All-cash", "investable": "No, regulatory concerns", "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "ARIS", "acquiror": "WES", "announced": "2025-08-07", "close_date": "2025-12-05", "outside_date": null, "deal_px": 23.41875, "current_px": 23.69, "category": "$25 cash or .625 stock, subject to proration (415/1500)", "investable": "No, ARIS will receive LP units", "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "STAA", "acquiror": "ALC", "announced": "2025-08-05", "close_date": "2026-05-02", "outside_date": "2026-08-04", "deal_px": 28, "current_px": 25.87, "category": "All-cash", "investable": "No, deal vote risk is too high (dissenting shareholder)", "deal_notes": null, "vote_risk": "Medium", "finance_risk": "Low", "legal_risk": "Medium", "has_cvr": false},
    {"ticker": "SCS", "acquiror": "HNI", "announced": "2025-08-04", "close_date": "2025-12-31", "outside_date": "2026-05-04", "deal_px": 16.369664, "current_px": 15.96, "category": "Cash & Stock", "investable": "Yes, in small size and high spread", "deal_notes": null, "vote_risk": "High (HNI vote)", "finance_risk": "Medium", "legal_risk": "Medium", "has_cvr": false},
    {"ticker": "COMM", "acquiror": "APH", "announced": "2025-08-04", "close_date": "2026-06-30", "outside_date": null, "deal_px": 17.64232292, "current_px": 17.3, "category": "Cash + Stub value", "investable": "Yes, with a high spread", "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "EM", "acquiror": null, "announced": "2025-08-01", "close_date": "2025-12-31", "outside_date": null, "deal_px": 1.19, "current_px": 1.37, "category": "All-cash", "investable": "No, china deal", "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "CYBR", "acquiror": "PANW", "announced": "2025-07-30", "close_date": "2026-06-30", "outside_date": null, "deal_px": 529.63812, "current_px": 520.78, "category": "Cash & Stock", "investable": "No, too much stock, too much regulatory risk", "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "GTLS", "acquiror": "BKR", "announced": "2025-07-29", "close_date": "2026-06-30", "outside_date": "2026-07-28", "deal_px": 210, "current_px": 199.62, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Medium", "has_cvr": false},
    {"ticker": "NSC", "acquiror": "UNP", "announced": "2025-07-29", "close_date": "2027-03-31", "outside_date": null, "deal_px": 318.64, "current_px": 283.38, "category": "Cash & Stock", "investable": "No, Anti-trust risk", "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": "High", "has_cvr": false},
    {"ticker": "CIO", "acquiror": "MCME Carell Holdings", "announced": "2025-07-24", "close_date": "2025-12-31", "outside_date": "2026-01-19", "deal_px": 7, "current_px": 6.9, "category": "All-cash", "investable": "No, do not like deal conditions", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Medium", "legal_risk": "Higher", "has_cvr": false},
    {"ticker": "WNS", "acquiror": "CAP", "announced": "2025-07-07", "close_date": "2025-10-15", "outside_date": "2026-04-07", "deal_px": 76.5, "current_px": 76.48, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Medium", "finance_risk": "Low", "legal_risk": "Medium", "has_cvr": false},
    {"ticker": "BGFV", "acquiror": "Worldwide Golf and Capitol Hill Group", "announced": "2025-06-30", "close_date": null, "outside_date": null, "deal_px": 1.44, "current_px": 0, "category": "All-cash", "investable": "No, company a zero if deal fails", "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "SOL", "acquiror": null, "announced": "2025-06-20", "close_date": "2025-09-30", "outside_date": "2025-12-31", "deal_px": 1.99, "current_px": 1.86, "category": "All-cash", "investable": "No, do not like the shareholder dynamics and the stock is likley a zero if bid fails", "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "GHLD", "acquiror": "Bayview Asset Management", "announced": "2025-06-18", "close_date": "2026-03-31", "outside_date": "2026-04-17", "deal_px": 20, "current_px": 19.88, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Medium", "has_cvr": false},
    {"ticker": "CTLP", "acquiror": "365 Retail Markets (PE Backed)", "announced": "2025-06-16", "close_date": "2025-10-14", "outside_date": "2026-06-15", "deal_px": 11.2, "current_px": 10.56, "category": "All-cash", "investable": "No, antitrust concerns", "deal_notes": null, "vote_risk": "Medium", "finance_risk": "Low", "legal_risk": "High", "has_cvr": false},
    {"ticker": "MTAL", "acquiror": "HMY", "announced": "2025-05-27", "close_date": "2025-12-31", "outside_date": null, "deal_px": 12.25, "current_px": 12.21, "category": "All-cash", "investable": "No, too many regulatory approvals and conditions", "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": "High", "has_cvr": false},
    {"ticker": "INFA", "acquiror": "CRM", "announced": "2025-05-27", "close_date": "2026-03-31", "outside_date": null, "deal_px": 25, "current_px": 24.87, "category": "All-cash", "investable": "No, high anti-trust risk. Significant product overlap ", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "High", "has_cvr": false},
    {"ticker": "CFSB", "acquiror": "Hometown Bank", "announced": "2025-05-21", "close_date": "2025-12-31", "outside_date": null, "deal_px": 14.25, "current_px": 14.25, "category": "Allcash", "investable": "No, regulatory risk (bank)", "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "TXNM", "acquiror": "Blackstone", "announced": "2025-05-19", "close_date": "2026-12-31", "outside_date": null, "deal_px": 63.29, "current_px": 56.8, "category": "All-cash", "investable": "No, high regulatory risk", "deal_notes": "utilities regulators", "vote_risk": null, "finance_risk": null, "legal_risk": "High", "has_cvr": false},
    {"ticker": "LNSR", "acquiror": "ALC", "announced": "2025-03-24", "close_date": "2025-09-30", "outside_date": "2026-04-23", "deal_px": 14, "current_px": 12.3, "category": "Cash + CVR", "investable": "No, 2nd request", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "Medium", "has_cvr": false},
    {"ticker": "PRA", "acquiror": "The Doctors Company", "announced": "2025-03-20", "close_date": "2026-06-30", "outside_date": "2026-09-19", "deal_px": 25, "current_px": 23.95, "category": "All-cash", "investable": "Yes", "deal_notes": null, "vote_risk": "Medium", "finance_risk": "Medium", "legal_risk": "Medium", "has_cvr": false},
    {"ticker": "SSTK", "acquiror": "GETY", "announced": "2025-01-07", "close_date": "2025-06-30", "outside_date": null, "deal_px": 25.01564, "current_px": 25.03, "category": "Cash & Stock", "investable": "No, too much stock", "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "FYBR", "acquiror": "VZ", "announced": "2024-09-05", "close_date": "2026-02-27", "outside_date": "2026-04-04", "deal_px": 38.5, "current_px": 37.76, "category": "All-cash", "investable": "No, regulatory risk", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "High", "has_cvr": false},
    {"ticker": "K", "acquiror": "Mars", "announced": "2024-08-14", "close_date": "2025-06-30", "outside_date": "2025-08-13", "deal_px": 85.18, "current_px": 83.06, "category": "All-cash", "investable": "No, high anti-trust risk", "deal_notes": null, "vote_risk": "Low", "finance_risk": "Low", "legal_risk": "High", "has_cvr": false},
    {"ticker": "GLXZ", "acquiror": "STO: EVO", "announced": "2024-07-18", "close_date": "2025-06-30", "outside_date": "2025-07-18", "deal_px": 3.19, "current_px": 2.69, "category": "All-cash", "investable": "No, risk of shareholders not voting for deal", "deal_notes": null, "vote_risk": "Medium", "finance_risk": "Low", "legal_risk": "Medium", "has_cvr": false},
    {"ticker": "SPR", "acquiror": "BA", "announced": "2024-07-01", "close_date": "2025-06-30", "outside_date": null, "deal_px": 37.25, "current_px": 36.69, "category": "All-stock", "investable": "No, too much stock, too much regulatory scrutiny", "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "ALE", "acquiror": "Canada Pension Plan (PE)", "announced": "2024-05-06", "close_date": "2025-06-30", "outside_date": "2025-08-05", "deal_px": 70.55, "current_px": 67.33, "category": "All-cash", "investable": "No, too many local regulatory approvals", "deal_notes": null, "vote_risk": "Medium", "finance_risk": "Low", "legal_risk": "High", "has_cvr": false},
    {"ticker": "MURA", "acquiror": "XOMA", "announced": null, "close_date": "2025-12-31", "outside_date": null, "deal_px": 2.025, "current_px": 2.09, "category": "Cash + CVR", "investable": null, "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
    {"ticker": "JHG", "acquiror": "Trian", "announced": null, "close_date": null, "outside_date": null, "deal_px": 46, "current_px": 43.56, "category": "Non-binding offer", "investable": null, "deal_notes": null, "vote_risk": null, "finance_risk": null, "legal_risk": null, "has_cvr": false},
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
          currentYield: currentYields[dealData.ticker] || undefined,
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
