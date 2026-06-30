import { Table, flexRender } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import {
  Table as UiTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../Table";
import { DataTableInlineEditConfig } from "./DataTable";
import { Row, SELECT_COLUMN_ID } from "./types";

function isBooleanType(type: string | undefined): boolean {
  if (!type) return false;
  const lowered = type.toLowerCase();
  return lowered === "boolean" || lowered === "bool";
}

// Approximate height (px) of a rendered row. The virtualizer uses this to size
// the spacer and pick the visible window; it then measures real heights as
// rows mount and adjusts. Slight estimate drift is fine.
const ROW_HEIGHT_ESTIMATE = 32;
// Rows above/below the visible window to pre-render so fast scrolling stays smooth.
const OVERSCAN = 12;
// Below this row count, virtualization overhead (ResizeObserver, per-row
// absolute positioning bookkeeping) is bigger than the win, and JSDOM tests —
// which report zero layout dimensions — would render no rows at all under
// virtualization. Direct render is the right call.
const VIRTUALIZE_AFTER = 100;

export function DataTableBody({
  table,
  columnCount,
  columnTypes,
  inlineEditConfig,
  highlightRowIds,
  onRowClick
}: {
  table: Table<Row>;
  columnCount: number;
  columnTypes?: Record<string, string> | undefined;
  inlineEditConfig?: DataTableInlineEditConfig;
  highlightRowIds?: ReadonlySet<string>;
  onRowClick?: (row: Row) => void;
}) {
  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = rows.length > VIRTUALIZE_AFTER;

  // The cell currently being edited inline, keyed by the TanStack row id plus
  // the column id. Only one cell is editable at a time. `saving` blocks input
  // and re-entry while the commit promise is in flight.
  const inlineEnabled = Boolean(inlineEditConfig) && inlineEditConfig?.enabled !== false;
  const [editingCell, setEditingCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const canEditColumn = useCallback(
    (columnId: string) =>
      inlineEnabled && columnId !== SELECT_COLUMN_ID && (inlineEditConfig?.editableColumn(columnId) ?? false),
    [inlineEnabled, inlineEditConfig]
  );

  const startEditing = useCallback(
    (rowId: string, columnId: string) => {
      if (!canEditColumn(columnId)) return;
      setEditingCell({ rowId, columnId });
    },
    [canEditColumn]
  );

  const cancelEditing = useCallback(() => {
    setEditingCell(null);
  }, []);

  const commitEditing = useCallback(
    async (row: Row, columnId: string, value: string) => {
      if (!inlineEditConfig) return;
      const previous = row[columnId] ?? "";
      // No change → just close the editor without a round-trip.
      if (value === previous) {
        setEditingCell(null);
        return;
      }
      setSaving(true);
      try {
        await inlineEditConfig.onCommit(row, columnId, value);
        setEditingCell(null);
      } catch (error) {
        // The parent surfaces the error; keep the editor open so the user can
        // retry or press Esc to discard. Re-throw so the editor re-arms its
        // commit guard and a subsequent Enter/blur can retry.
        throw error;
      } finally {
        setSaving(false);
      }
    },
    [inlineEditConfig]
  );

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: OVERSCAN,
    getItemKey: (index) => rows[index]?.id ?? index
  });
  const virtualRows = shouldVirtualize ? virtualizer.getVirtualItems() : [];
  const totalSize = shouldVirtualize ? virtualizer.getTotalSize() : 0;
  const tableWidth = table.getCenterTotalSize();

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <UiTable
        className="font-mono"
        // `display: grid` is the key — it lets us mix sticky header rows with
        // absolutely-positioned body rows in the same table. The classic
        // `<table>`/`<tr>` height contract doesn't honor inline `style.height`
        // on `<tr>`, so spacer-row virtualization is unreliable.
        style={{ width: tableWidth, display: "grid" }}
      >
        <TableHeader style={{ display: "grid", position: "sticky", top: 0, zIndex: 1 }}>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow
              key={headerGroup.id}
              className="hover:bg-transparent"
              style={{ display: "flex", width: "100%" }}
            >
              {headerGroup.headers.map((header) => {
                if (header.column.id === SELECT_COLUMN_ID) {
                  const allSelected = table.getIsAllPageRowsSelected();
                  const someSelected = table.getIsSomePageRowsSelected();
                  return (
                    <TableHead
                      key={header.id}
                      style={{ width: header.getSize(), flexShrink: 0 }}
                      className="!px-0 flex items-center"
                    >
                      <div className="flex h-full items-center justify-start pl-3">
                        <SelectionCheckbox
                          checked={allSelected}
                          indeterminate={!allSelected && someSelected}
                          onChange={(value) => table.toggleAllPageRowsSelected(value)}
                          ariaLabel="Select all rows on this page"
                        />
                      </div>
                    </TableHead>
                  );
                }
                const canSort = header.column.getCanSort();
                const sortDir = header.column.getIsSorted();
                const isResizing = header.column.getIsResizing();
                return (
                  <TableHead
                    key={header.id}
                    style={{ width: header.getSize(), flexShrink: 0 }}
                    className="relative flex items-center"
                  >
                    <div className="grid gap-1.5 pr-2 w-full">
                      <button
                        type="button"
                        className={`flex items-center gap-1 text-left font-medium ${canSort ? "hover:text-text" : ""}`}
                        onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      >
                        <span className="truncate">
                          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                        {canSort ? (
                          sortDir === "asc" ? (
                            <ArrowUp size={10} strokeWidth={1.8} className="text-accent" />
                          ) : sortDir === "desc" ? (
                            <ArrowDown size={10} strokeWidth={1.8} className="text-accent" />
                          ) : (
                            <ArrowUpDown size={10} strokeWidth={1.8} className="text-subtle" />
                          )
                        ) : null}
                      </button>
                    </div>
                    <div
                      title={`Resize ${header.id} column`}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onDoubleClick={() => header.column.resetSize()}
                      data-resizing={isResizing ? "true" : "false"}
                      className="absolute right-0 top-0 z-[2] h-full w-1.5 cursor-col-resize select-none touch-none bg-transparent transition-colors hover:bg-accent/60 data-[resizing=true]:bg-accent"
                    />
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody
          style={
            shouldVirtualize
              ? { display: "grid", height: totalSize, position: "relative" }
              : { display: "grid" }
          }
        >
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent" style={{ display: "flex" }}>
              <TableCell colSpan={columnCount} className="h-20 text-center text-muted" style={{ width: "100%" }}>
                No rows match the current filters.
              </TableCell>
            </TableRow>
          ) : shouldVirtualize ? (
            virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              return (
                <RenderedRow
                  key={virtualRow.key}
                  row={row}
                  isSelected={row.getIsSelected()}
                  isFresh={highlightRowIds?.has(row.id) ?? false}
                  offsetY={virtualRow.start}
                  tableWidth={tableWidth}
                  editingColumnId={editingCell?.rowId === row.id ? editingCell.columnId : null}
                  saving={saving}
                  canEditColumn={canEditColumn}
                  onStartEdit={startEditing}
                  onCancelEdit={cancelEditing}
                  onCommitEdit={commitEditing}
                  {...(columnTypes ? { columnTypes } : {})}
                  {...(onRowClick ? { onRowClick } : {})}
                />
              );
            })
          ) : (
            rows.map((row) => (
              <RenderedRow
                key={row.id}
                row={row}
                isSelected={row.getIsSelected()}
                isFresh={highlightRowIds?.has(row.id) ?? false}
                tableWidth={tableWidth}
                editingColumnId={editingCell?.rowId === row.id ? editingCell.columnId : null}
                saving={saving}
                canEditColumn={canEditColumn}
                onStartEdit={startEditing}
                onCancelEdit={cancelEditing}
                onCommitEdit={commitEditing}
                {...(columnTypes ? { columnTypes } : {})}
                {...(onRowClick ? { onRowClick } : {})}
              />
            ))
          )}
        </TableBody>
      </UiTable>
    </div>
  );
}

