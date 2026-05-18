---
description: "Add a new scraper script to the Greek Legislation project: create the TypeScript file, wire it into package.json, and update the README."
argument-hint: "Describe the script to add (e.g. 'scrape a specific FEK series', 'export to CSV')"
agent: "agent"
tools: [read_file, grep_search, semantic_search, replace_string_in_file, multi_replace_string_in_file, create_file]
---

You are adding a new script to this Greek Legislation scraper project.

## What the user wants

$input

## Rules

1. **Shared logic lives in [scripts/utils.ts](../../scripts/utils.ts)**. Import `normalizeText`, `escapeMarkdownCell`, `extractYear`, `toMarkdown`, `extractKnownPdfFilenames`, `prependRowsToMarkdown`, and the `EnrichedRow` type from there. Do **not** duplicate them.
2. **Browser automation** follows the same patterns as [scripts/exportListingTable.ts](../../scripts/exportListingTable.ts): `ensureListingTable`, `scrapeCurrentPage`, `clickNextPage`. If the new script also needs to scrape `#listing-items`, re-export or import `scrapeYear` from `exportListingTable.ts`.
3. **Output** goes under `downloads/` mirroring the existing structure (`downloads/<year>/` for PDFs, `downloads/listing-items-<year>.md` for markdown indexes).
4. Add the new script as an `npm run` command in [package.json](../../package.json) following the existing naming convention (`scrape:*`, `check:*`, `export:*`).
5. Add or update unit tests in [scripts/\_\_tests\_\_/utils.test.ts](../../scripts/__tests__/utils.test.ts) for any new pure functions you introduce in `utils.ts`.
6. Update [README.md](../../README.md): add a section under `## 📜 Scripts` following the same format as the other scripts (code block, argument table if applicable, example output). Update the Project Structure section if new files are added.

## Checklist before finishing

- [ ] New script file created under `scripts/`
- [ ] `package.json` updated with new `npm run` command
- [ ] README `Scripts` section updated
- [ ] README Project Structure updated
- [ ] `utils.ts` updated if new pure helpers were added
- [ ] Unit tests added or updated
- [ ] No logic duplicated from `utils.ts` or `exportListingTable.ts`
