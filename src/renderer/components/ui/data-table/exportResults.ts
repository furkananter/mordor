/**
 * Client-side export of the rows currently displayed in a result grid.
 *
 * These are pure string builders — they take the visible columns + the rows
 * (already serialized to `Record<string, string>` by the backend) and produce
 * a single document. The browser-download wiring lives separately in the
 * toolbar; keeping the formatting pure makes it trivially testable.
 *
 * We deliberately reuse the strict escapes from `core/export/formatters` so the
 * grid export round-trips identically to the full DB/table export.
 */
import { csvField, quoteIdent, quoteSqlString } from "../../../../core/export/formatters";
import { Row } from "./types";

export type ResultExportFormat = "csv" | "json" | "sql";

/**
 * RFC 4180 CSV: header row of column names + one row per record. Fields are
 * escaped via the shared `csvField` (quote when the value contains a delimiter,
 * quote, CR, or LF; internal quotes doubled). Lines are terminated with CRLF.
 */
export function toCsv(columns: string[], rows: Row[]): string {
  const line = (fields: string[]) => `${fields.map(csvField).join(",")}\r\n`;
  const header = line(columns);
  const body = rows.map((row) => line(columns.map((column) => row[column] ?? ""))).join("");
  return `${header}${body}`;
}

/**
 * Pretty-printed JSON array of objects, projected to the given columns only.
 * Missing cells become empty strings (mirrors the copy/CSV behaviour) so every
 * object has a uniform shape.
 */
export function toJson(columns: string[], rows: Row[]): string {
  const projected = rows.map((row) =>
    Object.fromEntries(columns.map((column) => [column, row[column] ?? ""]))
  );
  return JSON.stringify(projected, null, 2);
}

/**
 * One `INSERT INTO <table> (...) VALUES (...);` per row.
 *
 * Limitation: every cell value arrives as a string (the grid never sees the
 * original DB type), so we cannot reliably tell a numeric/boolean/null column
 * from a string one. We therefore quote EVERY value as a SQL string literal
 * (single quotes, internal quotes doubled). This is always safe to parse, but
 * importers will receive textual values that may need casting. Keep it simple
 * and lossless rather than guessing types.
 */
export function toSqlInserts(tableName: string, columns: string[], rows: Row[]): string {
  const columnList = columns.map(quoteIdent).join(", ");
  return rows
    .map((row) => {
      const values = columns.map((column) => quoteSqlString(row[column] ?? "")).join(", ");
      return `INSERT INTO ${quoteIdent(tableName)} (${columnList}) VALUES (${values});`;
    })
    .join("\n");
}

export interface ResultExport {
  content: string;
  mimeType: string;
  extension: string;
}

/** Builds the export document + download metadata for the chosen format. */
export function buildResultExport(
  format: ResultExportFormat,
  columns: string[],
  rows: Row[],
  tableName?: string
): ResultExport {
  switch (format) {
    case "csv":
      return { content: toCsv(columns, rows), mimeType: "text/csv;charset=utf-8", extension: "csv" };
    case "json":
      return { content: toJson(columns, rows), mimeType: "application/json;charset=utf-8", extension: "json" };
    case "sql":
      return {
        content: toSqlInserts(tableName ?? "exported_rows", columns, rows),
        mimeType: "application/sql;charset=utf-8",
        extension: "sql"
      };
    default:
      return { content: "", mimeType: "text/plain", extension: "txt" };
  }
}
