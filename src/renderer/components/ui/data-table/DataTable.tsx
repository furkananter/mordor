import {
  ColumnFiltersState,
  RowSelectionState,
  SortingState,
  VisibilityState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable
} from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import { usePreferencesStore } from "../../../store/preferences";
import { EmptyState } from "../EmptyState";
import { SkeletonTable } from "../Skeleton";
import { DataTableBody } from "./DataTableBody";
import { DataTableFilters } from "./DataTableFilters";
import { DataTablePagination } from "./DataTablePagination";
import { DataTableToolbar, ToolbarDeleteConfig } from "./DataTableToolbar";
import { computeRowId, DataTablePayload, Row } from "./types";
import { useDataTableColumns } from "./useDataTableColumns";

export type { DataTablePayload } from "./types";

export interface DataTableDeleteConfig {
  label: string;
  confirmTitle: string;
  confirmBody: (count: number) => string;
  onConfirm(rows: Row[]): Promise<void> | void;
  /** When false, the delete button is rendered but disabled. */
  enabled?: boolean;
  disabledReason?: string;
}

// Memo'd because parents (DataPanel, CqlPanel) feed referentially stable props
// — the preview result is deep-equal short-circuited on live-mode ticks,
// columnTypes/pkColumns/deleteConfig are useMemo'd, and the page-size + flags
// are primitives. Skipping DataTable's render when none of those change saves
// the TanStack row-model recomputation entirely.
function DataTableImpl({
  result,
  loading,
  emptyTitle,
  emptyBody,
  emptyRowsBody = "The query returned no rows.",
  columnTypes,
  pageSize,
  enableSelection = false,
  deleteConfig,
  rowIdColumns,
  highlightRowIds
}: {
  result: DataTablePayload | undefined;
  loading: boolean;
  emptyTitle: string;
  emptyBody: string;
  emptyRowsBody?: string;
  columnTypes?: Record<string, string> | undefined;
  pageSize?: number;
  enableSelection?: boolean;
  deleteConfig?: DataTableDeleteConfig;
  /** Column names whose concatenation forms a stable row id (e.g. primary keys). */
  rowIdColumns?: string[];
  /** Row IDs to render with a highlight (e.g. recently arrived in live mode). */
  highlightRowIds?: ReadonlySet<string>;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const preferredPageSize = usePreferencesStore((state) => state.pageSize);
  const effectivePageSize = pageSize ?? preferredPageSize;

  const columns = useDataTableColumns(result?.columns, columnTypes, { enableSelection });

  const table = useReactTable({
    data: result?.rows ?? [],
    columns,
    state: { sorting, columnFilters, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: enableSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // Resize on mouse-release rather than per-mousemove. In "onChange" mode
    // every drag tick rewrites column sizing state, which re-runs the row model
    // and re-renders every visible cell — the dominant source of jank when
    // dragging a column on a wide/tall result. "onEnd" keeps the drag itself
    // smooth and commits the new width once, on release.
    columnResizeMode: "onEnd",
    defaultColumn: { size: 220, minSize: 80, maxSize: 800 },
    initialState: { pagination: { pageSize: effectivePageSize } },
    ...(rowIdColumns && rowIdColumns.length > 0
      ? { getRowId: (row: Row, index: number) => computeRowId(row, rowIdColumns, index) }
      : {})
  });

  const selectedRowsCount = useMemo(() => Object.values(rowSelection).filter(Boolean).length, [rowSelection]);

  if (loading) {
    return <SkeletonTable rows={Math.min(effectivePageSize, 12)} columns={result?.columns.length ?? 5} />;
  }
  if (!result) {
    return <EmptyState title={emptyTitle} body={emptyBody} compact />;
  }
  if (result.rows.length === 0) {
    return <EmptyState title="No rows" body={emptyRowsBody} compact />;
  }

  const filteredCount = table.getFilteredRowModel().rows.length;
  const toolbarDelete: ToolbarDeleteConfig | undefined = deleteConfig
    ? {
        label: deleteConfig.label,
        confirmTitle: deleteConfig.confirmTitle,
        confirmBody: deleteConfig.confirmBody,
        ...(deleteConfig.enabled !== undefined ? { enabled: deleteConfig.enabled } : {}),
        ...(deleteConfig.disabledReason !== undefined ? { disabledReason: deleteConfig.disabledReason } : {}),
        onConfirm: async () => {
          const rows = table.getSelectedRowModel().rows.map((row) => row.original);
          await deleteConfig.onConfirm(rows);
          setRowSelection({});
        }
      }
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DataTableToolbar
        table={table}
        totalRows={result.rows.length}
        filteredCount={filteredCount}
        activeFilters={columnFilters.length}
        onOpenFilters={() => setFiltersOpen(true)}
        onClearFilters={() => setColumnFilters([])}
        selectedCount={selectedRowsCount}
        onClearSelection={() => setRowSelection({})}
        {...(toolbarDelete ? { deleteConfig: toolbarDelete } : {})}
      />

      <DataTableBody table={table} columnCount={columns.length} {...(highlightRowIds ? { highlightRowIds } : {})} />

      <DataTablePagination table={table} />

      <DataTableFilters
        open={filtersOpen}
        table={table}
        totalRows={result.rows.length}
        filteredCount={filteredCount}
        activeCount={columnFilters.length}
        onClose={() => setFiltersOpen(false)}
        onClearAll={() => setColumnFilters([])}
      />
    </div>
  );
}

export const DataTable = memo(DataTableImpl);
