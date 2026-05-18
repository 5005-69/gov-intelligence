// ---------------------------------------------------------------------------
// Shared pure utility functions used by exportListingTable.ts,
// checkNewLegislation.ts, and the unit test suite.
// ---------------------------------------------------------------------------

export type EnrichedRow = {
  cells: string[];
  downloadUrl?: string;
  localPath?: string;
  fileName?: string;
};

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

export function extractYear(urlOrDate: string): string {
  const yearMatch = urlOrDate.match(/\b(202[0-9]|201[0-9]|20[0-9]{2}|19[0-9]{2}|1[89][0-9]{2})\b/);
  return yearMatch ? yearMatch[1] : new Date().getFullYear().toString();
}

// ---------------------------------------------------------------------------
// Markdown builders
// ---------------------------------------------------------------------------

export function buildMarkdownHeader(headers: string[]): string {
  const safe = headers.map((h, i) => escapeMarkdownCell(h || `Column ${i + 1}`));
  return `| ${safe.join(" | ")} |\n| ${safe.map(() => "---").join(" | ")} |`;
}

export function buildMarkdownRow(headers: string[], row: EnrichedRow): string {
  const downloadColIndex = headers.findIndex((h) => h.toLowerCase().includes("λήψη"));
  const cells = headers.map((_, index) => {
    const cellValue = row.cells[index] ?? "";
    if (index === downloadColIndex && row.localPath && row.fileName) {
      return `[${row.fileName}](${row.localPath})`;
    }
    return escapeMarkdownCell(cellValue);
  });
  return `| ${cells.join(" | ")} |`;
}

export function toMarkdown(
  headers: string[],
  rows: Array<{ cells: string[]; localPath?: string }>,
): string {
  const safeHeaders = headers.map((h, i) => escapeMarkdownCell(h || `Column ${i + 1}`));
  const headerLine = `| ${safeHeaders.join(" | ")} |`;
  const separatorLine = `| ${safeHeaders.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((row) => {
    const normalized = safeHeaders.map((_, index) => {
      const cellValue = row.cells[index] ?? "";
      const downloadColIndex = safeHeaders.findIndex((h) => h.toLowerCase().includes("λήψη"));
      if (index === downloadColIndex && row.localPath) {
        const fileName = row.localPath.split("/").pop() || "download";
        return `[${fileName}](${row.localPath})`;
      }
      return escapeMarkdownCell(cellValue);
    });
    return `| ${normalized.join(" | ")} |`;
  });
  return [headerLine, separatorLine, ...rowLines].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Markdown diffing helpers
// ---------------------------------------------------------------------------

/**
 * Parses all PDF filenames referenced in a markdown listing file.
 * Matches patterns like [filename.pdf](some/path/filename.pdf)
 */
export function extractKnownPdfFilenames(markdownContent: string): Set<string> {
  const known = new Set<string>();
  const regex = /\[([^\]]+\.pdf)\]\([^)]+\)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdownContent)) !== null) {
    known.add(match[1]);
  }
  return known;
}

/**
 * Prepends new data rows to an existing markdown table, preserving the
 * header and separator lines.
 */
export function prependRowsToMarkdown(
  existing: string,
  newRows: EnrichedRow[],
  headers: string[],
): string {
  const lines = existing.split("\n");
  const header = lines[0] ?? "";
  const separator = lines[1] ?? "";
  const existingDataLines = lines.slice(2);
  const newRowLines = newRows.map((row) => buildMarkdownRow(headers, row));
  return [header, separator, ...newRowLines, ...existingDataLines].join("\n");
}
