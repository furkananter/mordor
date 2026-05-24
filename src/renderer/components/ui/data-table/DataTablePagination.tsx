import { Table } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../Button";
import { PAGE_SIZE_OPTIONS, PageSize } from "../../../store/constants";
import { usePreferencesStore } from "../../../store/preferences";
import { Row } from "./types";

export function DataTablePagination({ table }: { table: Table<Row> }) {
  const pageIndex = table.getState().pagination.pageIndex;
  const pageSize = table.getState().pagination.pageSize;
  const pageCount = table.getPageCount();
  const setPreferencePageSize = usePreferencesStore((state) => state.setPageSize);

  return (
    <div className="flex items-center justify-between gap-2 border-t border-line-soft px-3 py-1.5">
      <div className="flex items-center gap-2 text-[11.5px] text-muted">
        <label className="flex items-center gap-1.5">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(event) => {
              const next = Number(event.target.value) as PageSize;
              table.setPageSize(next);
              setPreferencePageSize(next);
            }}
            className="rounded-ui border border-line bg-panel px-1.5 py-0.5 text-[11.5px] text-text focus-visible:border-accent focus-visible:outline-none"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span>
          Page <span className="text-text">{pageCount === 0 ? 0 : pageIndex + 1}</span> of {pageCount}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
          <ChevronLeft size={12} strokeWidth={1.7} />
          <span>Prev</span>
        </Button>
        <Button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
          <span>Next</span>
          <ChevronRight size={12} strokeWidth={1.7} />
        </Button>
      </div>
    </div>
  );
}
