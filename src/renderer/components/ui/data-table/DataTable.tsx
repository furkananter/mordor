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
import { Copy, Maximize2, Minimize2, Pencil, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PreviewQuery } from "../../../../core/shared/messages";
import { usePreferencesStore } from "../../../store/preferences";
import { useLayoutStore } from "../../../store/layout";
import { ROW_DETAIL_MAX_HEIGHT } from "../../../store/constants";
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

export interface DataTableEditConfig {
  onEdit(row: Row): void;
  /** When false, the Edit button renders disabled. */
  enabled?: boolean;
  disabledReason?: string;
}

export interface DataTableInlineEditConfig {
  /** Persist a single cell change. Rejecting (throwing) leaves the cell in its prior value. */
  onCommit(row: Row, column: string, value: string): Promise<void>;
  /** Returns true when a column may be edited inline (e.g. not a primary key). */
  editableColumn(column: string): boolean;
  /** When false, double-click-to-edit is disabled entirely. Defaults to true. */
  enabled?: boolean;
}

/**
 * Opt-in server-side filter/sort. When provided, the table's column-filter and
 * sort state is (debounced and) pushed to the server via `onQueryChange`, which
 * refetches the matching page rather than only filtering the loaded rows. The
 * client-side filter/sort row models stay active too, so an applicable subset
 * (e.g. a sort the server couldn't satisfy) still narrows the visible page —
 * the server path is an enhancement, not a replacement.
 */
export interface DataTableServerQueryConfig {
  onQueryChange(query: PreviewQuery | undefined): void;
  /** Debounce window in ms for coalescing rapid filter keystrokes. Default 300. */
  debounceMs?: number;
}

/**
 * Translate the TanStack column-filter + sorting state into the engine-agnostic
 * {@link PreviewQuery}. Text column filters become `contains` (the same
 * substring semantics the client-side `includesString` filter uses); date
 * filters become an `eq` on the ISO date. Pure so it can be unit-tested.
 */
