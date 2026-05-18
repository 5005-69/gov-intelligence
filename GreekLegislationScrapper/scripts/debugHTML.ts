import { chromium } from "playwright";

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log("Navigating to page...");
    await page.goto("https://search.et.gr/el/search-legislation/?selectYear=2026", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Ensure listing table
    if (!(await page.locator("#listing-items").count())) {
      console.log("Table not found, triggering search...");
      await page.evaluate(() => {
        const catalogue = document.querySelector<HTMLSelectElement>(
          "#select_legislation_catalogue",
        );
        if (!catalogue) {
          console.log("Catalogue not found");
          return;
        }

        const current = catalogue.value;
        const fallbackOption = Array.from(catalogue.options).find(
          (opt) => opt.value !== "-1",
        )?.value;
        const nextValue = current === "-1" ? fallbackOption : current;

        if (!nextValue) {
          return;
        }

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

      await page.waitForSelector("#listing-items", { timeout: 60000 });
    }

    // Get HTML of first row
    const firstRowHTML = await page.evaluate(() => {
      const firstRow = document.querySelector("#listing-items tbody tr");
      if (!firstRow) {
        return "No row found";
      }
      return firstRow.outerHTML;
    });

    console.log("\n=== First Row HTML ===");
    console.log(firstRowHTML);

    // Get all cells of first row with details
    const rowDetails = await page.evaluate(() => {
      const firstRow = document.querySelector("#listing-items tbody tr");
      if (!firstRow) {
        return [];
      }

      return Array.from(firstRow.querySelectorAll("td")).map((td, index) => ({
        index,
        text: td.innerText.substring(0, 50),
        html: td.innerHTML.substring(0, 200),
        links: Array.from(td.querySelectorAll("a")).map((a) => ({
          href: a.getAttribute("href"),
          text: a.innerText,
        })),
      }));
    });

    console.log("\n=== Row Details ===");
    console.log(JSON.stringify(rowDetails, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
