import { Row } from "./types";

export type CopyFormat = "json" | "json-pretty" | "ndjson" | "markdown" | "csv" | "tsv";

export const COPY_FORMAT_LABELS: Record<CopyFormat, string> = {
  json: "JSON (compact)",
  "json-pretty": "JSON (pretty)",
  ndjson: "JSON Lines (NDJSON)",
  markdown: "Markdown table",
  csv: "CSV",
  tsv: "TSV"
};

/**
 * Format selected rows for clipboard. Only includes the given columns (typically
 * the visible columns excluding the selection checkbox). Cell values are read
 * from the row record as-is (already serialized strings from the backend).
 */
export function formatRowsForCopy(rows: Row[], columns: string[], format: CopyFormat): string {
  if (rows.length === 0 || columns.length === 0) return "";
  const projected = rows.map((row) =>
    Object.fromEntries(columns.map((column) => [column, row[column] ?? ""]))
  );

  switch (format) {
    case "json":
      return JSON.stringify(projected);
    case "json-pretty":
      return JSON.stringify(projected, null, 2);
    case "ndjson":
      return projected.map((entry) => JSON.stringify(entry)).join("\n");
    case "markdown":
      return toMarkdownTable(projected, columns);
    case "csv":
      return toDelimited(projected, columns, ",");
    case "tsv":
      return toDelimited(projected, columns, "\t");
    default:
      return "";
  }
}

function toMarkdownTable(rows: Record<string, string>[], columns: string[]): string {
  const escape = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const header = `| ${columns.map(escape).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => escape(row[column] ?? "")).join(" | ")} |`);
  return [header, separator, ...body].join("\n");
}

function toDelimited(rows: Record<string, string>[], columns: string[], delimiter: string): string {
  const escape = (value: string) => {
    if (value.includes(delimiter) || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };
  const header = columns.map(escape).join(delimiter);
  const body = rows.map((row) => columns.map((column) => escape(row[column] ?? "")).join(delimiter));
  return [header, ...body].join("\n");
}