export function buildServerQuery(
  columnFilters: ColumnFiltersState,
  sorting: SortingState,
): PreviewQuery | undefined {
  const filters = columnFilters
    .map((filter) => {
      const raw = filter.value;
      if (raw instanceof Date) {
        return { column: filter.id, op: "eq" as const, value: raw.toISOString() };
      }
      if (typeof raw === "string" && raw.trim() !== "") {
        return { column: filter.id, op: "contains" as const, value: raw };
      }
      return undefined;
    })
    .filter((entry): entry is { column: string; op: "eq" | "contains"; value: string } => entry !== undefined);

  const sort = sorting.map((s) => ({ column: s.id, dir: s.desc ? ("desc" as const) : ("asc" as const) }));

  if (filters.length === 0 && sort.length === 0) return undefined;
  const query: PreviewQuery = {};
  if (filters.length > 0) query.filters = filters;
  if (sort.length > 0) query.sort = sort;
  return query;
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
  editConfig,
  inlineEditConfig,
  serverQueryConfig,
  rowIdColumns,
  highlightRowIds,
  exportTableName
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
  editConfig?: DataTableEditConfig;
  inlineEditConfig?: DataTableInlineEditConfig;
  /** When set, filter/sort changes are also pushed to the server (debounced). */
  serverQueryConfig?: DataTableServerQueryConfig;
  /** Column names whose concatenation forms a stable row id (e.g. primary keys). */
  rowIdColumns?: string[];
  /** Row IDs to render with a highlight (e.g. recently arrived in live mode). */
  highlightRowIds?: ReadonlySet<string>;
  /** Enables the SQL-INSERT export option, using this table name (DataPanel only). */
  exportTableName?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Track the expanded row by a stable key (its primary key when available),
  // not by object reference. Live-mode refreshes replace every row object, so a
  // reference would either drop the panel or, worse, keep showing a stale
  // snapshot — keying by id lets us re-resolve the current row each render.
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const rowKeyOf = useCallback(
    (row: Row) =>
      rowIdColumns && rowIdColumns.length > 0
        ? computeRowId(row, rowIdColumns, JSON.stringify(row))
        : JSON.stringify(row),
    [rowIdColumns]
  );
  const handleRowClick = useCallback(
    (row: Row) => {
      const key = rowKeyOf(row);
      setExpandedRowKey((prev) => (prev === key ? null : key));
    },
    [rowKeyOf]
  );
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

  // Server-side filter/sort: debounce the column-filter + sort state into a
  // PreviewQuery and hand it to the parent (which refetches). A ref holds the
  // last-sent serialized query so we don't refetch when nothing meaningful
  // changed, and we skip the initial empty→undefined emit so opening a table
  // doesn't trigger a redundant reload of the page it just loaded.
  const onQueryChange = serverQueryConfig?.onQueryChange;
  const debounceMs = serverQueryConfig?.debounceMs ?? 300;
  const lastSentRef = useRef<string | undefined>(undefined);
  const serverQuery = useMemo(
    () => (onQueryChange ? buildServerQuery(columnFilters, sorting) : undefined),
    [onQueryChange, columnFilters, sorting]
  );
  useEffect(() => {
    if (!onQueryChange) return;
    const serialized = serverQuery ? JSON.stringify(serverQuery) : "";
    if (lastSentRef.current === undefined && serialized === "") {
      // First render with no active query — nothing to push yet.
      lastSentRef.current = "";
      return;
    }
    if (lastSentRef.current === serialized) return;
    const handle = window.setTimeout(() => {
      lastSentRef.current = serialized;
      onQueryChange(serverQuery);
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [onQueryChange, serverQuery, debounceMs]);

  // Resolve the live row object for the expanded key on every render, so the
  // detail panel always reflects the latest values (and closes itself if the
  // row disappears after a filter or live refresh).
  const expandedRow = useMemo(() => {
    if (!expandedRowKey || !result) return null;
    return result.rows.find((row) => rowKeyOf(row) === expandedRowKey) ?? null;
  }, [expandedRowKey, result, rowKeyOf]);

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
        {...(exportTableName ? { exportTableName } : {})}
      />

      <DataTableBody
        table={table}
        columnCount={columns.length}
        onRowClick={handleRowClick}
        {...(columnTypes ? { columnTypes } : {})}
        {...(inlineEditConfig ? { inlineEditConfig } : {})}
        {...(highlightRowIds ? { highlightRowIds } : {})}
      />

      {expandedRow && result && (
        <RowDetailPanel
          row={expandedRow}
          columns={result.columns}
          {...(columnTypes ? { columnTypes } : {})}
          {...(editConfig ? { editConfig } : {})}
          onClose={() => setExpandedRowKey(null)}
        />
      )}

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

function RowDetailPanel({
  row,
  columns,
  columnTypes,
  editConfig,
  onClose
}: {
  row: Row;
  columns: string[];
  columnTypes?: Record<string, string> | undefined;
  editConfig?: DataTableEditConfig;
  onClose(): void;
}) {
  const height = useLayoutStore((state) => state.rowDetailHeight);
  const setHeight = useLayoutStore((state) => state.setRowDetailHeight);
  const [resizing, setResizing] = useState(false);
  // Remembers the pre-maximize height so the toggle can restore it.
  const restoreRef = useRef<number | null>(null);
  const maximized = height >= ROW_DETAIL_MAX_HEIGHT;

  // Drag the top edge to resize. Dragging up grows the panel (its bottom edge
  // is pinned above the pagination bar), so height = startHeight + (startY−y).
  const handleResizeStart = (event: React.MouseEvent) => {
    event.preventDefault();
    setResizing(true);
    const startY = event.clientY;
    const startHeight = height;
    const onMove = (move: MouseEvent) => setHeight(startHeight + (startY - move.clientY));
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const toggleMaximize = () => {
    if (maximized) {
      setHeight(restoreRef.current ?? ROW_DETAIL_MAX_HEIGHT / 2);
    } else {
      restoreRef.current = height;
      setHeight(ROW_DETAIL_MAX_HEIGHT);
    }
  };

  return (
    <div style={{ height }} className="relative flex shrink-0 flex-col border-t border-line bg-panel-soft">
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize row data panel"
        onMouseDown={handleResizeStart}
        onDoubleClick={toggleMaximize}
        data-active={resizing ? "true" : "false"}
        className="absolute left-0 right-0 top-0 z-10 h-1.5 -translate-y-1/2 cursor-row-resize bg-transparent transition-colors hover:bg-accent/60 data-[active=true]:bg-accent"
      />
      <div className="flex items-center justify-between border-b border-line-soft px-3 py-1.5">
        <span className="text-[11px] font-medium text-muted">Row data</span>
        <div className="flex items-center gap-0.5">
          {editConfig ? (
            <button
              type="button"
              onClick={() => editConfig.onEdit(row)}
              disabled={editConfig.enabled === false}
              className="rounded p-0.5 text-subtle hover:bg-line-soft hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Edit row"
              title={editConfig.enabled === false ? editConfig.disabledReason ?? "Editing unavailable" : "Edit row"}
            >
              <Pencil size={12} strokeWidth={1.7} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleMaximize}
            className="rounded p-0.5 text-subtle hover:bg-line-soft hover:text-text"
            aria-label={maximized ? "Restore row detail height" : "Maximize row detail"}
            title={maximized ? "Restore" : "Expand"}
          >
            {maximized ? <Minimize2 size={12} strokeWidth={1.7} /> : <Maximize2 size={12} strokeWidth={1.7} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-subtle hover:bg-line-soft hover:text-text"
            aria-label="Close row detail"
          >
            <X size={13} strokeWidth={1.7} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse font-mono text-[11.5px]">
          <tbody>
            {columns.map((col) => {
              const value = row[col] ?? "";
              const structured = parseStructured(value);
              return (
                <tr key={col} className="group border-b border-line-soft/60 last:border-b-0 hover:bg-line-soft/40">
                  <td className="w-[160px] max-w-[200px] shrink-0 select-none px-3 py-1.5 align-top font-medium text-muted">
                    <div className="truncate">{col}</div>
                    {columnTypes?.[col] ? (
                      <div className="truncate text-[10px] text-subtle">{columnTypes[col]}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 align-top">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        {value === "" ? (
                          <span className="italic text-subtle">null</span>
                        ) : structured !== undefined ? (
                          <JsonView value={structured} />
                        ) : (
                          <span className="whitespace-pre-wrap break-all text-text">{value}</span>
                        )}
                      </div>
                      {value !== "" && (
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(value)}
                          className="mt-0.5 shrink-0 rounded p-0.5 text-subtle opacity-0 transition-opacity hover:text-text group-hover:opacity-100"
                          aria-label={`Copy ${col}`}
                        >
                          <Copy size={11} strokeWidth={1.7} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Renders a parsed JSON value as an indented tree. Cassandra maps/lists/sets
 * and Postgres json/jsonb columns arrive as serialized strings; this is the
 * shared structured view for them. Dependency free and recursive.
 */
function JsonView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null) return <span className="text-subtle">null</span>;
  if (typeof value === "string") return <span className="text-success">&quot;{value}&quot;</span>;
  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="text-accent">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted">[]</span>;
    return (
      <div className="grid">
        {value.map((entry, i) => (
          <div key={i} style={{ paddingLeft: depth > 0 ? 12 : 0 }} className="flex gap-1.5">
            <span className="shrink-0 text-subtle">{i}:</span>
            <JsonView value={entry} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-muted">{"{}"}</span>;
  return (
    <div className="grid">
      {entries.map(([key, entry]) => (
        <div key={key} style={{ paddingLeft: depth > 0 ? 12 : 0 }} className="flex gap-1.5">
          <span className="shrink-0 text-muted">{key}:</span>
          <JsonView value={entry} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}

/**
 * Returns the parsed object/array when `value` is JSON describing one, else
 * undefined (so scalars and plain strings render as text, not quoted JSON).
 */
function parseStructured(value: string): unknown {
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
