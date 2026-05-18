import { describe, it, expect } from "vitest";
import {
  normalizeText,
  escapeMarkdownCell,
  extractYear,
  toMarkdown,
  buildMarkdownHeader,
  buildMarkdownRow,
  extractKnownPdfFilenames,
  prependRowsToMarkdown,
} from "../utils.js";

// ---------------------------------------------------------------------------
// normalizeText
// ---------------------------------------------------------------------------
describe("normalizeText", () => {
  it("collapses internal whitespace to a single space", () => {
    expect(normalizeText("foo   bar")).toBe("foo bar");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
  });

  it("collapses newlines and tabs", () => {
    expect(normalizeText("a\n\t b")).toBe("a b");
  });

  it("returns empty string unchanged", () => {
    expect(normalizeText("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// escapeMarkdownCell
// ---------------------------------------------------------------------------
describe("escapeMarkdownCell", () => {
  it("escapes pipe characters", () => {
    expect(escapeMarkdownCell("a | b")).toBe("a \\| b");
  });

  it("replaces newlines with spaces", () => {
    expect(escapeMarkdownCell("line1\nline2")).toBe("line1 line2");
  });

  it("trims leading and trailing whitespace", () => {
    expect(escapeMarkdownCell("  text  ")).toBe("text");
  });

  it("escapes multiple pipes", () => {
    expect(escapeMarkdownCell("a | b | c")).toBe("a \\| b \\| c");
  });

  it("leaves plain text unchanged", () => {
    expect(escapeMarkdownCell("hello world")).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// extractYear
// ---------------------------------------------------------------------------
describe("extractYear", () => {
  it("extracts year from a search URL", () => {
    expect(extractYear("https://search.et.gr/el/search-legislation/?selectYear=2026")).toBe("2026");
  });

  it("extracts year from a date string", () => {
    expect(extractYear("08-04-2026")).toBe("2026");
  });

  it("extracts a historical year", () => {
    expect(extractYear("selectYear=1965")).toBe("1965");
  });

  it("extracts year from 1833", () => {
    expect(extractYear("?selectYear=1833")).toBe("1833");
  });

  it("falls back to the current year when no year is found", () => {
    const currentYear = new Date().getFullYear().toString();
    expect(extractYear("no-year-here")).toBe(currentYear);
  });
});

// ---------------------------------------------------------------------------
// buildMarkdownHeader
// ---------------------------------------------------------------------------
describe("buildMarkdownHeader", () => {
  it("produces a header line followed by a separator line", () => {
    const result = buildMarkdownHeader(["Name", "Value"]);
    const lines = result.split("\n");
    expect(lines[0]).toBe("| Name | Value |");
    expect(lines[1]).toBe("| --- | --- |");
  });

  it("escapes pipes in header names", () => {
    const result = buildMarkdownHeader(["A | B"]);
    expect(result.split("\n")[0]).toBe("| A \\| B |");
  });

  it("falls back to Column N for empty header names", () => {
    const result = buildMarkdownHeader(["", "Title"]);
    expect(result.split("\n")[0]).toBe("| Column 1 | Title |");
  });
});

// ---------------------------------------------------------------------------
// buildMarkdownRow
// ---------------------------------------------------------------------------
describe("buildMarkdownRow", () => {
  const headers = ["Είδος", "Αριθμός", "Λήψη"];

  it("outputs a plain row when no download link", () => {
    const row = { cells: ["Ν.", "5294", ""] };
    expect(buildMarkdownRow(headers, row)).toBe("| Ν. | 5294 |  |");
  });

  it("substitutes the Λήψη cell with a markdown link", () => {
    const row = {
      cells: ["Ν.", "5294", ""],
      localPath: "2026/20260100058.pdf",
      fileName: "20260100058.pdf",
    };
    expect(buildMarkdownRow(headers, row)).toBe(
      "| Ν. | 5294 | [20260100058.pdf](2026/20260100058.pdf) |",
    );
  });

  it("does not inject a link when localPath is missing", () => {
    const row = { cells: ["Ν.", "5294", "original"], fileName: "file.pdf" };
    expect(buildMarkdownRow(headers, row)).toBe("| Ν. | 5294 | original |");
  });

  it("fills missing cells with empty string", () => {
    const row = { cells: ["Ν."] };
    expect(buildMarkdownRow(headers, row)).toBe("| Ν. |  |  |");
  });
});

// ---------------------------------------------------------------------------
// toMarkdown
// ---------------------------------------------------------------------------
describe("toMarkdown", () => {
  const headers = ["Col A", "Λήψη"];

  it("produces correct header, separator, and data rows", () => {
    const rows = [{ cells: ["foo", ""], localPath: "2026/a.pdf" }];
    const md = toMarkdown(headers, rows);
    const lines = md.split("\n").filter(Boolean);
    expect(lines[0]).toBe("| Col A | Λήψη |");
    expect(lines[1]).toBe("| --- | --- |");
    expect(lines[2]).toBe("| foo | [a.pdf](2026/a.pdf) |");
  });

  it("ends with a newline", () => {
    expect(toMarkdown(headers, []).endsWith("\n")).toBe(true);
  });

  it("uses Column N fallback for blank headers", () => {
    const md = toMarkdown(["", "B"], [{ cells: ["x", "y"] }]);
    expect(md.startsWith("| Column 1 | B |")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractKnownPdfFilenames
// ---------------------------------------------------------------------------
describe("extractKnownPdfFilenames", () => {
  it("extracts filenames from markdown links", () => {
    const md = `| [20260100058.pdf](2026/20260100058.pdf) | text |\n| [20260100057.pdf](2026/20260100057.pdf) |`;
    const known = extractKnownPdfFilenames(md);
    expect(known.has("20260100058.pdf")).toBe(true);
    expect(known.has("20260100057.pdf")).toBe(true);
    expect(known.size).toBe(2);
  });

  it("returns an empty set for content with no PDF links", () => {
    expect(extractKnownPdfFilenames("| no links here |").size).toBe(0);
  });

  it("is case-insensitive for the .pdf extension", () => {
    const md = "| [DOC.PDF](path/DOC.PDF) |";
    const known = extractKnownPdfFilenames(md);
    expect(known.has("DOC.PDF")).toBe(true);
  });

  it("does not double-count the same filename", () => {
    const md =
      "| [a.pdf](2026/a.pdf) |\n| [a.pdf](2026/a.pdf) |";
    expect(extractKnownPdfFilenames(md).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// prependRowsToMarkdown
// ---------------------------------------------------------------------------
describe("prependRowsToMarkdown", () => {
  const headers = ["Είδος", "Αριθμός", "Λήψη"];
  const existingMd = [
    "| Είδος | Αριθμός | Λήψη |",
    "| --- | --- | --- |",
    "| Ν. | 5294 | [old.pdf](2026/old.pdf) |",
    "",
  ].join("\n");

  it("inserts new rows between the separator and existing data", () => {
    const newRows = [
      {
        cells: ["Ν.", "5295", ""],
        localPath: "2026/new.pdf",
        fileName: "new.pdf",
      },
    ];
    const result = prependRowsToMarkdown(existingMd, newRows, headers);
    const lines = result.split("\n");
    expect(lines[0]).toBe("| Είδος | Αριθμός | Λήψη |");
    expect(lines[1]).toBe("| --- | --- | --- |");
    expect(lines[2]).toBe("| Ν. | 5295 | [new.pdf](2026/new.pdf) |");
    expect(lines[3]).toBe("| Ν. | 5294 | [old.pdf](2026/old.pdf) |");
  });

  it("preserves all existing data rows", () => {
    const result = prependRowsToMarkdown(existingMd, [], headers);
    expect(result).toContain("old.pdf");
  });
});
