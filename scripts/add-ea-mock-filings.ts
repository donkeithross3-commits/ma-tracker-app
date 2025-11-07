import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Find EA deal
  const eaDeal = await prisma.deal.findFirst({
    where: { ticker: "EA" },
  });

  if (!eaDeal) {
    console.error("EA deal not found in database");
    process.exit(1);
  }

  console.log(`Found EA deal: ${eaDeal.id} - ${eaDeal.targetName || "EA"}`);

  // Check if filings already exist
  const existingFilings = await prisma.secFiling.findMany({
    where: { dealId: eaDeal.id },
  });

  if (existingFilings.length > 0) {
    console.log(`EA deal already has ${existingFilings.length} filings. Deleting...`);
    await prisma.secFiling.deleteMany({
      where: { dealId: eaDeal.id },
    });
  }

  // Create mock DEFM14A filing for EA
  const defm14a = await prisma.secFiling.create({
    data: {
      dealId: eaDeal.id,
      filingType: "DEFM14A",
      filingDate: new Date("2024-11-20"),
      accessionNumber: "0001193125-24-999999",
      edgarUrl: "https://www.sec.gov/Archives/edgar/data/712515/000119312524999999/d999999defm14a.htm",
      documentUrl: "https://www.sec.gov/Archives/edgar/data/712515/000119312524999999/d999999defm14a.htm",
      fetchStatus: "fetched",
      textExtracted: `DEFINITIVE PROXY STATEMENT - ELECTRONIC ARTS INC.

MERGER AGREEMENT

Electronic Arts Inc. (EA) and Take-Two Interactive Software, Inc. have entered into a definitive merger agreement under which Take-Two Interactive will acquire all outstanding shares of EA common stock.

MERGER CONSIDERATION
Each share of EA common stock will be converted into the right to receive $165.00 per share in cash, representing a premium of approximately 40% over EA's 30-day volume-weighted average price.

BACKGROUND OF THE MERGER
The EA Board of Directors, with the assistance of its financial and legal advisors, conducted a comprehensive review of strategic alternatives. After careful consideration, the Board determined that the merger with Take-Two Interactive represents the best opportunity to maximize shareholder value.

OPINION OF FINANCIAL ADVISOR
Goldman Sachs & Co. LLC, financial advisor to EA, delivered its opinion to the Board that, as of November 15, 2024, and based upon and subject to the factors and assumptions set forth therein, the $165.00 per share in cash to be received by holders of EA common stock was fair from a financial perspective.

REGULATORY APPROVALS
The merger is subject to approval under the Hart-Scott-Rodino Antitrust Improvements Act (HSR Act) and certain foreign antitrust approvals. The HSR Act waiting period is expected to be significant given the size and overlap of the two companies in the video game industry.

ANTITRUST CONSIDERATIONS
- Both companies are major publishers of video game franchises
- Potential market concentration in sports gaming (EA Sports vs. 2K Sports)
- FTC may scrutinize the combination of EA's and Take-Two's mobile gaming assets
- European Commission review expected to take 4-6 months
- China SAMR approval may be required

GO-SHOP PROVISION
The merger agreement includes a 45-day "go-shop" period ending January 5, 2025, during which EA may actively solicit alternative acquisition proposals. If a superior proposal is received during the go-shop period, EA may terminate the merger agreement subject to payment of a reduced termination fee.

TERMINATION RIGHTS AND FEES
- Either party may terminate if closing has not occurred by November 15, 2025
- EA may terminate to accept a superior proposal (subject to termination fee)
- Termination fee: $850 million if terminated during go-shop period for superior proposal
- Termination fee: $1.275 billion if terminated after go-shop period for superior proposal
- Reverse termination fee of $2.0 billion payable by Take-Two if merger fails to obtain regulatory approval

FINANCING
Take-Two Interactive has obtained committed financing from JPMorgan Chase Bank, N.A., Goldman Sachs Bank USA, and Bank of America, N.A. The financing is not subject to any financing conditions.

CONDITIONS TO CLOSING
- Approval by EA stockholders
- Expiration or termination of HSR Act waiting period
- Receipt of required foreign antitrust approvals
- No material adverse effect on EA
- Accuracy of representations and warranties

VOTE REQUIRED
Approval of the merger requires the affirmative vote of a majority of the outstanding shares of EA common stock.

SPECIAL MEETING OF STOCKHOLDERS
A special meeting of EA stockholders will be held on January 15, 2025, at 10:00 a.m. Pacific Time.

BOARD RECOMMENDATION
THE EA BOARD OF DIRECTORS UNANIMOUSLY RECOMMENDS THAT STOCKHOLDERS VOTE "FOR" THE ADOPTION OF THE MERGER AGREEMENT.

RISK FACTORS
- Regulatory approval is uncertain and may not be obtained
- The merger may not be completed within the expected timeframe
- Significant business disruption during the pendency of the merger
- Potential loss of key employees
- Third-party consents may be required
- Substantial transaction costs

INTERESTS OF DIRECTORS AND EXECUTIVE OFFICERS
Certain executive officers have interests in the merger that may be different from, or in addition to, the interests of EA stockholders generally, including:
- Change of control severance payments
- Accelerated vesting of equity awards
- Continuation of certain benefits

Expected Closing: Q3 2025 (subject to regulatory approval)`,
    },
  });

  // Create mock 8-K filing
  const eightK = await prisma.secFiling.create({
    data: {
      dealId: eaDeal.id,
      filingType: "8-K",
      filingDate: new Date("2024-11-15"),
      accessionNumber: "0001193125-24-999998",
      edgarUrl: "https://www.sec.gov/Archives/edgar/data/712515/000119312524999998/d9999998k.htm",
      documentUrl: "https://www.sec.gov/Archives/edgar/data/712515/000119312524999998/d9999998k.htm",
      fetchStatus: "fetched",
      textExtracted: `CURRENT REPORT - FORM 8-K
ELECTRONIC ARTS INC.

Item 1.01 Entry into a Material Definitive Agreement

On November 15, 2024, Electronic Arts Inc. ("EA") entered into an Agreement and Plan of Merger with Take-Two Interactive Software, Inc. ("Take-Two") and a wholly-owned subsidiary of Take-Two.

Under the merger agreement:
- Each share of EA common stock will be converted into $165.00 in cash
- Total enterprise value of approximately $42 billion
- Represents a 40% premium to EA's 30-day VWAP
- Go-shop period of 45 days ending January 5, 2025
- Expected closing in Q3 2025, subject to regulatory approvals

The merger agreement includes customary representations, warranties, and covenants. EA has agreed to operate its business in the ordinary course during the pendency of the merger.

Item 8.01 Other Events

EA issued a press release announcing the merger agreement. The press release is attached as Exhibit 99.1.`,
    },
  });

  console.log(`Created ${2} mock SEC filings for EA deal:`);
  console.log(`  - DEFM14A: ${defm14a.id}`);
  console.log(`  - 8-K: ${eightK.id}`);
  console.log(`\nYou can now generate a research report for the EA deal!`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
