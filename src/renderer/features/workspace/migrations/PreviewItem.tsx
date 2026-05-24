import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MigrationPreview } from "../../../../core/shared/messages";

export function PreviewItem({ preview, defaultOpen }: { preview: MigrationPreview; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li className="border-b border-line-soft last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 bg-line-soft/40 px-3 py-1.5 text-left text-[11.5px] hover:bg-line-soft/70"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {open ? <ChevronDown size={11} strokeWidth={1.7} className="shrink-0 text-subtle" /> : <ChevronRight size={11} strokeWidth={1.7} className="shrink-0 text-subtle" />}
          <span className="truncate font-medium text-text">{preview.filename}</span>
        </span>
        <span className="shrink-0 text-subtle">{preview.statements.length} statement{preview.statements.length === 1 ? "" : "s"}</span>
      </button>
      {open ? (
        <ol className="anim-fade-slide-up grid">
          {preview.statements.map((statement, index) => (
            <li key={index} className="flex gap-2 border-t border-line-soft/60 px-3 py-1.5 font-mono text-[11px] text-muted">
              <span className="shrink-0 text-subtle">{index + 1}.</span>
              <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words">{statement}</pre>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}
