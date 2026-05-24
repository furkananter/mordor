import { Table, flexRender } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useRef } from "react";
import {
  Table as UiTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../Table";
import { Row, SELECT_COLUMN_ID } from "./types";

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
  highlightRowIds
}: {
  table: Table<Row>;
  columnCount: number;
  highlightRowIds?: ReadonlySet<string>;
}) {
  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = rows.length > VIRTUALIZE_AFTER;

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
                  isFresh={highlightRowIds?.has(row.id) ?? false}
                  // Absolute positioning anchored to the body's relative
                  // container; transform avoids layout thrash compared to top.
                  style={{
                    display: "flex",
                    position: "absolute",
                    transform: `translateY(${virtualRow.start}px)`,
                    width: "100%"
                  }}
                />
              );
            })
          ) : (
            rows.map((row) => (
              <RenderedRow
                key={row.id}
                row={row}
                isFresh={highlightRowIds?.has(row.id) ?? false}
                style={{ display: "flex", width: "100%" }}
              />
            ))
          )}
        </TableBody>
      </UiTable>
    </div>
  );
}

function RenderedRow({
  row,
  isFresh,
  style
}: {
  row: import("@tanstack/react-table").Row<Row>;
  isFresh: boolean;
  style: React.CSSProperties;
}) {
  return (
    <TableRow
      data-state={row.getIsSelected() ? "selected" : undefined}
      // Fresh-row highlight is driven entirely by the `[data-fresh="true"]`
      // CSS keyframe in styles.css — no per-row transition listener.
      data-fresh={isFresh ? "true" : undefined}
      style={style}
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
                  checked={row.getIsSelected()}
                  onChange={(value) => row.toggleSelected(value)}
                  ariaLabel="Select row"
                />
              </div>
            </TableCell>
          );
        }
        return (
          <TableCell
            key={cell.id}
            style={{ width: cell.column.getSize(), flexShrink: 0 }}
            className="flex items-center"
          >
            <span className="truncate">{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>
          </TableCell>
        );
      })}
    </TableRow>
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
