import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { scrapeYear } from "./exportListingTable.js";

const FIRST_YEAR = 1833;
const CURRENT_YEAR = new Date().getFullYear();

// Years can be skipped entirely when the website returns no results.
// We detect an empty year by the scrapeYear function saving a markdown
// file with zero data rows — the file will contain only the header + separator.
function markdownHasDataRows(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n").filter((l) => l.trim().startsWith("|"));
  // First line = header, second line = separator, third+ = data
  return lines.length > 2;
}

async function main(): Promise<void> {
  // Allow resuming: --start-year <year>
  const startYearArg = process.argv.indexOf("--start-year");
  const startYear =
    startYearArg !== -1 && process.argv[startYearArg + 1]
      ? parseInt(process.argv[startYearArg + 1], 10)
      : FIRST_YEAR;

  if (isNaN(startYear) || startYear < FIRST_YEAR || startYear > CURRENT_YEAR) {
    throw new Error(
      `--start-year must be a number between ${FIRST_YEAR} and ${CURRENT_YEAR}.`,
    );
  }

  const totalYears = CURRENT_YEAR - startYear + 1;
  console.log(
    `Scraping years ${startYear}–${CURRENT_YEAR} (${totalYears} years). ` +
      `Downloads will be saved under downloads/<year>/\n`,
  );

  // Re-use a single browser instance across all years to avoid repeated launch overhead
  const browser = await chromium.launch({ headless: true });

  const summary: Array<{ year: number; rows: number; downloads: number; skipped: boolean }> = [];
  let totalRows = 0;
  let totalDownloads = 0;
  let skipped = 0;

  try {
    for (let year = startYear; year <= CURRENT_YEAR; year += 1) {
      const url = `https://search.et.gr/el/search-legislation/?selectYear=${year}`;
      const outputPath = join("downloads", `listing-items-${year}.md`);

      // Skip years whose listing already exists and has data rows
      if (markdownHasDataRows(outputPath)) {
        console.log(`[${year}] Already downloaded — skipping. (delete ${outputPath} to re-scrape)`);
        summary.push({ year, rows: 0, downloads: 0, skipped: true });
        skipped++;
        continue;
      }

      console.log(`\n${"=".repeat(60)}`);
      console.log(`[${year}] (${year - startYear + 1}/${totalYears})`);
      console.log(`${"=".repeat(60)}`);

      try {
        const result = await scrapeYear(url, outputPath, { browser });

        if (result.rows === 0) {
          console.log(`[${year}] No data rows found — website may not have records for this year.`);
        }

        summary.push({ year, rows: result.rows, downloads: result.downloads, skipped: false });
        totalRows += result.rows;
        totalDownloads += result.downloads;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${year}] ERROR: ${message}`);
        summary.push({ year, rows: -1, downloads: 0, skipped: false });
      }
    }
  } finally {
    await browser.close();
  }

  // Print summary table
  console.log(`\n${"=".repeat(60)}`);
  console.log("SUMMARY");
  console.log(`${"=".repeat(60)}`);

  const errors = summary.filter((s) => s.rows === -1);
  const emptyYears = summary.filter((s) => s.rows === 0 && !s.skipped);
  const successYears = summary.filter((s) => s.rows > 0);

  console.log(`Years processed : ${totalYears}`);
  console.log(`  Skipped (already had data) : ${skipped}`);
  console.log(`  Scraped successfully        : ${successYears.length}`);
  console.log(`  Empty (no records on site)  : ${emptyYears.length}`);
  console.log(`  Errors                      : ${errors.length}`);
  console.log(`Total rows downloaded  : ${totalRows}`);
  console.log(`Total PDFs downloaded  : ${totalDownloads}`);

  if (errors.length > 0) {
    console.log(`\nFailed years: ${errors.map((s) => s.year).join(", ")}`);
    console.log(
      `Re-run with --start-year <year> to resume, or re-run the full command to retry failures.`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
