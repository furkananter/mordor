import { useEffect, useMemo, useState } from "react";
import { PreviewRowsPayload, QueryResultPayload } from "../../../core/shared/messages";
import { EmptyState } from "./EmptyState";
import { SkeletonTable } from "./Skeleton";

const MIN_COLUMN_WIDTH = 120;
const DEFAULT_COLUMN_WIDTH = 220;

export function ResultTable({
  result,
  loading,
  loadingBody,
  emptyTitle,
  emptyBody,
  emptyRowsBody = "The query returned no rows."
}: {
  result: PreviewRowsPayload | QueryResultPayload | undefined;
  loading: boolean;
  loadingBody: string;
  emptyTitle: string;
  emptyBody: string;
  emptyRowsBody?: string;
}) {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  const columns = result?.columns ?? [];
  const tableWidth = useMemo(
    () => columns.reduce((total, column) => total + (columnWidths[column] ?? DEFAULT_COLUMN_WIDTH), 0),
    [columnWidths, columns]
  );

  useEffect(() => {
    if (!result) return;
    setColumnWidths((current) => {
      const next: Record<string, number> = {};
      for (const column of result.columns) {
        next[column] = current[column] ?? DEFAULT_COLUMN_WIDTH;
      }
      return next;
    });
  }, [result]);

  const handleResizeStart = (column: string, startX: number) => {
    const startWidth = columnWidths[column] ?? DEFAULT_COLUMN_WIDTH;
    const onMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - startX;
      setColumnWidths((current) => ({
        ...current,
        [column]: Math.max(MIN_COLUMN_WIDTH, startWidth + delta)
      }));
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  if (loading) {
    const cols = result?.columns.length ?? 5;
    return <SkeletonTable rows={12} columns={cols} />;
  }
  if (!result) return <EmptyState title={emptyTitle} body={emptyBody} compact />;
  if (result.rows.length === 0) return <EmptyState title="No rows" body={emptyRowsBody} compact />;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-[560px] border-collapse font-mono text-[11.5px]" style={{ minWidth: tableWidth }}>
        <colgroup>
          {columns.map((column) => (
            <col key={column} style={{ width: columnWidths[column] ?? DEFAULT_COLUMN_WIDTH }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="sticky top-0 z-[1] border-b border-line bg-panel px-3 py-2 text-left font-medium text-muted"
              >
                <span className="inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap">{column}</span>
                <button
                  type="button"
                  className="absolute right-[-3px] top-0 m-0 h-full w-2 cursor-col-resize border-0 bg-transparent p-0 hover:bg-accent/20"
                  aria-label={`${column} column width`}
                  title={`Resize ${column}`}
                  onMouseDown={(event) => handleResizeStart(column, event.clientX)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, index) => (
            <tr key={index} className="border-b border-line-soft hover:bg-line-soft/60">
              {columns.map((column) => (
                <td
                  key={column}
                  className="max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap px-3 py-1.5 text-text"
                >
                  {row[column]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
