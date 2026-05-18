---
description: "Patch or harden the existing Greek legislation scraper: fix reliability issues, add export/download behavior, and keep the current CLI workflow intact."
name: "Patch Legislation Scraper"
argument-hint: "Describe the scraper bug, reliability issue, or feature to add"
agent: "agent"
---

You are modifying the existing Greek legislation scraper workflow in this repository.

## User Request

$input

## Scope

Work primarily in [scripts/exportListingTable.ts](../../scripts/exportListingTable.ts), and update related project files only when the requested change requires it.

Relevant supporting files:

- [README.md](../../README.md)
- [package.json](../../package.json)
- [query_website.html](../../query_website.html)

## Goals

1. Keep the current command-line workflow working:

```bash
npm run scrape:table -- "<url>" "<output-markdown-path>" [catalogue-value]
```

2. Preserve the current core behavior unless the request explicitly changes it:

- load the dynamic `#listing-items` table
- paginate through `Επόμενη`
- export the table to markdown
- download row PDFs into a year-based folder next to the markdown file
- link local PDF files from the markdown output

3. Prefer reliability improvements over one-off patches. For example:

- retry loading the table when the page does not render results immediately
- retry individual PDF downloads on transient failures
- validate the actual table structure, not only selector presence
- keep logs clear enough to diagnose which step failed

## Constraints

1. Make the smallest change that fixes the requested issue.
2. Do not rewrite the script architecture unless the request requires it.
3. Preserve relative markdown links and the `downloads/<year>/` output layout.
4. Follow the existing TypeScript and Playwright patterns already used in the repo.
5. If behavior or usage changes, update [README.md](../../README.md).

## Validation

After editing, prefer validating with the real command when possible:

```bash
npm run scrape:table -- "https://search.et.gr/el/search-legislation/?selectYear=2026" "downloads/listing-items-2026.md"
```

If a narrower validation is more appropriate, use that first. Report:

- what changed
- what you validated
- any remaining reliability risks or edge cases