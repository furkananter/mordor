export type Row = Record<string, string>;
export const SELECT_COLUMN_ID = "__select__";

export function computeRowId(row: Row, rowIdColumns: string[], fallback: string | number): string {
  if (rowIdColumns.length === 0) return String(fallback);
  return rowIdColumns.map((column) => row[column] ?? "").join("|") || String(fallback);
}
export type ColumnType = "text" | "date";

export interface DataTablePayload {
  columns: string[];
  rows: Row[];
  limit?: number;
}

export interface ColumnMeta {
  filterKind: ColumnType;
  cassandraType?: string;
}

export const DATE_LIKE = /timestamp|date|timeuuid/i;
