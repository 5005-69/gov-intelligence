import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import https from "node:https";
import { chromium } from "playwright";
import {
  normalizeText,
  escapeMarkdownCell,
  extractKnownPdfFilenames,
  buildMarkdownRow,
  buildMarkdownHeader,
  prependRowsToMarkdown,
  type EnrichedRow,
} from "./utils.js";

type ScrapedRow = {
  cells: string[];
  downloadUrl?: string;
};

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadFile(url: string, filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const file = createWriteStream(filePath);
    const request = https.get(url, (response: any) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.destroy();
          downloadFile(redirectUrl, filePath).then(resolve);
          return;
        }
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve(true);
      });
    });
    request.on("error", () => {
      file.destroy();
      resolve(false);
    });
  });
}

async function downloadFileWithRetry(
  url: string,
  filePath: string,
  fileName: string,
  maxAttempts = 4,
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const success = await downloadFile(url, filePath);
    if (success) {
      if (attempt > 1) {
        console.log(`  Downloaded ${fileName} on retry ${attempt}/${maxAttempts}`);
      }
      return true;
    }
    if (attempt < maxAttempts) {
      const backoffMs = 500 * attempt;
      console.warn(
        `  Download failed for ${fileName} (attempt ${attempt}/${maxAttempts}). Retrying in ${backoffMs}ms...`,
      );
      await wait(backoffMs);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Playwright scraping helpers (mirrored from exportListingTable.ts)
// ---------------------------------------------------------------------------

async function scrapeCurrentPage(page: import("playwright").Page): Promise<{ headers: string[]; rows: ScrapedRow[] }> {
  return page.evaluate(() => {
    const table = document.querySelector<HTMLTableElement>("#listing-items");
    if (!table) throw new Error('Could not find table "#listing-items".');

    const headerCells = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
    const fallbackHeaderRow = table.querySelector("tr");
    const fallbackHeaders = fallbackHeaderRow
      ? Array.from(fallbackHeaderRow.querySelectorAll<HTMLTableCellElement>("th, td")).map((c) =>
          c.innerText.replace(/\s+/g, " ").trim(),
        )
      : [];

    const headers =
      headerCells.length > 0
        ? headerCells.map((c) => c.innerText.replace(/\s+/g, " ").trim())
        : fallbackHeaders;

    const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
    const candidateRows = bodyRows.length > 0 ? bodyRows : Array.from(table.querySelectorAll("tr"));

    const rows = candidateRows
      .filter((row) => row.querySelectorAll("th").length === 0)
      .map((row) => {
        const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>("td")).map((c) =>
          c.innerText.replace(/\s+/g, " ").trim(),
        );
        let downloadUrl: string | undefined;
        const allLinks = row.querySelectorAll("a[href*='.pdf']");
        if (allLinks.length > 0) {
          downloadUrl = allLinks[0].getAttribute("href") || undefined;
        }
        return { cells, downloadUrl };
      })
      .filter((row) => row.cells.length > 0);

    return { headers, rows };
  });
}

async function getFirstRowSignature(page: import("playwright").Page): Promise<string> {
  return page.evaluate(() => {
    const firstRow =
      document.querySelector("#listing-items tbody tr") ??
      document.querySelector("#listing-items tr:nth-child(2)") ??
      document.querySelector("#listing-items tr");
    return firstRow?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  });
}

async function clickNextPage(
  page: import("playwright").Page,
  previousSignature: string,
): Promise<boolean> {
  const nextLocator = page
    .locator(
      [
        "button.table-button[aria-label='Επόμενη']",
        "a:has-text(\"Επόμενη\")",
        "button:has-text(\"Επόμενη\")",
        "a[aria-label*='Επόμενη']",
        "button[aria-label*='Επόμενη']",
      ].join(", "),
    )
    .first();

  if (!(await nextLocator.count())) return false;

  const nextClass = (await nextLocator.getAttribute("class")) ?? "";
  const ariaDisabled = (await nextLocator.getAttribute("aria-disabled")) ?? "false";
  const disabledAttr = (await nextLocator.getAttribute("disabled")) !== null;

  const isDisabledFromSelf =
    /disabled|inactive/.test(nextClass.toLowerCase()) || ariaDisabled === "true" || disabledAttr;

  const parentDisabled = await nextLocator.evaluate((el) => {
    const parent = el.parentElement;
    if (!parent) return false;
    return /disabled|inactive/.test(String(parent.className || "").toLowerCase());
  });

  if (isDisabledFromSelf || parentDisabled) return false;

  await Promise.all([
    nextLocator.click(),
    page
      .waitForFunction(
        (oldSig) => {
          const row =
            document.querySelector("#listing-items tbody tr") ??
            document.querySelector("#listing-items tr:nth-child(2)") ??
            document.querySelector("#listing-items tr");
          const sig = row?.textContent?.replace(/\s+/g, " ").trim() ?? "";
          return sig.length > 0 && sig !== oldSig;
        },
        previousSignature,
        { timeout: 10000 },
      )
      .catch(() => null),
  ]);

  await page.waitForLoadState("networkidle").catch(() => null);
  return true;
}

async function ensureListingTable(page: import("playwright").Page): Promise<void> {
  const hasTable = async (): Promise<boolean> =>
    page.evaluate(() => {
      const table = document.querySelector<HTMLTableElement>("#listing-items");
      if (!table) return false;
      const headerCount =
        table.querySelectorAll("thead th").length || table.querySelectorAll("tr th").length;
      const tbodyRows = table.querySelectorAll("tbody tr").length;
      const allRows = table.querySelectorAll("tr").length;
      const rowCount = tbodyRows > 0 ? tbodyRows : Math.max(0, allRows - 1);
      return headerCount > 0 && rowCount > 0;
    });

  const triggerSearch = async (): Promise<void> => {
    await page.evaluate(() => {
      const catalogue = document.querySelector<HTMLSelectElement>("#select_legislation_catalogue");
      if (!catalogue) return;
      const current = catalogue.value;
      const fallback = Array.from(catalogue.options).find((o) => o.value !== "-1")?.value;
      const nextValue = current === "-1" ? fallback : current;
      if (!nextValue) return;
      catalogue.value = nextValue;
      catalogue.dispatchEvent(new Event("input", { bubbles: true }));
      catalogue.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const searchButton = page.locator("button.lfilter-submit").first();
    if (await searchButton.count()) {
      await Promise.all([
        searchButton.click(),
        page.waitForLoadState("networkidle").catch(() => null),
      ]);
    }
  };

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await page.waitForLoadState("networkidle").catch(() => null);
    if (await hasTable()) return;

    console.log(`  Waiting for listing table (attempt ${attempt}/5)...`);
    await triggerSearch();

    await page
      .waitForFunction(
        () => {
          const table = document.querySelector<HTMLTableElement>("#listing-items");
          if (!table) return false;
          const headerCount =
            table.querySelectorAll("thead th").length || table.querySelectorAll("tr th").length;
          const tbodyRows = table.querySelectorAll("tbody tr").length;
          const allRows = table.querySelectorAll("tr").length;
          const rowCount = tbodyRows > 0 ? tbodyRows : Math.max(0, allRows - 1);
          return headerCount > 0 && rowCount > 0;
        },
        undefined,
        { timeout: 30000 },
      )
      .catch(() => null);

    if (await hasTable()) return;

    if (attempt < 5) {
      await page.goto(page.url(), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
    }
  }

  throw new Error("Could not load #listing-items table after 5 attempts.");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const year = new Date().getFullYear().toString();
  const targetUrl = `https://search.et.gr/el/search-legislation/?selectYear=${year}`;
  const outputPath = join("downloads", `listing-items-${year}.md`);
  const downloadsDir = join("downloads", year);

  console.log(`[${new Date().toISOString()}] Checking for new legislation (${year})...`);
  console.log(`URL: ${targetUrl}`);

  // Read existing markdown to find already-known PDFs
  let existingContent = "";
  if (existsSync(outputPath)) {
    existingContent = await readFile(outputPath, "utf8");
    console.log(`Existing listing found: ${outputPath}`);
  } else {
    console.log("No existing listing found – all scraped entries will be treated as new.");
  }

  const knownFilenames = extractKnownPdfFilenames(existingContent);
  console.log(`Known PDFs: ${knownFilenames.size}`);

  // Launch browser and scrape all pages
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let headers: string[] = [];
  const uniqueRowsMap = new Map<string, ScrapedRow>();

  try {
    console.log("Navigating to website...");
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await ensureListingTable(page);

    for (let pageIndex = 1; pageIndex <= 1000; pageIndex += 1) {
      const scraped = await scrapeCurrentPage(page);
      if (!headers.length && scraped.headers.length) {
        headers = scraped.headers.map(normalizeText);
      }

      for (const row of scraped.rows) {
        const normalizedCells = row.cells.map(normalizeText);
        const key = JSON.stringify(normalizedCells);
        if (!uniqueRowsMap.has(key)) {
          uniqueRowsMap.set(key, { cells: normalizedCells, downloadUrl: row.downloadUrl });
        }
      }

      const signature = await getFirstRowSignature(page);
      const movedToNext = await clickNextPage(page, signature);
      if (!movedToNext) break;
    }
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`Scraped ${uniqueRowsMap.size} total rows from website.`);

  // Identify new rows (PDFs not in the existing listing)
  const newRows: EnrichedRow[] = [];

  for (const [, row] of uniqueRowsMap) {
    if (!row.downloadUrl) continue;

    const fileMatch = row.downloadUrl.match(/([^\/?#]+\.pdf)$/i);
    if (!fileMatch) continue;

    const fileName = fileMatch[1];
    if (knownFilenames.has(fileName)) continue; // already known

    newRows.push({ ...row, fileName });
  }

  if (newRows.length === 0) {
    console.log("No new PDFs found. Listing is up to date.");
    return;
  }

  console.log(`\nFound ${newRows.length} new PDF(s):`);

  // Download new PDFs
  await mkdir(downloadsDir, { recursive: true });

  let downloadCount = 0;

  for (const row of newRows) {
    const { downloadUrl, fileName } = row;
    if (!downloadUrl || !fileName) continue;

    const filePath = join(downloadsDir, fileName);
    const relPath = join(year, fileName).replace(/\\/g, "/");

    process.stdout.write(`  Downloading ${fileName}... `);
    const success = await downloadFileWithRetry(downloadUrl, filePath, fileName);
    if (success) {
      row.localPath = relPath;
      downloadCount++;
      console.log("OK");
    } else {
      console.warn("FAILED");
    }
  }

  // Update markdown file
  let updatedContent: string;

  if (existingContent) {
    updatedContent = prependRowsToMarkdown(existingContent, newRows, headers);
  } else {
    // Create fresh markdown from scratch
    const rowLines = newRows.map((row) => buildMarkdownRow(headers, row));
    updatedContent = [buildMarkdownHeader(headers), ...rowLines].join("\n") + "\n";
  }

  await writeFile(outputPath, updatedContent, "utf8");

  console.log(`\nSummary:`);
  console.log(`  New entries added : ${newRows.length}`);
  console.log(`  PDFs downloaded   : ${downloadCount}`);
  console.log(`  Listing updated   : ${outputPath}`);
  console.log("\nNew entries:");
  for (const row of newRows) {
    const title = row.cells[2] ?? row.cells[1] ?? row.cells[0] ?? "(unknown)";
    console.log(`  - ${row.fileName}: ${title.slice(0, 80)}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
