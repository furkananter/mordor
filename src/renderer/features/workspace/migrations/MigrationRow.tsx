import { Pencil, Play } from "lucide-react";
import { MigrationFile } from "../../../../core/shared/messages";
import { Button } from "../../../components/ui/Button";
import { StatusIcon } from "./StatusIcon";

export function MigrationRow({
  file,
  active,
  disabled,
  onOpen,
  onApply
}: {
  file: MigrationFile;
  active: boolean;
  disabled: boolean;
  onOpen(): void;
  onApply(): void;
}) {
  return (
    <li className={`group grid border-b border-line-soft transition-colors ${active ? "bg-line-soft/60" : "hover:bg-line-soft/40"}`}>
      <div className="flex items-center gap-3 px-5 py-2.5">
        <StatusIcon status={file.status} />
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <strong className="truncate text-[12.5px] font-medium text-text">{file.filename}</strong>
            <span className="font-mono text-[10.5px] text-subtle">v{file.version}</span>
          </div>
          <span className="block truncate text-[11.5px] text-muted">
            {file.status === "applied" && file.appliedAt ? `Applied ${file.appliedAt}` : null}
            {file.status === "applied-modified" ? "Applied but file changed — review before re-running" : null}
            {file.status === "failed" ? `Failed${file.appliedAt ? ` at ${file.appliedAt}` : ""}` : null}
            {file.status === "pending" ? "Pending" : null}
          </span>
        </button>
        <Button onClick={onOpen} tooltip="Edit file">
          <Pencil size={11} strokeWidth={1.7} />
          <span>Edit</span>
        </Button>
        <Button disabled={disabled} onClick={onApply}>
          <Play size={11} strokeWidth={1.7} />
          <span>{file.status === "failed" ? "Retry" : file.status === "applied-modified" ? "Re-apply" : "Apply"}</span>
        </Button>
      </div>

      {file.status === "failed" && file.failedReason ? (
        <pre className="mx-5 mb-2 max-h-[140px] overflow-auto whitespace-pre-wrap break-words rounded-ui border border-danger/30 bg-danger/5 px-2.5 py-1.5 font-mono text-[11px] text-danger">
          {file.failedReason}
        </pre>
      ) : null}
    </li>
  );
}
