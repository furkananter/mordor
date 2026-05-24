import { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { formatIsoDate } from "../../../lib/formatDate";
import { ColumnType, DATE_LIKE, Row, SELECT_COLUMN_ID } from "./types";

export function useDataTableColumns(
  columnNames: string[] | undefined,
  columnTypes: Record<string, string> | undefined,
  options?: { enableSelection?: boolean }
): ColumnDef<Row>[] {
  const enableSelection = options?.enableSelection ?? false;
  // The columnNames array is a fresh reference on every preview fetch even
  // when its content is identical, which would invalidate the memo and force
  // TanStack to rebuild all column defs (and downstream row models) on each
  // live-poll tick. Derive a stable cache key from the content so the memo
  // can skip the work when nothing about the column list actually changed.
  const columnsKey = columnNames?.join("|") ?? "";
  const typesKey = columnTypes ? Object.entries(columnTypes).map(([k, v]) => `${k}:${v}`).join("|") : "";
  return useMemo<ColumnDef<Row>[]>(() => {
    if (!columnNames) return [];
    const dataColumns: ColumnDef<Row>[] = columnNames.map((name) => {
      const cassandraType = columnTypes?.[name] ?? "";
      const filterKind: ColumnType = DATE_LIKE.test(cassandraType) ? "date" : "text";
      return {
        id: name,
        accessorKey: name,
        meta: { filterKind, cassandraType },
        header: name,
        cell: (info) => String(info.getValue() ?? ""),
        filterFn:
          filterKind === "date"
            ? (row, columnId, value) => {
                if (!value) return true;
                const cellValue = String(row.getValue(columnId) ?? "");
                if (!cellValue) return false;
                const target = formatIsoDate(value as Date);
                return cellValue.startsWith(target);
              }
            : (row, columnId, value) => {
                if (!value) return true;
                const cellValue = String(row.getValue(columnId) ?? "").toLowerCase();
                return cellValue.includes(String(value).toLowerCase());
              }
      } satisfies ColumnDef<Row>;
    });
    if (!enableSelection) return dataColumns;
    const selectColumn: ColumnDef<Row> = {
      id: SELECT_COLUMN_ID,
      enableSorting: false,
      enableHiding: false,
      enableResizing: false,
      size: 40,
      minSize: 40,
      maxSize: 40,
      header: () => null,
      cell: () => null
    };
    return [selectColumn, ...dataColumns];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key strings deliberately
  }, [columnsKey, typesKey, enableSelection]);
}
