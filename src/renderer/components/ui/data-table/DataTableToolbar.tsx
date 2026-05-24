import { Column, Table } from "@tanstack/react-table";
import { Check, ChevronDown, Clipboard, Columns3, Filter, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "../AlertDialog";
import { Button } from "../Button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../DropdownMenu";
import { COPY_FORMAT_LABELS, CopyFormat, formatRowsForCopy } from "./formatRows";
import { Row, SELECT_COLUMN_ID } from "./types";

const COPY_FORMATS: CopyFormat[] = ["json-pretty", "json", "ndjson", "markdown", "csv", "tsv"];

export interface ToolbarDeleteConfig {
  label: string;
  confirmTitle: string;
  confirmBody: (count: number) => string;
  enabled?: boolean;
  disabledReason?: string;
  onConfirm(): Promise<void> | void;
}

export function DataTableToolbar({
  table,
  totalRows,
  filteredCount,
  activeFilters,
  onOpenFilters,
  onClearFilters,
  selectedCount = 0,
  onClearSelection,
  deleteConfig
}: {
  table: Table<Row>;
  totalRows: number;
  filteredCount: number;
  activeFilters: number;
  onOpenFilters(): void;
  onClearFilters(): void;
  selectedCount?: number;
  onClearSelection?: () => void;
  deleteConfig?: ToolbarDeleteConfig;
}) {
  const hideableColumns: Column<Row, unknown>[] = table
    .getAllColumns()
    .filter((column) => column.getCanHide() && column.id !== SELECT_COLUMN_ID);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [copiedFormat, setCopiedFormat] = useState<CopyFormat | undefined>(undefined);
  const deleteEnabled = deleteConfig?.enabled !== false;

  useEffect(() => {
    if (!copiedFormat) return;
    const id = window.setTimeout(() => setCopiedFormat(undefined), 1500);
    return () => window.clearTimeout(id);
  }, [copiedFormat]);

  const copySelection = (format: CopyFormat) => {
    const rows = table.getSelectedRowModel().rows.map((row) => row.original);
    const columns = table
      .getVisibleLeafColumns()
      .filter((column) => column.id !== SELECT_COLUMN_ID)
      .map((column) => column.id);
    const payload = formatRowsForCopy(rows, columns, format);
    if (!payload) return;
    void navigator.clipboard.writeText(payload);
    setCopiedFormat(format);
  };

  const handleConfirm = async () => {
    if (!deleteConfig) return;
    setWorking(true);
    try {
      await deleteConfig.onConfirm();
      setConfirmOpen(false);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 border-b border-line-soft px-3 py-1.5">
      <div className="flex items-center gap-1">
        <Button
          onClick={onOpenFilters}
          className={activeFilters > 0 ? "bg-line-soft text-text" : ""}
          tooltip="Filters"
        >
          <Filter size={12} strokeWidth={1.7} />
          <span>Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}</span>
        </Button>
        {activeFilters > 0 ? (
          <Button onClick={onClearFilters} tooltip="Clear all filters">
            Clear
          </Button>
        ) : null}
        {selectedCount > 0 ? (
          <>
            <span className="ml-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
              {selectedCount} selected
            </span>
            {onClearSelection ? (
              <Button onClick={onClearSelection} tooltip="Clear selection">
                Clear
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button tooltip="Copy selected rows to clipboard">
                  {copiedFormat ? (
                    <Check size={12} strokeWidth={1.7} className="text-success" />
                  ) : (
                    <Clipboard size={12} strokeWidth={1.7} />
                  )}
                  <span>{copiedFormat ? "Copied" : "Copy"}</span>
                  <ChevronDown size={11} strokeWidth={1.7} className="text-subtle" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Copy {selectedCount} row{selectedCount === 1 ? "" : "s"} as</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {COPY_FORMATS.map((format) => (
                  <DropdownMenuItem key={format} onSelect={() => copySelection(format)}>
                    <span>{COPY_FORMAT_LABELS[format]}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {deleteConfig ? (
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={!deleteEnabled}
                {...(!deleteEnabled ? { tooltip: deleteConfig.disabledReason ?? "Delete is disabled" } : {})}
                className="border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 disabled:opacity-50"
              >
                <Trash2 size={12} strokeWidth={1.7} />
                <span>{deleteConfig.label}</span>
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[11.5px] text-muted">
          {filteredCount === totalRows ? `${totalRows} rows` : `${filteredCount} / ${totalRows} rows`}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button tooltip="Columns">
              <Columns3 size={12} strokeWidth={1.7} />
              <span>Columns</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[260px] overflow-y-auto">
            <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {hideableColumns.map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={column.getIsVisible()}
                onCheckedChange={(value) => column.toggleVisibility(Boolean(value))}
                onSelect={(event) => event.preventDefault()}
              >
                {column.id}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {deleteConfig ? (
        <AlertDialog open={confirmOpen} onOpenChange={(open) => (working ? null : setConfirmOpen(open))}>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>{deleteConfig.confirmTitle}</AlertDialogTitle>
              <AlertDialogDescription>{deleteConfig.confirmBody(selectedCount)}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="danger"
                disabled={working}
                onClick={(event) => {
                  event.preventDefault();
                  void handleConfirm();
                }}
              >
                {working ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