// Memoized so a state change that touches only one row (selecting a checkbox,
// a fresh-row highlight flipping on/off during live polling) re-renders just
// that row instead of every row in the visible window. The bits that actually
// vary are passed as primitive props the default shallow compare can diff:
//   - isSelected / isFresh  → toggle re-renders only the affected row
//   - offsetY               → virtual scroll position (undefined = direct render)
//   - tableWidth            → changes on column resize, so cell widths refresh
// The TanStack `row` reference is stable across selection/scroll/live ticks
// (the core row model is only rebuilt on sort/filter/data change), so the memo
// holds for everything except genuine content changes.
//   - editingColumnId       → the column being inline-edited in *this* row (or null)
//   - saving                → blocks the inline editor while a commit is in flight
const RenderedRow = memo(function RenderedRow({
  row,
  isSelected,
  isFresh,
  offsetY,
  tableWidth,
  columnTypes,
  editingColumnId,
  saving,
  canEditColumn,
  onStartEdit,
  onCancelEdit,
  onCommitEdit,
  onRowClick
}: {
  row: import("@tanstack/react-table").Row<Row>;
  isSelected: boolean;
  isFresh: boolean;
  offsetY?: number;
  tableWidth: number;
  columnTypes?: Record<string, string> | undefined;
  editingColumnId?: string | null;
  saving?: boolean;
  canEditColumn?: (columnId: string) => boolean;
  onStartEdit?: (rowId: string, columnId: string) => void;
  onCancelEdit?: () => void;
  onCommitEdit?: (row: Row, columnId: string, value: string) => void | Promise<void>;
  onRowClick?: (row: Row) => void;
}) {
  const style: React.CSSProperties =
    offsetY === undefined
      ? { display: "flex", width: tableWidth }
      : {
          // Absolute positioning anchored to the body's relative container;
          // transform avoids layout thrash compared to top.
          display: "flex",
          position: "absolute",
          transform: `translateY(${offsetY}px)`,
          width: tableWidth
        };
  return (
    <TableRow
      data-state={isSelected ? "selected" : undefined}
      data-fresh={isFresh ? "true" : undefined}
      style={style}
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
      className={onRowClick ? "cursor-pointer" : undefined}
    >
      {row.getVisibleCells().map((cell) => {
        if (cell.column.id === SELECT_COLUMN_ID) {
          return (
            <TableCell
              key={cell.id}
              style={{ width: cell.column.getSize(), flexShrink: 0 }}
              className="!px-0 overflow-visible flex items-center"
            >
              <div className="flex h-full items-center justify-start pl-3">
                <SelectionCheckbox
                  checked={isSelected}
                  onChange={(value) => row.toggleSelected(value)}
                  ariaLabel="Select row"
                />
              </div>
            </TableCell>
          );
        }
        const columnId = cell.column.id;
        const editable = canEditColumn?.(columnId) ?? false;
        const isEditing = editingColumnId === columnId;
        if (isEditing && onCommitEdit && onCancelEdit) {
          return (
            <TableCell
              key={cell.id}
              style={{ width: cell.column.getSize(), flexShrink: 0 }}
              className="!px-1 flex items-center"
              // Don't let the active editor bubble a click up into row-detail toggle.
              onClick={(event) => event.stopPropagation()}
            >
              <InlineCellEditor
                initialValue={row.original[columnId] ?? ""}
                isBoolean={isBooleanType(columnTypes?.[columnId])}
                disabled={saving ?? false}
                onCommit={(value) => onCommitEdit(row.original, columnId, value)}
                onCancel={onCancelEdit}
              />
            </TableCell>
          );
        }
        return (
          <TableCell
            key={cell.id}
            style={{ width: cell.column.getSize(), flexShrink: 0 }}
            className={`flex items-center${editable ? " cursor-text data-[editable=true]:hover:bg-accent/5" : ""}`}
            data-editable={editable ? "true" : undefined}
            title={editable ? "Double-click to edit" : undefined}
            onDoubleClick={
              editable && onStartEdit
                ? (event) => {
                    event.stopPropagation();
                    onStartEdit(row.id, columnId);
                  }
                : undefined
            }
          >
            <span className="truncate">{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>
          </TableCell>
        );
      })}
    </TableRow>
  );
});

/**
 * The transient input/select rendered in place of a cell during inline editing.
 * Enter commits, Esc cancels, blur commits (matching the spec). Booleans use a
 * three-state select (null / true / false) mirroring the row dialog.
 */
function InlineCellEditor({
  initialValue,
  isBoolean,
  disabled,
  onCommit,
  onCancel
}: {
  initialValue: string;
  isBoolean: boolean;
  disabled: boolean;
  onCommit(value: string): void | Promise<void>;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initialValue);
  // A commit may fire from both Enter and the ensuing blur; guard so it runs once.
  // On failure the editor stays open, so re-arm the guard to allow a retry.
  const committedRef = useRef(false);

  const commit = useCallback(async () => {
    if (committedRef.current) return;
    committedRef.current = true;
    try {
      await onCommit(value);
    } catch {
      // Commit failed and the editor remains open; re-arm so Enter/blur can retry.
      committedRef.current = false;
    }
  }, [onCommit, value]);

  const cancel = useCallback(() => {
    committedRef.current = true;
    onCancel();
  }, [onCancel]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  if (isBoolean) {
    return (
      <select
        autoFocus
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        className="min-h-[24px] w-full rounded-ui border border-accent bg-panel px-1 py-0.5 text-[12px] text-text focus-visible:outline-none"
      >
        <option value="">null</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  return (
    <input
      autoFocus
      value={value}
      disabled={disabled}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={commit}
      onFocus={(event) => event.currentTarget.select()}
      className="min-h-[24px] w-full rounded-ui border border-accent bg-panel px-1 py-0.5 font-mono text-[12px] text-text focus-visible:outline-none"
    />
  );
}

function SelectionCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange(checked: boolean): void;
  ariaLabel: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      ref={(node) => {
        if (node) node.indeterminate = Boolean(indeterminate);
      }}
      onChange={(event) => onChange(event.target.checked)}
      onClick={(event) => event.stopPropagation()}
      className="h-3.5 w-3.5 cursor-pointer accent-accent"
    />
  );
}
