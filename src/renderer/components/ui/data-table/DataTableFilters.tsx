import { Table } from "@tanstack/react-table";
import { X } from "lucide-react";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { FilterControl } from "./FilterControl";
import { ColumnMeta, Row } from "./types";

export function DataTableFilters({
  open,
  table,
  totalRows,
  filteredCount,
  activeCount,
  onClose,
  onClearAll
}: {
  open: boolean;
  table: Table<Row>;
  totalRows: number;
  filteredCount: number;
  activeCount: number;
  onClose(): void;
  onClearAll(): void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title="Filters"
      description="Filter rows by column. Empty fields are ignored."
      size="lg"
    >
      <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-5 pb-2 pt-1">
        {table.getAllLeafColumns().map((column) => {
          const meta = column.columnDef.meta as ColumnMeta | undefined;
          const filterValue = column.getFilterValue();
          const active = filterValue !== undefined && filterValue !== "" && filterValue !== null;
          return (
            <label key={column.id} className="grid gap-1">
              <span className="flex items-center justify-between gap-2 text-[11.5px] font-medium text-muted">
                <span className="truncate text-text">{column.id}</span>
                <span className="flex items-center gap-2">
                  {meta?.cassandraType ? (
                    <span className="font-mono text-[10.5px] text-subtle">{meta.cassandraType}</span>
                  ) : null}
                  {active ? (
                    <button
                      type="button"
                      onClick={() => column.setFilterValue(undefined)}
                      className="rounded-sm p-0.5 text-subtle hover:bg-line-soft hover:text-text"
                      aria-label={`Clear ${column.id} filter`}
                    >
                      <X size={11} strokeWidth={1.7} />
                    </button>
                  ) : null}
                </span>
              </span>
              <FilterControl column={column} />
            </label>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line-soft px-5 py-3">
        <span className="text-[11.5px] text-muted">
          {activeCount === 0
            ? "No active filters"
            : `${activeCount} active filter${activeCount === 1 ? "" : "s"} · ${filteredCount} / ${totalRows} rows`}
        </span>
        <div className="flex items-center gap-1">
          <Button onClick={onClearAll} disabled={activeCount === 0}>Clear all</Button>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Dialog>
  );
}
