import { writeFile, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import https from "node:https";
import { chromium } from "playwright";
import { normalizeText, escapeMarkdownCell, extractYear, toMarkdown } from "./utils.js";

type ScrapedPage = {
  headers: string[];
  rows: Array<{ cells: string[]; downloadUrl?: string }>;
};

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

async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
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
        console.log(`Downloaded ${fileName} on retry ${attempt}/${maxAttempts}`);
      }
      return true;
    }

    if (attempt < maxAttempts) {
      const backoffMs = 500 * attempt;
      console.warn(
        `Download failed for ${fileName} (attempt ${attempt}/${maxAttempts}). Retrying in ${backoffMs}ms...`,
      );
      await wait(backoffMs);
    }
  }

  return false;
}

async function scrapeCurrentPage(page: import("playwright").Page): Promise<ScrapedPage> {
  return page.evaluate(() => {
    const table = document.querySelector<HTMLTableElement>("#listing-items");
    if (!table) {
      throw new Error('Could not find table with id "listing-items".');
    }

    const headerCells = Array.from(
      table.querySelectorAll<HTMLTableCellElement>("thead th"),
    );

    const fallbackHeaderRow = table.querySelector("tr");
    const fallbackHeaders = fallbackHeaderRow
      ? Array.from(
          fallbackHeaderRow.querySelectorAll<HTMLTableCellElement>("th, td"),
        ).map((cell) => cell.innerText.replace(/\s+/g, " ").trim())
      : [];

    const headers =
      headerCells.length > 0
        ? headerCells.map((cell) => cell.innerText.replace(/\s+/g, " ").trim())
        : fallbackHeaders;

    const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
    const candidateRows = bodyRows.length > 0 ? bodyRows : Array.from(table.querySelectorAll("tr"));

    const rows = candidateRows
      .filter((row) => row.querySelectorAll("th").length === 0)
      .map((row) => {
        const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>("td")).map((cell) =>
          cell.innerText.replace(/\s+/g, " ").trim(),
        );
        let downloadUrl: string | undefined;
        
        // Look for PDF links in any cell of the row
        const allLinks = row.querySelectorAll("a[href*='.pdf']");
        if (allLinks.length > 0) {
          const pdfLink = allLinks[0];
          downloadUrl = pdfLink.getAttribute("href") || undefined;
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

async function clickNextPage(page: import("playwright").Page, previousSignature: string): Promise<boolean> {
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

  if (!(await nextLocator.count())) {
    return false;
  }

  const nextClass = (await nextLocator.getAttribute("class")) ?? "";
  const ariaDisabled = (await nextLocator.getAttribute("aria-disabled")) ?? "false";
  const disabledAttr = (await nextLocator.getAttribute("disabled")) !== null;

  const isDisabledFromSelf =
    /disabled|inactive/.test(nextClass.toLowerCase()) ||
    ariaDisabled === "true" ||
    disabledAttr;
  const parentDisabled = await nextLocator.evaluate((el) => {
    const parent = el.parentElement;
    if (!parent) {
      return false;
    }
    const classes = parent.className || "";
    return /disabled|inactive/.test(String(classes).toLowerCase());
  });

  if (isDisabledFromSelf || parentDisabled) {
    return false;
  }

  await Promise.all([
    nextLocator.click(),
    page
      .waitForFunction(
        (oldSignature) => {
          const firstRow =
            document.querySelector("#listing-items tbody tr") ??
            document.querySelector("#listing-items tr:nth-child(2)") ??
            document.querySelector("#listing-items tr");
          const signature = firstRow?.textContent?.replace(/\s+/g, " ").trim() ?? "";
          return signature.length > 0 && signature !== oldSignature;
        },
        previousSignature,
        { timeout: 10000 },
      )
      .catch(() => null),
  ]);

  await page.waitForLoadState("networkidle").catch(() => null);

  return true;
}

async function ensureListingTable(
  page: import("playwright").Page,
  catalogueValue?: string,
): Promise<void> {
  const hasListingTableStructure = async (): Promise<boolean> => {
    return page.evaluate(() => {
      const table = document.querySelector<HTMLTableElement>("#listing-items");
      if (!table) {
        return false;
      }

      const headerCount =
        table.querySelectorAll("thead th").length ||
        table.querySelectorAll("tr th").length;
      const tbodyRows = table.querySelectorAll("tbody tr").length;
      const allRows = table.querySelectorAll("tr").length;
      const rowCount = tbodyRows > 0 ? tbodyRows : Math.max(0, allRows - 1);

      return headerCount > 0 && rowCount > 0;
    });
  };

  const triggerSearch = async (): Promise<void> => {
    console.log("Selecting catalogue...");
    await page.evaluate((forcedCatalogue) => {
      const catalogue = document.querySelector<HTMLSelectElement>("#select_legislation_catalogue");
      if (!catalogue) {
        return;
      }

      const current = catalogue.value;
      const fallbackOption = Array.from(catalogue.options).find((opt) => opt.value !== "-1")?.value;
      const nextValue = forcedCatalogue || (current === "-1" ? fallbackOption : current);

      if (!nextValue) {
        return;
      }

      catalogue.value = nextValue;
      catalogue.dispatchEvent(new Event("input", { bubbles: true }));
      catalogue.dispatchEvent(new Event("change", { bubbles: true }));
    }, catalogueValue);

    const searchButton = page.locator("button.lfilter-submit").first();
    if (await searchButton.count()) {
      console.log("Clicking search button...");
      await Promise.all([
        searchButton.click(),
        page.waitForLoadState("networkidle").catch(() => null),
      ]);
    }
  };

  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await page.waitForLoadState("networkidle").catch(() => null);

    if (await hasListingTableStructure()) {
      console.log(`Table is ready (attempt ${attempt}/${maxAttempts})`);
      return;
    }

    console.log(`Waiting for table to appear (attempt ${attempt}/${maxAttempts})...`);
    await triggerSearch();

    await page
      .waitForFunction(
        () => {
          const table = document.querySelector<HTMLTableElement>("#listing-items");
          if (!table) {
            return false;
          }

          const headerCount =
            table.querySelectorAll("thead th").length ||
            table.querySelectorAll("tr th").length;
          const tbodyRows = table.querySelectorAll("tbody tr").length;
          const allRows = table.querySelectorAll("tr").length;
          const rowCount = tbodyRows > 0 ? tbodyRows : Math.max(0, allRows - 1);

          return headerCount > 0 && rowCount > 0;
        },
        undefined,
        { timeout: 30000 },
      )
      .catch(() => null);

    if (await hasListingTableStructure()) {
      console.log(`Table is ready after search (attempt ${attempt}/${maxAttempts})`);
      return;
    }

    if (attempt < maxAttempts) {
      console.warn("Table did not load yet. Reloading and retrying...");
      await page.goto(page.url(), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
    }
  }

  throw new Error(`Could not load a valid #listing-items table after ${maxAttempts} attempts.`);
}

export async function scrapeYear(
  targetUrl: string,
  outputPath: string,
  options: { catalogueValue?: string; browser?: import("playwright").Browser } = {},
): Promise<{ rows: number; downloads: number }> {
  const year = extractYear(targetUrl);
  const downloadsDir = join(outputPath, "..", year);

  const ownBrowser = !options.browser;
  const browser = options.browser ?? (await chromium.launch({ headless: true }));
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log(`Navigating to ${targetUrl}...`);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await ensureListingTable(page, options.catalogueValue);

    await mkdir(downloadsDir, { recursive: true });

    const uniqueRowsMap = new Map<string, { cells: string[]; downloadUrl?: string }>();
    let headers: string[] = [];

    for (let pageIndex = 1; pageIndex <= 1000; pageIndex += 1) {
      if (uniqueRowsMap.size >= 30) break;
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

      if (!movedToNext) {
        break;
      }
    }

    const rows: Array<{ cells: string[]; localPath?: string }> = [];
    let downloadCount = 0;

    for (const [, rowData] of uniqueRowsMap) {
      if (downloadCount >= 30) break;
      let localPath: string | undefined;
      if (rowData.downloadUrl) {
        try {
          const fileMatch = rowData.downloadUrl.match(/([^\/?#]+\.pdf)$/i);
          const fileName = fileMatch?.[1] || `document_${downloadCount + 1}.pdf`;
          const filePath = join(downloadsDir, fileName);
          const relPath = join(year, fileName).replace(/\\/g, "/");

          console.log(`  Downloading ${fileName}...`);
          const success = await downloadFileWithRetry(rowData.downloadUrl, filePath, fileName);
          if (success) {
            localPath = relPath;
            downloadCount++;
          } else {
            console.warn(`  Failed to download ${fileName} after all retries.`);
          }
        } catch {
          console.warn(`  Failed to download ${rowData.downloadUrl}`);
        }
      }
      rows.push({ cells: rowData.cells, localPath });
    }

    if (!headers.length && rows.length) {
      headers = rows[0].cells.map((_, index) => `Column ${index + 1}`);
    }

    const markdown = toMarkdown(headers, rows);
    await writeFile(outputPath, markdown, "utf8");

    console.log(`  Saved ${rows.length} rows → ${outputPath} (${downloadCount} PDFs)`);
    return { rows: rows.length, downloads: downloadCount };
  } finally {
    await context.close();
    if (ownBrowser) await browser.close();
  }
}

async function main(): Promise<void> {
  const [, , targetUrl, outputPathArg, catalogueValueArg] = process.argv;

  if (!targetUrl) {
    throw new Error(
      "Usage: npm run scrape:table -- <url> [output-markdown-path] [catalogue-value]\nExample: npm run scrape:table -- https://search.et.gr/el/search-legislation/?selectYear=2026 listings-2026.md 1",
    );
  }

  const outputPath = outputPathArg ?? "listing-items.md";
  await scrapeYear(targetUrl, outputPath, { catalogueValue: catalogueValueArg });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
