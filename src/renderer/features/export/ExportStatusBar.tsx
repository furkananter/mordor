/**
 * Renders three states above the workspace:
 *
 *   - `running` — a one-line busy banner with a spinner ("Exporting …").
 *   - `lastResult` — success banner with summary stats + "Open folder" CTA.
 *   - `lastError` — danger banner with the message + dismiss.
 *
 * Mounted once near the App root (above WorkspaceHeader) so banners survive
 * tab switches and connection changes.
 */

import { useShallow } from "zustand/react/shallow";
import { Download, FolderOpen, Loader2, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useExportStatusStore } from "../../store/exportStatus";

export function ExportStatusBar() {
  const { running, lastResult, lastError, dismiss } = useExportStatusStore(
    useShallow((state) => ({
      running: state.running,
      lastResult: state.lastResult,
      lastError: state.lastError,
      dismiss: state.dismiss,
    })),
  );

  if (running) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 border-b border-line bg-line-soft/40 px-4 py-2 text-[12px] text-muted"
      >
        <Loader2 size={12} strokeWidth={1.7} className="animate-spin text-accent" />
        <span>{running}</span>
        <span className="text-subtle">— large databases may take a few minutes.</span>
      </div>
    );
  }

  if (lastError) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2 text-[12px] text-danger"
      >
        <Download size={12} strokeWidth={1.7} />
        <span className="flex-1 truncate">Export failed: {lastError}</span>
        <Button variant="icon" onClick={dismiss} tooltip="Dismiss">
          <X size={12} strokeWidth={1.7} />
        </Button>
      </div>
    );
  }

  if (lastResult) {
    const totalBytes = lastResult.artifacts.reduce((sum, a) => sum + a.byteCount, 0);
    const summary = (() => {
      if (lastResult.engine === "redis") {
        return `${lastResult.keysExported ?? 0} keys`;
      }
      const tableCount = lastResult.tables.length;
      const rowCount = lastResult.tables.reduce((sum, t) => sum + t.rowsExported, 0);
      return `${tableCount} table${tableCount === 1 ? "" : "s"}, ${rowCount.toLocaleString()} rows`;
    })();
    const warnings = lastResult.warnings.length;
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 border-b border-success/40 bg-success/10 px-4 py-2 text-[12px] text-success"
      >
        <Download size={12} strokeWidth={1.7} />
        <span className="flex-1 truncate">
          Export complete — {summary} · {formatBytes(totalBytes)} ·{" "}
          <span className="text-success/80">{lastResult.folderPath}</span>
          {warnings > 0 ? (
            <span className="text-warning">
              {" "}· {warnings} warning{warnings === 1 ? "" : "s"}
            </span>
          ) : null}
        </span>
        <Button
          onClick={() => void window.cassandraDesk.openFolder(lastResult.folderPath)}
          tooltip="Reveal in file manager"
        >
          <FolderOpen size={12} strokeWidth={1.7} />
          <span>Open folder</span>
        </Button>
        <Button variant="icon" onClick={dismiss} tooltip="Dismiss">
          <X size={12} strokeWidth={1.7} />
        </Button>
      </div>
    );
  }

  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
